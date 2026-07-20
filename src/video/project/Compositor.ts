// ===== Unified compositor: one clock, one audio graph, one export =====
//
// Replaces the per-tool BannerPlayer / CaptionsPlayer / ZoomPlayer. Each frame it
//   1. resolves the OUTPUT time (freeze-aware clock),
//   2. draws the BASE frame — a zoom crop if a zoom layer exists, else the plain
//      aspect-composited source,
//   3. draws every OVERLAY layer in z-order (banner, captions, …) on top,
//   4. fires each layer's SFX.
// Preview playback, scrubbing, zoom-rect editing, and MP4 export all share this.

import {
  drawSource,
  drawZoomed,
  drawBanner,
  drawCaption,
  drawTypewriter,
  drawAttachmentsLayer,
  drawSketch,
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
import { elementEnd as sketchEnd } from '../sketch/types';
import { elementEnd as highlightEnd } from '../highlight/types';
import { elementEnd as dramaticEnd } from '../dramatic/types';
import type { Project, CaptionLayer } from './types';
import { bannerLayer, zoomLayer, overlayLayers, layerSpan } from './types';

/** Seconds between pencil-on-paper grains while a sketch animates. */
const PENCIL_INTERVAL = 0.06;
import {
  bannerFrameAt,
  crossedLock,
  freezeSpecOf,
  outputDurationFor,
  sourceTimeAt,
} from './timeMap';

const FPS = 30;

export type MediaKind = 'video' | 'image';

export interface LoadedMedia {
  kind: MediaKind;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  duration: number;
}

export interface CaptionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Phase = 'idle' | 'pre' | 'freeze' | 'post' | 'play';

export class Compositor {
  private ctx: CanvasRenderingContext2D;
  private out: OutputSize = { w: 2, h: 2 };
  private media: LoadedMedia | null = null;
  private raf = 0;
  private recording = false;
  private editing = false; // zoom-rect edit view (full un-zoomed frame)

  // clock
  private phase: Phase = 'idle';
  private imgStart = 0;
  private freezeWallStart = 0;
  private prevT = 0;
  /** Last resolved OUTPUT time — what a static redraw / hit-test uses while paused. */
  private pausedT = 0;

  // audio
  private audioCtx: AudioContext | null = null;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private sfx: SfxEngine | null = null;

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

  constructor(
    canvas: HTMLCanvasElement,
    getProject: () => Project,
    onTime?: (outputSec: number) => void,
  ) {
    this.canvas = canvas;
    this.getProject = getProject;
    this.onTime = onTime;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  attach(media: LoadedMedia): void {
    this.stop();
    this.media = media;
    this.syncOutputSize();
    this.renderStatic();
  }

  get outputSize(): OutputSize {
    return this.out;
  }

  sourceDims(): { w: number; h: number } {
    if (!this.media) return { w: 0, h: 0 };
    if (this.media.video) return { w: this.media.video.videoWidth, h: this.media.video.videoHeight };
    return { w: this.media.image!.naturalWidth, h: this.media.image!.naturalHeight };
  }

  private syncOutputSize(): void {
    if (!this.media) return;
    const { w: sw, h: sh } = this.sourceDims();
    const size = outputSizeFor(this.getProject().ratio, sw, sh);
    if (size.w !== this.out.w || size.h !== this.out.h) {
      this.out = size;
      this.canvas.width = size.w;
      this.canvas.height = size.h;
    }
  }

  /** Total OUTPUT duration in seconds (clip + any banner hold, or the image length). */
  totalSec(): number {
    if (!this.media) return 0;
    const p = this.getProject();
    const spec = freezeSpecOf(bannerLayer(p));
    if (this.media.kind === 'video') return outputDurationFor(this.media.duration, spec);
    if (p.imageDuration && p.imageDuration > 0) return p.imageDuration;
    const ends = p.layers.map((l) => layerSpan(l).end);
    return Math.max(3, ...ends, spec ? spec.freeze + spec.hold + 0.5 : 0);
  }

  // ---- clock ----

  /** Wall/video-derived OUTPUT time for the current frame, advancing the freeze phase. */
  private computeOutputT(): number {
    if (!this.media) return 0;
    if (this.media.kind === 'image') return (performance.now() - this.imgStart) / 1000;

    const v = this.media.video!;
    const spec = freezeSpecOf(bannerLayer(this.getProject()));
    if (!spec) return v.currentTime;

    const { freeze: f, hold: h } = spec;
    const now = performance.now();
    if (this.phase === 'pre') {
      if (v.currentTime >= f || v.ended) {
        v.pause();
        this.phase = 'freeze';
        this.freezeWallStart = now;
        return f;
      }
      return v.currentTime;
    }
    if (this.phase === 'freeze') {
      const ft = f + (now - this.freezeWallStart) / 1000;
      if (ft >= f + h) {
        this.phase = 'post';
        void v.play().catch(() => undefined);
        return f + h;
      }
      return ft;
    }
    if (this.phase === 'post') return v.currentTime + h;
    return v.currentTime;
  }

  /** The current OUTPUT time as last resolved (never advances the phase machine). */
  currentTimeSec(): number {
    return this.pausedT;
  }

  // ---- drawing ----

  private currentSource(): HTMLVideoElement | HTMLImageElement {
    return this.media!.video ?? this.media!.image!;
  }

  private drawBase(outputT: number): void {
    const p = this.getProject();
    const src = this.currentSource();
    const zoom = zoomLayer(p);
    if (zoom && zoom.keyframes.length > 0) {
      drawZoomed(this.ctx, src, this.out, rectAt(outputT, zoom.keyframes));
    } else {
      drawSource(this.ctx, src, this.out, p.fillMode);
    }
  }

  private fontFor(el: CaptionEl, outputT: number, boilPool: Project['boilPool']): BoilFont {
    if (el.kind === 'boil') {
      const pool = poolById(boilPool);
      const fi = boilFontIndex(el, (outputT - el.start) * 1000, pool.fonts.length);
      return pool.fonts[fi] ?? pool.fonts[0];
    }
    return fontByKey(el.fontKey);
  }

  /** Draw one caption layer + its attachments, and fire its SFX. */
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

  private drawCaptionLayer(
    layer: CaptionLayer,
    outputT: number,
    p: Project,
    sfxOn: boolean,
    riffleOwnerId: string | null,
    when: number,
  ): void {
    const el = layer.el;
    if (outputT < el.start || outputT >= captionEnd(el)) return;
    const pool = poolById(p.boilPool);

    if (el.kind === 'boil') {
      const fi = boilFontIndex(el, (outputT - el.start) * 1000, pool.fonts.length);
      const font = pool.fonts[fi] ?? pool.fonts[0];
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, p.normalize, 'below');
      drawCaption(this.ctx, this.out, el, font, p.normalize, 1);
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, p.normalize, 'above');
      if (sfxOn && el.boil !== 'off') {
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
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, p.normalize, 'below');
      drawTypewriter(this.ctx, this.out, el, font, prog);
      drawAttachmentsLayer(this.ctx, this.out, el, font, outputT, p.normalize, 'above');
      if (sfxOn) {
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
    if (!this.media) return;
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

    for (const layer of overlayLayers(p)) {
      if (layer.kind === 'caption') {
        // Rotate the whole caption (text + attachments) about its block centre.
        this.withRotation(layer.el.x * this.out.w, layer.el.y * this.out.h, layer.el.rotation, () =>
          this.drawCaptionLayer(layer, outputT, p, sfxOn, riffleOwnerId, when),
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
      }
    }

    this.prevT = outputT;
  }

  /** Draw the current frame without advancing (paused / after a seek). No SFX. */
  renderStatic(): void {
    if (!this.media || this.editing) return;
    this.drawFrameAt(this.pausedT, false);
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

  private ensureAudio(): MediaStream | null {
    if (!this.media?.video) return null;
    const ctx = this.ensureCtx();
    if (!this.streamDest) {
      this.srcNode = ctx.createMediaElementSource(this.media.video);
      this.streamDest = ctx.createMediaStreamDestination();
      // Audible during preview AND a continuous timeline for the recorder, so the
      // frozen (paused-video) gap stays A/V-synced.
      this.srcNode.connect(ctx.destination);
      this.srcNode.connect(this.streamDest);
      this.sfx?.output.connect(this.streamDest);
    }
    return this.streamDest.stream ?? null;
  }

  // ---- preview ----

  /** Start (or resume) preview playback from OUTPUT second `fromSec` (default 0). */
  playPreview(fromSec = 0): void {
    if (!this.media) return;
    this.stopLoop();
    this.recording = false;
    this.editing = false;
    this.ensureSfx();
    this.startPlayback(fromSec);
    this.loop();
  }

  private startPlayback(fromSec = 0): void {
    if (!this.media) return;
    this.firedEntrance = false;
    this.firedWhoosh.clear();
    this.lastFontIdx.clear();
    this.lastReveal.clear();
    this.deleteCueFired.clear();
    this.lastPencil.clear();

    const p = this.getProject();
    const spec = freezeSpecOf(bannerLayer(p));
    // Clamp the resume point; treat "at/after the end" as a fresh restart at 0.
    const total = this.totalSec();
    const start = fromSec > 0.02 && fromSec < total - 0.05 ? fromSec : 0;
    this.prevT = start;
    this.pausedT = start;

    // Suppress SFX for cues whose trigger instant already elapsed before `start`.
    if (spec && start >= spec.freeze) this.firedEntrance = true;
    const zoom = zoomLayer(p);
    if (zoom) for (const kf of zoom.keyframes) if (start >= kf.start) this.firedWhoosh.add(kf.id);

    if (this.media.kind === 'video' && this.media.video) {
      const v = this.media.video;
      const cap = Math.max(0, this.media.duration - 0.03);
      v.pause();
      if (!spec) {
        this.phase = 'play';
        v.currentTime = Math.min(start, cap);
        void v.play().catch(() => undefined);
      } else if (start < spec.freeze) {
        this.phase = 'pre';
        v.currentTime = Math.min(start, cap);
        void v.play().catch(() => undefined);
      } else if (start < spec.freeze + spec.hold) {
        // Resuming mid-freeze: hold on the freeze frame (video paused) for the
        // remaining hold, then the freeze→post transition resumes the clip.
        this.phase = 'freeze';
        this.freezeWallStart = performance.now() - (start - spec.freeze) * 1000;
        v.currentTime = Math.min(spec.freeze, cap);
      } else {
        this.phase = 'post';
        v.currentTime = Math.min(start - spec.hold, cap);
        void v.play().catch(() => undefined);
      }
    } else {
      this.phase = 'play';
      this.imgStart = performance.now() - start * 1000;
    }
  }

  private loop = (): void => {
    if (!this.media) return;
    const outputT = this.computeOutputT();
    this.pausedT = outputT;

    const ended =
      this.media.kind === 'video'
        ? this.media.video!.ended && (this.phase === 'post' || this.phase === 'play')
        : outputT >= this.totalSec();

    if (ended) {
      if (this.recording) {
        this.stopLoop();
        return;
      }
      this.startPlayback();
      this.drawFrameAt(0, false);
      this.onTime?.(0);
      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    this.drawFrameAt(outputT, true);
    this.onTime?.(outputT);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Seek to output time `sec` and draw the composited (not editing) frame. */
  scrubTo(sec: number): void {
    if (!this.media) return;
    this.stopLoop();
    this.editing = false;
    this.phase = 'idle';
    this.prevT = sec;
    this.pausedT = sec;
    const spec = freezeSpecOf(bannerLayer(this.getProject()));
    const srcT = sourceTimeAt(sec, spec);
    if (this.media.kind === 'video' && this.media.video) {
      const v = this.media.video;
      v.pause();
      const draw = () => {
        this.drawFrameAt(sec, false);
        v.removeEventListener('seeked', draw);
      };
      v.addEventListener('seeked', draw);
      v.currentTime = Math.max(0, Math.min(srcT, this.media.duration - 0.03));
    } else {
      this.imgStart = performance.now() - sec * 1000;
      this.drawFrameAt(sec, false);
    }
  }

  // ---- zoom-rect edit view (always the full, un-zoomed source frame) ----

  editZoomAt(outputT: number): void {
    if (!this.media) return;
    this.stopLoop();
    this.editing = true;
    this.pausedT = outputT;
    const spec = freezeSpecOf(bannerLayer(this.getProject()));
    const srcT = sourceTimeAt(outputT, spec);
    if (this.media.video) {
      const v = this.media.video;
      v.pause();
      const draw = () => {
        this.syncOutputSize();
        drawZoomed(this.ctx, v, this.out, FULL_RECT);
        v.removeEventListener('seeked', draw);
      };
      v.addEventListener('seeked', draw);
      v.currentTime = Math.max(0, Math.min(srcT, this.media.duration - 0.03));
    } else {
      this.imgStart = performance.now() - outputT * 1000;
      this.syncOutputSize();
      drawZoomed(this.ctx, this.media.image!, this.out, FULL_RECT);
    }
  }

  redrawEditZoom(): void {
    if (!this.media) return;
    this.editing = true;
    this.syncOutputSize();
    drawZoomed(this.ctx, this.currentSource(), this.out, FULL_RECT);
  }

  exitEdit(): void {
    this.editing = false;
    this.renderStatic();
  }

  // ---- caption pointer helpers (normalised 0..1 coords) ----

  /** Top-most draggable overlay (any placeable kind) under a normalised point. */
  hitTestDraggable(nx: number, ny: number): string | null {
    if (!this.media) return null;
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
    if (!this.media) return null;
    const p = this.getProject();
    const layer = p.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    if (layer.kind === 'sketch' || layer.kind === 'highlighter') {
      const el = layer.el;
      return { left: el.x * this.out.w, top: el.y * this.out.h, width: el.w * this.out.w, height: el.h * this.out.h, rotation: el.rotation, pad: 0 };
    }
    if (layer.kind === 'caption') {
      const el = layer.el;
      const font = this.fontFor(el, this.currentTimeSec(), p.boilPool);
      const L = measureCaption(this.ctx, this.out, el, font, el.kind === 'boil' && p.normalize);
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
    if (!this.media) return null;
    const p = this.getProject();
    const layer = p.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== 'caption') return null;
    const el = layer.el;
    const outputT = this.currentTimeSec();
    const font = this.fontFor(el, outputT, p.boilPool);
    const L = measureCaption(this.ctx, this.out, el, font, el.kind === 'boil' && p.normalize);
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
    this.phase = 'idle';
    if (this.media?.video) this.media.video.pause();
  }

  // ---- export ----

  async record(onProgress?: (sec: number) => void): Promise<Blob> {
    if (!this.media) throw new Error('No media loaded');
    this.stopLoop();
    this.recording = true;
    this.editing = false;
    this.ensureSfx();

    const stream = this.canvas.captureStream(FPS);
    if (this.media.kind === 'video') {
      const audio = this.ensureAudio();
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

    // The loop stops itself (raf === 0) once the source reaches its end.
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
      this.srcNode?.disconnect();
      this.streamDest?.disconnect();
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
    this.srcNode = null;
    this.streamDest = null;
    this.sfx = null;
    this.media = null;
  }
}
