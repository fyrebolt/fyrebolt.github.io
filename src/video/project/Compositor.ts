// ===== Unified compositor: one clock, a stitched clip sequence, one export =====
//
// Replaces the per-tool BannerPlayer / CaptionsPlayer / ZoomPlayer. Each frame it
//   1. resolves the OUTPUT time (freeze-aware clock),
//   2. maps it through the time-warp to a BASE-sequence time, then resolves WHICH
//      clip is showing and the SOURCE time inside that clip (see project/clips.ts),
//   3. draws the BASE frame — a zoom crop if a zoom layer exists, else the plain
//      aspect-composited active clip,
//   4. draws every OVERLAY layer in z-order (banner, captions, …) on top,
//   5. fires each layer's SFX.
// Preview playback, scrubbing, zoom-rect editing, and MP4 export all share this.
//
// The base sequence is the ONLY thing that knows about multiple clips. Overlays
// and the warp operate in OUTPUT / base time exactly as in the single-source
// editor, so a one-clip project is bit-for-bit the old behaviour. Clip boundaries
// are hard CUTS: the active clip's <video> plays / is steered, every other clip's
// <video> is paused (and, once the export audio graph exists, gain-muted), so the
// audio hard-cuts at each boundary. Crossfade / wipe transitions are a follow-up.

import {
  drawSource,
  drawZoomed,
  drawBanner,
  drawCaption,
  drawTypewriter,
  drawAttachmentsLayer,
  drawSketch,
  drawSticker,
  drawHighlightBox,
  drawDramaticWord,
  dramaticWordLayout,
  measureCaption,
  outputSizeFor,
} from '../render';
import type { OutputSize } from '../types';
import { SfxEngine } from '../sfx';
import { poolById, fontByKey } from '../captions/fonts';
import type { BoilFont } from '../captions/fonts';
import type { CaptionEl } from '../captions/types';
import { boilFontIndex, elementEnd as captionEnd, typewriterProgress } from '../captions/types';
import { FULL_RECT, rectAt, sortedZooms } from '../zoom/types';
import { speedAt, SLOWMO_ENTER } from '../timemachine/types';
import { elementEnd as sketchEnd } from '../sketch/types';
import { elementEnd as highlightEnd } from '../highlight/types';
import { elementEnd as dramaticEnd } from '../dramatic/types';
import { elementEnd as stickerEnd } from '../sticker/types';
import type { Project, CaptionLayer } from './types';
import { bannerLayer, zoomLayer, timeMachineLayer, overlayLayers, layerSpan } from './types';
import type { VideoClip, BaseHit } from './clips';
import { baseDuration, resolveBase, hasVideoClip, sampleVolume } from './clips';

/** Seconds between pencil-on-paper grains while a sketch animates. */
const PENCIL_INTERVAL = 0.06;
import { bannerFrameAt, crossedLock, compileWarp } from './timeMap';
import type { TimeWarp } from './timeMap';

const FPS = 30;

export type MediaKind = 'video' | 'image';

/** A decoded clip media element resolved from the registry. */
export type ClipEl = HTMLVideoElement | HTMLImageElement;

export interface CaptionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Per-video-clip audio nodes, built lazily for export (see ensureClipAudio). */
interface ClipAudio {
  node: MediaElementAudioSourceNode;
  gain: GainNode;
}

export class Compositor {
  private ctx: CanvasRenderingContext2D;
  private out: OutputSize = { w: 2, h: 2 };
  private raf = 0;
  private recording = false;
  private editing = false; // zoom-rect edit view (full un-zoomed frame)
  private playing = false;

  // clock — OUTPUT time is wall-clock driven; the active clip <video> is steered to match.
  private playStartWall = 0;
  private playStartOutput = 0;
  private prevT = 0;
  /** Last resolved OUTPUT time — what a static redraw / hit-test uses while paused. */
  private pausedT = 0;

  // Drag-scrub seek coalescing. HTML5 <video> seeking has real latency, so during
  // a continuous scrub we never issue a new seek while one is still in flight:
  // `scrubNext` holds only the LATEST requested frame and is applied when the
  // pending seek resolves. This bounds the work to one seek at a time and always
  // lands on the newest position rather than replaying a backlog.
  private scrubSeeking = false;
  private scrubNext: { sec: number; video: HTMLVideoElement; currentTime: number } | null = null;

  // cached compiled time-warp (rebuilt when the project ref or base duration changes)
  private warpCache: TimeWarp | null = null;
  private warpProject: Project | null = null;
  private warpBase = -1;

  // audio
  private audioCtx: AudioContext | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private sfx: SfxEngine | null = null;
  /** One source+gain per VIDEO clip element (keyed by clip srcId), built for export. */
  private clipAudio = new Map<string, ClipAudio>();

  // per-pass SFX edge tracking
  private firedEntrance = false;
  private firedWhoosh = new Set<string>();
  private lastFontIdx = new Map<string, number>();
  private lastReveal = new Map<string, number>();
  private deleteCueFired = new Set<string>();
  private lastPencil = new Map<string, number>();

  private canvas: HTMLCanvasElement;
  private getProject: () => Project;
  private onTime?: (outputSec: number) => void;
  /** Resolve a clip's decoded media by registry id (kept outside the project). */
  private getClipMedia: (srcId: string) => ClipEl | undefined;
  /** Resolve a sticker's decoded media by registry id (kept outside the project). */
  private getStickerMedia?: (srcId: string) => HTMLImageElement | HTMLVideoElement | undefined;

  constructor(
    canvas: HTMLCanvasElement,
    getProject: () => Project,
    getClipMedia: (srcId: string) => ClipEl | undefined,
    onTime?: (outputSec: number) => void,
    getStickerMedia?: (srcId: string) => HTMLImageElement | HTMLVideoElement | undefined,
  ) {
    this.canvas = canvas;
    this.getProject = getProject;
    this.getClipMedia = getClipMedia;
    this.onTime = onTime;
    this.getStickerMedia = getStickerMedia;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  // ---- clip sequence accessors ----

  private clips(): VideoClip[] {
    return this.getProject().clips;
  }

  private hasVideo(): boolean {
    return hasVideoClip(this.clips());
  }

  /** Any clips loaded at all? */
  get loaded(): boolean {
    return this.clips().length > 0;
  }

  private firstClip(): VideoClip | null {
    return this.clips()[0] ?? null;
  }

  private elOf(clip: VideoClip): ClipEl | undefined {
    return this.getClipMedia(clip.srcId);
  }

  /** Resolve the clip + source time showing at OUTPUT time `outputT`. */
  private hitAt(outputT: number): BaseHit | null {
    return resolveBase(this.clips(), this.warp().sourceAt(outputT));
  }

  /** The active clip's decoded element at OUTPUT time `outputT`. */
  private activeEl(outputT: number): ClipEl | null {
    const hit = this.hitAt(outputT);
    if (!hit) return null;
    return this.elOf(hit.clip) ?? null;
  }

  /** Called by the editor after clips change: resize the canvas + first paint. */
  attach(): void {
    this.stop();
    this.warpCache = null;
    this.syncOutputSize();
    // Seed the active clip's frame if it's a video needing a seek, else draw.
    this.renderStatic();
  }

  get outputSize(): OutputSize {
    return this.out;
  }

  sourceDims(): { w: number; h: number } {
    const c = this.firstClip();
    return c ? { w: c.w, h: c.h } : { w: 0, h: 0 };
  }

  private syncOutputSize(): void {
    const c = this.firstClip();
    if (!c) return;
    const size = outputSizeFor(this.getProject().ratio, c.w, c.h);
    if (size.w !== this.out.w || size.h !== this.out.h) {
      this.out = size;
      this.canvas.width = size.w;
      this.canvas.height = size.h;
    }
  }

  /** The compiled output→base time-warp for the current project (cached). */
  private warp(): TimeWarp {
    const p = this.getProject();
    const video = this.hasVideo();
    const base = baseDuration(p.clips);
    if (this.warpCache && this.warpProject === p && this.warpBase === base) return this.warpCache;
    this.warpCache = compileWarp(p, base, video);
    this.warpProject = p;
    this.warpBase = base;
    return this.warpCache;
  }

  /** Total OUTPUT duration (base sequence warped by speed/freeze, or the image length). */
  totalSec(): number {
    if (!this.loaded) return 0;
    const p = this.getProject();
    if (this.hasVideo()) return Math.max(0.1, this.warp().totalOutput);
    // Image-only sequence: base length, but never shorter than a placed overlay.
    const ends = p.layers.map((l) => layerSpan(l).end);
    return Math.max(3, baseDuration(p.clips), ...ends);
  }

  // ---- clock ----

  /** Wall-clock OUTPUT time for the current frame. */
  private computeOutputT(): number {
    if (!this.loaded || !this.playing) return this.pausedT;
    return this.playStartOutput + (performance.now() - this.playStartWall) / 1000;
  }

  /**
   * Steer every VIDEO clip so the ACTIVE one's frame + rate match OUTPUT time
   * `outputT` (pause on a freeze, else play at the warp's instantaneous speed,
   * correcting drift), pre-roll the NEXT clip to its in-point, and pause all
   * others. Original audio (when the export graph exists) is gain-muted on any
   * clip that isn't the audible active one, or whenever speed isn't ~1.
   */
  private driveClips(outputT: number, allowPlay: boolean): void {
    const clips = this.clips();
    if (clips.length === 0) return;
    const warp = this.warp();
    const hasVideo = this.hasVideo();
    const speed = hasVideo ? warp.speedAt(outputT) : 1;
    const frozen = hasVideo && warp.frozen(outputT);
    const hit = resolveBase(clips, warp.sourceAt(outputT));
    const activeIdx = hit ? hit.index : -1;
    const nextIdx = activeIdx >= 0 && activeIdx + 1 < clips.length ? activeIdx + 1 : -1;
    const when = this.audioCtx ? this.audioCtx.currentTime : 0;

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (clip.kind !== 'video') continue;
      const v = this.elOf(clip);
      if (!(v instanceof HTMLVideoElement)) continue;
      const audio = this.clipAudio.get(clip.srcId);
      const cap = Math.max(0, clip.srcDuration - 0.03);

      if (i === activeIdx && hit) {
        const target = Math.min(hit.sourceT, cap);
        if (frozen || !allowPlay) {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = Math.max(0, target);
        } else {
          const rate = Math.min(4, Math.max(0.0625, speed));
          if (v.playbackRate !== rate) v.playbackRate = rate;
          if (v.paused) void v.play().catch(() => undefined);
          // Correct only large drift (a fresh clip start already lands on target).
          if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = Math.max(0, target);
        }
        if (audio && this.audioCtx) {
          // Base = the clip's own automation curve at this clip-local instant
          // (hit.local == seconds from the in-point). Pitch-shifted / paused audio
          // is still silenced on a freeze or off-speed span, and mute wins outright.
          const suppressed = frozen || Math.abs(speed - 1) > 0.02 || clip.muted === true;
          const level = suppressed ? 0 : sampleVolume(clip.volume, hit.local);
          audio.gain.gain.setTargetAtTime(level, when, 0.01);
        }
      } else {
        if (!v.paused) v.pause();
        if (audio && this.audioCtx) audio.gain.gain.setTargetAtTime(0, when, 0.01);
        // Pre-roll the upcoming clip to its trim in-point so the cut is instant.
        if (i === nextIdx && Math.abs(v.currentTime - clip.in) > 0.1) {
          v.currentTime = Math.max(0, Math.min(clip.in, cap));
        }
      }
    }
  }

  /** Pause every clip video (lifecycle stop / teardown). */
  private pauseClipVideos(): void {
    for (const clip of this.clips()) {
      if (clip.kind !== 'video') continue;
      const v = this.elOf(clip);
      if (v instanceof HTMLVideoElement && !v.paused) v.pause();
    }
  }

  /**
   * A video sticker's local playback time (seconds into its own clip). It follows
   * the main sequence's WARPED base progression — so it slows / freezes with Time
   * Machine — and loops if its hold outlasts its own clip. Over an image-only main
   * sequence (no warp) it advances on raw output time.
   */
  private stickerLocalTime(el: { srcId: string; start: number; clipDur: number }, outputT: number): number {
    const hasVideoMain = this.hasVideo();
    const warp = this.warp();
    const now = hasVideoMain ? warp.sourceAt(outputT) : outputT;
    const startSrc = hasVideoMain ? warp.sourceAt(el.start) : el.start;
    const elapsed = Math.max(0, now - startSrc);
    return el.clipDur > 0 ? elapsed % el.clipDur : elapsed;
  }

  /**
   * Steer every VIDEO sticker's <video> so its frame matches OUTPUT time. While
   * playing/recording (`allowPlay`) it plays at the warp's instantaneous rate
   * (paused on a freeze), correcting only large drift; while paused/scrubbing it
   * seeks to the exact frame and redraws once the seek lands. Embedded audio is
   * always muted (sticker audio is a separate feature).
   */
  private driveStickerVideos(outputT: number, allowPlay: boolean): void {
    if (!this.getStickerMedia) return;
    const hasVideoMain = this.hasVideo();
    const warp = this.warp();
    const rate = hasVideoMain ? warp.speedAt(outputT) : 1;
    const frozen = hasVideoMain && warp.frozen(outputT);
    for (const layer of this.getProject().layers) {
      if (layer.kind !== 'sticker' || layer.el.source !== 'video') continue;
      const el = layer.el;
      const v = this.getStickerMedia(el.srcId);
      if (!(v instanceof HTMLVideoElement)) continue;
      v.muted = true;
      v.loop = true;
      const visible = outputT >= el.start && outputT < stickerEnd(el);
      if (!visible) {
        if (!v.paused) v.pause();
        continue;
      }
      const cap = el.clipDur > 0 ? Math.max(0, el.clipDur - 0.03) : 0;
      const target = Math.min(this.stickerLocalTime(el, outputT), cap);
      if (allowPlay && !frozen) {
        const r = Math.min(4, Math.max(0.0625, rate));
        if (v.playbackRate !== r) v.playbackRate = r;
        if (v.paused) void v.play().catch(() => undefined);
        if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.05) {
          const draw = () => {
            v.removeEventListener('seeked', draw);
            if (!this.playing) this.drawFrameAt(this.pausedT, false);
          };
          v.addEventListener('seeked', draw);
          v.currentTime = target;
        }
      }
    }
  }

  /** Pause every sticker video (lifecycle stop / teardown). */
  private pauseStickerVideos(): void {
    if (!this.getStickerMedia) return;
    for (const layer of this.getProject().layers) {
      if (layer.kind !== 'sticker' || layer.el.source !== 'video') continue;
      const v = this.getStickerMedia(layer.el.srcId);
      if (v instanceof HTMLVideoElement && !v.paused) v.pause();
    }
  }

  /** The current OUTPUT time as last resolved. */
  currentTimeSec(): number {
    return this.pausedT;
  }

  // ---- drawing ----

  private drawBase(outputT: number): void {
    const p = this.getProject();
    const hit = this.hitAt(outputT);
    if (!hit) return;
    const src = this.elOf(hit.clip);
    if (!src) return;
    const zoom = zoomLayer(p);
    if (zoom && zoom.keyframes.length > 0) {
      drawZoomed(this.ctx, src, this.out, rectAt(outputT, zoom.keyframes));
    } else {
      drawSource(this.ctx, src, this.out, p.fillMode);
    }
  }

  private fontFor(el: CaptionEl, outputT: number): BoilFont {
    if (el.kind === 'boil') {
      const pool = poolById(el.pool);
      const fi = boilFontIndex(el, (outputT - el.start) * 1000, pool.fonts.length);
      return pool.fonts[fi] ?? pool.fonts[0];
    }
    return fontByKey(el.fontKey);
  }

  /** Run `draw` with the context rotated by `rot` radians about (cx, cy) device px. */
  private withRotation(cx: number, cy: number, rot: number, draw: () => void): void {
    if (!rot) {
      draw();
      return;
    }
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(rot);
    this.ctx.translate(-cx, -cy);
    draw();
    this.ctx.restore();
  }

  /** Draw one caption layer + its attachments, and fire its SFX. */
  private drawCaptionLayer(
    layer: CaptionLayer,
    outputT: number,
    sfxOn: boolean,
    riffleOwnerId: string | null,
    when: number,
  ): void {
    const el = layer.el;
    if (outputT < el.start || outputT >= captionEnd(el)) return;

    if (el.kind === 'boil') {
      const pool = poolById(el.pool);
      const norm = el.normalize;
      const fi = boilFontIndex(el, (outputT - el.start) * 1000, pool.fonts.length);
      const font = pool.fonts[fi] ?? pool.fonts[0];
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, norm, 'below');
      drawCaption(this.ctx, this.out, el, font, norm, 1);
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, norm, 'above');
      if (sfxOn && el.sfx !== false && el.boil !== 'off') {
        const prev = this.lastFontIdx.get(el.id);
        if (prev === undefined) this.lastFontIdx.set(el.id, fi);
        else if (fi !== prev) {
          this.lastFontIdx.set(el.id, fi);
          if (el.id === riffleOwnerId) {
            this.sfx!.trigger('riffle', when);
            this.sfx!.trigger('riffle', when + 0.045);
          }
        }
      }
    } else {
      const font = fontByKey(el.fontKey);
      const prog = typewriterProgress(el, outputT);
      // Typewriters are single-font: no normalisation (matches drawTypewriter),
      // so attachment boxes line up with the drawn text.
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, false, 'below');
      drawTypewriter(this.ctx, this.out, el, font, prog);
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, false, 'above');
      if (sfxOn && el.sfx !== false) {
        if (prog.selectAll) {
          if (el.deleteEnabled && el.deleteStyle === 'selectAll' && !this.deleteCueFired.has(el.id)) {
            this.deleteCueFired.add(el.id);
            this.sfx!.trigger('key', when, 1.45);
            this.sfx!.trigger('key', when + 0.22, 1.45);
          }
        } else {
          const raw = el.text.replace(/\n/g, '').length;
          const count = Math.round(Math.max(0, Math.min(1, prog.revealFrac)) * raw);
          const prev = this.lastReveal.get(el.id);
          if (prev === undefined) this.lastReveal.set(el.id, count);
          else if (count !== prev) {
            const n = Math.min(3, Math.abs(count - prev));
            for (let k = 0; k < n; k++) this.sfx!.trigger('key', when + k * 0.012);
            this.lastReveal.set(el.id, count);
          }
        }
      }
    }
  }

  /** Composite one output frame at output time `outputT`. */
  private drawFrameAt(outputT: number, fireSfx: boolean): void {
    if (!this.loaded) return;
    this.syncOutputSize();
    const p = this.getProject();

    this.drawBase(outputT);

    if (this.sfx) this.sfx.setVolume(p.sfxEnabled ? p.sfxVolume : 0);
    const sfxOn = fireSfx && p.sfxEnabled && !!this.sfx;
    const when = this.audioCtx ? this.audioCtx.currentTime : 0;

    // one boil caption owns the riffle audio when several overlap
    const riffleOwnerId = sfxOn
      ? (overlayLayers(p).find(
          (l) =>
            l.kind === 'caption' &&
            l.el.kind === 'boil' &&
            l.el.sfx !== false &&
            l.el.boil !== 'off' &&
            outputT >= l.el.start &&
            outputT < captionEnd(l.el),
        ) as CaptionLayer | undefined)?.el.id ?? null
      : null;

    // zoom whooshes (base layer, but SFX fires regardless of paint order)
    const zoom = zoomLayer(p);
    if (sfxOn && zoom) {
      for (const kf of sortedZooms(zoom.keyframes)) {
        if (outputT >= kf.start && !this.firedWhoosh.has(kf.id)) {
          this.firedWhoosh.add(kf.id);
          if (kf.whoosh) this.sfx!.trigger('whoosh', when);
        }
      }
    }

    // time-machine (replay) whoosh: fire on each slow-mo / freeze ONSET — when the
    // free-form speed curve crosses down into slow motion between frames.
    const tm = timeMachineLayer(p);
    if (sfxOn && tm && tm.whoosh) {
      const prevS = speedAt(this.prevT, tm.points);
      const curS = speedAt(outputT, tm.points);
      if (prevS > SLOWMO_ENTER && curS <= SLOWMO_ENTER) this.sfx!.trigger('whoosh', when);
    }

    for (const layer of overlayLayers(p)) {
      if (layer.kind === 'caption') {
        // Rotate the whole caption (text + attachments) about its block centre.
        this.withRotation(layer.el.x * this.out.w, layer.el.y * this.out.h, layer.el.rotation, () =>
          this.drawCaptionLayer(layer, outputT, sfxOn, riffleOwnerId, when),
        );
      } else if (layer.kind === 'banner') {
        drawBanner(this.ctx, this.out, layer.style, bannerFrameAt(layer, outputT, performance.now() / 1000));
        if (sfxOn && layer.sfx && !this.firedEntrance && crossedLock(layer, this.prevT, outputT)) {
          this.firedEntrance = true;
          this.sfx!.trigger('entrance', when);
        }
      } else if (layer.kind === 'sketch') {
        const el = layer.el;
        if (outputT < el.start || outputT >= sketchEnd(el)) continue;
        const area = { x: el.x * this.out.w, y: el.y * this.out.h, w: el.w * this.out.w, h: el.h * this.out.h };
        this.withRotation(area.x + area.w / 2, area.y + area.h / 2, el.rotation, () =>
          drawSketch(this.ctx, area, el, outputT),
        );
        // Pencil-on-paper: fire grains at a fixed cadence during the draw phase.
        if (sfxOn && el.sound && el.animationDur > 0 && outputT - el.start < el.animationDur) {
          const last = this.lastPencil.get(el.id) ?? -Infinity;
          if (when - last >= PENCIL_INTERVAL) {
            this.sfx!.trigger('pencil', when);
            this.lastPencil.set(el.id, when);
          }
        }
      } else if (layer.kind === 'highlighter') {
        const el = layer.el;
        if (outputT < el.start || outputT >= highlightEnd(el)) continue;
        this.withRotation((el.x + el.w / 2) * this.out.w, (el.y + el.h / 2) * this.out.h, el.rotation, () =>
          drawHighlightBox(this.ctx, this.out, el, outputT),
        );
      } else if (layer.kind === 'dramatic') {
        const el = layer.el;
        if (outputT < el.start || outputT >= dramaticEnd(el)) continue;
        // inverse / reflection read the pixels already painted below this layer, so
        // drawDramaticWord rotates only its letter passes (not the frame sampling).
        drawDramaticWord(this.ctx, this.out, el, outputT);
      } else if (layer.kind === 'sticker') {
        const el = layer.el;
        if (outputT < el.start || outputT >= stickerEnd(el)) continue;
        const src = this.getStickerMedia?.(el.srcId);
        if (!src) continue;
        const box = { x: el.x * this.out.w, y: el.y * this.out.h, w: el.w * this.out.w, h: el.h * this.out.h };
        this.withRotation(box.x + box.w / 2, box.y + box.h / 2, el.rotation, () =>
          drawSticker(this.ctx, box, src, el.crop),
        );
      }
    }

    this.prevT = outputT;
  }

  /**
   * Draw the current frame without advancing (paused / after an edit). No SFX.
   * The active clip's <video> is seeked to the exact frame when it has drifted
   * (e.g. after a reorder / trim changes which clip shows at the cursor), redrawing
   * once the seek lands; other clips are paused.
   */
  renderStatic(): void {
    if (!this.loaded || this.editing) return;
    const sec = this.pausedT;
    this.driveStickerVideos(sec, false);
    const hit = this.hitAt(sec);
    const active = hit && hit.clip.kind === 'video' ? this.elOf(hit.clip) : null;
    this.pauseClipVideos();
    if (active instanceof HTMLVideoElement && hit) {
      const cap = Math.max(0, hit.clip.srcDuration - 0.03);
      const target = Math.max(0, Math.min(hit.sourceT, cap));
      if (Math.abs(active.currentTime - target) > 0.02) {
        const draw = () => {
          active.removeEventListener('seeked', draw);
          if (!this.playing) this.drawFrameAt(sec, false);
        };
        active.addEventListener('seeked', draw);
        active.currentTime = target;
      }
    }
    this.drawFrameAt(sec, false);
  }

  // ---- audio graph ----

  private ensureCtx(): AudioContext {
    if (!this.audioCtx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AC();
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  private ensureSfx(): void {
    const ctx = this.ensureCtx();
    if (!this.sfx) {
      this.sfx = new SfxEngine(ctx, this.getProject().sfxVolume);
      this.sfx.output.connect(ctx.destination);
      if (this.streamDest) this.sfx.output.connect(this.streamDest);
    }
  }

  /**
   * Route every VIDEO clip element through its own source→gain into a shared
   * stream destination (for the recorder) + the speakers. Each element can only
   * be wrapped once, so nodes are cached by srcId. driveClips raises only the
   * active, ~1× clip's gain, so the recorded audio hard-cuts at each boundary.
   * Returns the recorder stream (with all clip audio), or null if none.
   */
  private ensureClipAudio(): MediaStream | null {
    const clips = this.clips().filter((c) => c.kind === 'video');
    if (clips.length === 0) return null;
    const ctx = this.ensureCtx();
    if (!this.streamDest) this.streamDest = ctx.createMediaStreamDestination();
    for (const clip of clips) {
      if (this.clipAudio.has(clip.srcId)) continue;
      const v = this.elOf(clip);
      if (!(v instanceof HTMLVideoElement)) continue;
      try {
        const node = ctx.createMediaElementSource(v);
        const gain = ctx.createGain();
        gain.gain.value = 0; // driveClips brings the active clip up
        node.connect(gain);
        gain.connect(ctx.destination);
        gain.connect(this.streamDest);
        this.clipAudio.set(clip.srcId, { node, gain });
      } catch {
        /* element already wrapped elsewhere — skip */
      }
    }
    if (this.sfx) this.sfx.output.connect(this.streamDest);
    return this.streamDest.stream ?? null;
  }

  // ---- preview ----

  /** Start (or resume) preview playback from OUTPUT second `fromSec` (default 0). */
  playPreview(fromSec = 0): void {
    if (!this.loaded) return;
    this.stopLoop();
    this.recording = false;
    this.editing = false;
    this.ensureSfx();
    // Route base-clip audio through the per-clip gain graph in preview too, so the
    // volume-automation curve + mute are audible while previewing — exactly the
    // same nodes the export drives, so preview and the exported file always match.
    if (this.hasVideo()) this.ensureClipAudio();
    this.startPlayback(fromSec);
    this.loop();
  }

  private startPlayback(fromSec = 0): void {
    if (!this.loaded) return;
    this.firedEntrance = false;
    this.firedWhoosh.clear();
    this.lastFontIdx.clear();
    this.lastReveal.clear();
    this.deleteCueFired.clear();
    this.lastPencil.clear();

    const p = this.getProject();
    // Clamp the resume point; treat "at/after the end" as a fresh restart at 0.
    const total = this.totalSec();
    const start = fromSec > 0.02 && fromSec < total - 0.05 ? fromSec : 0;
    this.prevT = start;
    this.pausedT = start;
    this.playing = true;
    this.playStartOutput = start;
    this.playStartWall = performance.now();

    // Suppress SFX for cues whose trigger instant already elapsed before `start`.
    const banner = bannerLayer(p);
    if (banner && start >= banner.freeze) this.firedEntrance = true;
    const zoom = zoomLayer(p);
    if (zoom) for (const kf of zoom.keyframes) if (start >= kf.start) this.firedWhoosh.add(kf.id);
    // Time Machine whoosh is onset-based (prevT vs outputT), so nothing to pre-seed.

    // Steer clips to the start frame (pauses non-active, plays the active one).
    this.driveClips(start, true);
  }

  private loop = (): void => {
    if (!this.loaded) return;
    const outputT = this.computeOutputT();
    this.pausedT = outputT;

    if (outputT >= this.totalSec() - 1e-3) {
      if (this.recording) {
        this.playing = false;
        this.stopLoop();
        return;
      }
      this.startPlayback();
      this.driveClips(0, true);
      this.driveStickerVideos(0, true);
      this.drawFrameAt(0, false);
      this.onTime?.(0);
      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    this.driveClips(outputT, true);
    this.driveStickerVideos(outputT, true);
    this.drawFrameAt(outputT, true);
    this.onTime?.(outputT);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Seek to output time `sec` and draw the composited (not editing) frame. */
  scrubTo(sec: number): void {
    if (!this.loaded) return;
    this.stopLoop();
    this.playing = false;
    this.editing = false;
    this.prevT = sec;
    this.pausedT = sec;
    this.driveStickerVideos(sec, false);

    const hit = this.hitAt(sec);
    const activeVideo = hit && hit.clip.kind === 'video' ? this.elOf(hit.clip) : null;
    // Pause every clip; only the active one needs a seek to show its frame.
    this.pauseClipVideos();
    if (activeVideo instanceof HTMLVideoElement && hit) {
      const cap = Math.max(0, hit.clip.srcDuration - 0.03);
      // Record the latest target; only kick a seek if none is pending (otherwise
      // the in-flight seek's `seeked` handler will chase this newest value).
      this.scrubNext = { sec, video: activeVideo, currentTime: Math.max(0, Math.min(hit.sourceT, cap)) };
      if (!this.scrubSeeking) this.applyScrubSeek();
    } else {
      // Image / gap: nothing to seek — draw straight away and drop any pending seek.
      this.scrubNext = null;
      this.drawFrameAt(sec, false);
    }
  }

  /** Apply the latest pending scrub seek, chaining to any newer one on completion. */
  private applyScrubSeek(): void {
    const next = this.scrubNext;
    if (!next) return;
    this.scrubNext = null;
    // If the element is already at the target frame, no `seeked` fires — draw now.
    if (Math.abs(next.video.currentTime - next.currentTime) < 1e-3) {
      this.scrubSeeking = false;
      this.drawFrameAt(next.sec, false);
      if (this.scrubNext) this.applyScrubSeek();
      return;
    }
    this.scrubSeeking = true;
    const onSeeked = (): void => {
      next.video.removeEventListener('seeked', onSeeked);
      this.scrubSeeking = false;
      // A play/edit may have superseded the scrub while we were seeking; if so,
      // don't paint the stale frame — just let the newer mode own the canvas.
      if (this.playing || this.editing) {
        this.scrubNext = null;
        return;
      }
      this.drawFrameAt(next.sec, false);
      if (this.scrubNext) this.applyScrubSeek(); // chase the newest position
    };
    next.video.addEventListener('seeked', onSeeked);
    next.video.currentTime = next.currentTime;
  }

  // ---- zoom-rect edit view (always the full, un-zoomed source frame) ----

  editZoomAt(outputT: number): void {
    if (!this.loaded) return;
    this.stopLoop();
    this.playing = false;
    this.editing = true;
    this.pausedT = outputT;
    const hit = this.hitAt(outputT);
    if (!hit) return;
    const el = this.elOf(hit.clip);
    if (!el) return;
    if (el instanceof HTMLVideoElement) {
      const cap = Math.max(0, hit.clip.srcDuration - 0.03);
      this.pauseClipVideos();
      const draw = () => {
        this.syncOutputSize();
        drawZoomed(this.ctx, el, this.out, FULL_RECT);
        el.removeEventListener('seeked', draw);
      };
      el.addEventListener('seeked', draw);
      el.currentTime = Math.max(0, Math.min(hit.sourceT, cap));
    } else {
      this.syncOutputSize();
      drawZoomed(this.ctx, el, this.out, FULL_RECT);
    }
  }

  redrawEditZoom(): void {
    if (!this.loaded) return;
    this.editing = true;
    this.syncOutputSize();
    const el = this.activeEl(this.pausedT);
    if (el) drawZoomed(this.ctx, el, this.out, FULL_RECT);
  }

  exitEdit(): void {
    this.editing = false;
    this.renderStatic();
  }

  // ---- caption pointer helpers (normalised 0..1 coords) ----

  /** Top-most draggable overlay (any placeable kind) under a normalised point. */
  hitTestDraggable(nx: number, ny: number): string | null {
    if (!this.loaded) return null;
    const px = nx * this.out.w;
    const py = ny * this.out.h;
    const p = this.getProject();
    const overlays = overlayLayers(p);
    for (let i = overlays.length - 1; i >= 0; i--) {
      const layer = overlays[i];
      const b = this.boundsPx(layer.id);
      if (!b) continue;
      // Transform the point into the box's local (unrotated) frame about its centre.
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const rot = b.rotation;
      const dx = px - cx;
      const dy = py - cy;
      const c = Math.cos(-rot);
      const s = Math.sin(-rot);
      const lx = cx + dx * c - dy * s;
      const ly = cy + dx * s + dy * c;
      const pad = b.pad;
      if (lx >= b.left - pad && lx <= b.left + b.width + pad && ly >= b.top - pad && ly <= b.top + b.height + pad) {
        return layer.id;
      }
    }
    return null;
  }

  /** Placement bounds of any placeable overlay, in OUTPUT PIXELS, or null. */
  private boundsPx(
    layerId: string,
  ): { left: number; top: number; width: number; height: number; rotation: number; pad: number } | null {
    if (!this.loaded) return null;
    const p = this.getProject();
    const layer = p.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    if (layer.kind === 'sketch' || layer.kind === 'highlighter' || layer.kind === 'sticker') {
      const el = layer.el;
      return { left: el.x * this.out.w, top: el.y * this.out.h, width: el.w * this.out.w, height: el.h * this.out.h, rotation: el.rotation, pad: 0 };
    }
    if (layer.kind === 'caption') {
      const el = layer.el;
      const font = this.fontFor(el, this.currentTimeSec());
      const L = measureCaption(this.ctx, this.out, el, font, el.kind === 'boil' && el.normalize);
      return { left: L.left, top: L.top, width: L.blockW, height: L.blockH, rotation: el.rotation, pad: L.sizePx * 0.3 };
    }
    if (layer.kind === 'dramatic') {
      const L = dramaticWordLayout(this.ctx, this.out, layer.el);
      return { left: L.left, top: L.top, width: L.blockW, height: L.blockH, rotation: layer.el.rotation, pad: L.size * 0.25 };
    }
    return null;
  }

  /** Placement box (top-left + size) of any placeable overlay in output-NORMALISED coords. */
  boundsOf(layerId: string): { x: number; y: number; w: number; h: number } | null {
    const b = this.boundsPx(layerId);
    if (!b) return null;
    return { x: b.left / this.out.w, y: b.top / this.out.h, w: b.width / this.out.w, h: b.height / this.out.h };
  }

  boundsOfCaption(layerId: string): CaptionBounds | null {
    if (!this.loaded) return null;
    const p = this.getProject();
    const layer = p.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== 'caption') return null;
    const el = layer.el;
    const outputT = this.currentTimeSec();
    const font = this.fontFor(el, outputT);
    const L = measureCaption(this.ctx, this.out, el, font, el.kind === 'boil' && el.normalize);
    const pad = L.sizePx * 0.25;
    return { left: L.left - pad, top: L.top - pad, width: L.blockW + pad * 2, height: L.blockH + pad * 2 };
  }

  // ---- lifecycle ----

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  stop(): void {
    this.stopLoop();
    this.playing = false;
    this.pauseClipVideos();
    this.pauseStickerVideos();
  }

  // ---- export ----

  async record(onProgress?: (sec: number) => void): Promise<Blob> {
    if (!this.loaded) throw new Error('No media loaded');
    this.stopLoop();
    this.recording = true;
    this.editing = false;
    this.ensureSfx();

    const stream = this.canvas.captureStream(FPS);
    if (this.hasVideo()) {
      const audio = this.ensureClipAudio();
      audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
    } else if (this.sfx) {
      const dest = this.ensureCtx().createMediaStreamDestination();
      this.sfx.output.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start();
    this.startPlayback();
    const origOnTime = this.onTime;
    this.onTime = (sec) => {
      origOnTime?.(sec);
      onProgress?.(sec);
    };
    this.loop();

    // The loop stops itself (raf === 0) once the sequence reaches its end.
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (this.raf === 0 || !this.recording) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
    });

    recorder.stop();
    await stopped;
    this.onTime = origOnTime;
    this.recording = false;
    stream.getVideoTracks().forEach((t) => t.stop());
    return new Blob(chunks, { type: 'video/webm' });
  }

  destroy(): void {
    this.stop();
    try {
      for (const { node, gain } of this.clipAudio.values()) {
        node.disconnect();
        gain.disconnect();
      }
      this.streamDest?.disconnect();
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.clipAudio.clear();
    this.audioCtx = null;
    this.streamDest = null;
    this.sfx = null;
  }
}
