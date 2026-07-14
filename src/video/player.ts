// ===== Banner player: freeze-frame sequence, preview loop, and export recording =====

import { drawBanner, drawSource, easeOutBack, outputSizeFor } from './render';
import { POSITION_ANCHORS } from './types';
import type { BannerFrame, EditorConfig, OutputSize } from './types';
import { SfxEngine } from './sfx';

const FPS = 30;
const FLASH_MS = 150;

export type MediaKind = 'video' | 'image';

export interface LoadedMedia {
  kind: MediaKind;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  /** Duration in seconds (Infinity/0 for images). */
  duration: number;
}

type Phase = 'idle' | 'pre' | 'hold' | 'post' | 'done';

/**
 * Drives the canvas: composites the source to the output frame, runs the
 * banner sequence, and records exports. The sequence is:
 *   play → banner slides in → video freezes as it locks (white flash) →
 *   banner holds → banner fades out AND video resumes at the same instant → play to end.
 */
export class BannerPlayer {
  private ctx: CanvasRenderingContext2D;
  private out: OutputSize = { w: 2, h: 2 };
  private media: LoadedMedia | null = null;
  private phase: Phase = 'idle';
  private raf = 0;

  // real-time clocks (ms)
  private holdStart = 0;
  private flashStart = 0;
  private fadeStart = 0;
  private imgStart = 0;

  private recording = false;

  // audio graph (built lazily, reused)
  private audioCtx: AudioContext | null = null;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private sfx: SfxEngine | null = null;
  private slashFired = false;

  private canvas: HTMLCanvasElement;
  private getConfig: () => EditorConfig;
  private onTime?: (currentSec: number, phase: Phase) => void;

  constructor(
    canvas: HTMLCanvasElement,
    getConfig: () => EditorConfig,
    onTime?: (currentSec: number, phase: Phase) => void,
  ) {
    this.canvas = canvas;
    this.getConfig = getConfig;
    this.onTime = onTime;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  attach(media: LoadedMedia): void {
    this.stop();
    this.media = media;
    this.syncOutputSize();
    // Draw a first static frame so the preview isn't blank before playback.
    this.renderStatic();
  }

  private syncOutputSize(): void {
    if (!this.media) return;
    const cfg = this.getConfig();
    const sw = this.media.video ? this.media.video.videoWidth : this.media.image!.naturalWidth;
    const sh = this.media.video ? this.media.video.videoHeight : this.media.image!.naturalHeight;
    const size = outputSizeFor(cfg.ratio, sw, sh);
    if (size.w !== this.out.w || size.h !== this.out.h) {
      this.out = size;
      this.canvas.width = size.w;
      this.canvas.height = size.h;
    }
  }

  /** Draw the current source frame + banner state without advancing anything. */
  private renderStatic(frame?: BannerFrame): void {
    if (!this.media) return;
    this.syncOutputSize();
    const cfg = this.getConfig();
    const src = this.media.video ?? this.media.image!;
    drawSource(this.ctx, src, this.out, cfg.fillMode);
    if (frame) drawBanner(this.ctx, this.out, cfg.style, frame);
  }

  // ---- audio graph ----

  private ensureCtx(): AudioContext {
    if (!this.audioCtx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AC();
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  /** Build the SFX engine (shared context). Does NOT route the media element,
   *  so preview playback isn't tied to the AudioContext. Call on a gesture. */
  private ensureSfx(): void {
    const ctx = this.ensureCtx();
    if (!this.sfx) {
      this.sfx = new SfxEngine(ctx, 0.5);
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
      // Audible during preview AND a continuous timeline for the recorder,
      // so the paused-video gap stays A/V-synced.
      this.srcNode.connect(ctx.destination);
      this.srcNode.connect(this.streamDest);
      this.sfx?.output.connect(this.streamDest);
    }
    return this.streamDest.stream ?? null;
  }

  // ---- preview ----

  playPreview(): void {
    if (!this.media) return;
    this.stopLoop();
    this.recording = false;
    this.ensureSfx();
    this.startSequence();
    this.loop();
  }

  private startSequence(): void {
    if (!this.media) return;
    this.phase = 'pre';
    this.slashFired = false;
    if (this.media.kind === 'video' && this.media.video) {
      // Note: the audio graph is built lazily only for export (record()), not
      // preview — a MediaElementAudioSourceNode ties the element's clock to the
      // AudioContext, so keeping preview off it avoids suspended-context stalls.
      this.media.video.pause();
      this.media.video.currentTime = 0;
      void this.media.video.play().catch(() => undefined);
    } else {
      this.imgStart = performance.now();
    }
  }

  /** Show the exact freeze frame with the banner locked (used while scrubbing). */
  scrubTo(sec: number): void {
    if (!this.media) return;
    this.stopLoop();
    this.phase = 'idle';
    const cfg = this.getConfig();
    const locked: BannerFrame = {
      slide: 1,
      alpha: 1,
      flash: 0,
      anchor: POSITION_ANCHORS[cfg.position],
    };
    if (this.media.kind === 'video' && this.media.video) {
      const v = this.media.video;
      v.pause();
      const draw = () => {
        this.renderStatic(locked);
        v.removeEventListener('seeked', draw);
      };
      v.addEventListener('seeked', draw);
      v.currentTime = Math.max(0, Math.min(sec, this.media.duration - 0.03));
    } else {
      this.renderStatic(locked);
    }
  }

  // ---- frame computation ----

  /** Fire the entrance slash once per sequence, when the slide-in begins. */
  private maybeSlash(cfg: EditorConfig): void {
    if (this.slashFired) return;
    this.slashFired = true;
    if (cfg.sfxEnabled && this.sfx) this.sfx.trigger('slash', this.audioCtx?.currentTime);
  }

  private frameForVideo(): BannerFrame {
    const cfg = this.getConfig();
    const v = this.media!.video!;
    const dur = this.media!.duration;
    const anchor = POSITION_ANCHORS[cfg.position];
    const freezeSec = Math.max(0, Math.min(cfg.timing.freeze / 1000, dur - 0.05));
    const slideInSec = Math.max(0.05, cfg.timing.slideIn / 1000);
    const slideStart = Math.max(0, freezeSec - slideInSec);
    const effDur = Math.max(0.05, freezeSec - slideStart);
    const now = performance.now();

    if (this.phase === 'pre') {
      const ct = v.currentTime;
      if (v.ended) {
        this.phase = 'done';
        return { slide: 0, alpha: 0, flash: 0, anchor };
      }
      if (ct >= freezeSec) {
        // Lock: freeze the video (and its audio) exactly as the banner arrives.
        v.pause();
        this.phase = 'hold';
        this.holdStart = now;
        this.flashStart = now;
        return { slide: 1, alpha: 1, flash: 1, anchor };
      }
      if (ct < slideStart) return { slide: 0, alpha: 0, flash: 0, anchor };
      this.maybeSlash(cfg); // slide-in has begun
      const p = (ct - slideStart) / effDur;
      return { slide: easeOutBack(Math.min(1, p)), alpha: 1, flash: 0, anchor };
    }

    if (this.phase === 'hold') {
      const held = now - this.holdStart;
      const flash = Math.max(0, 1 - (now - this.flashStart) / FLASH_MS);
      if (held >= cfg.timing.hold) {
        // Fade-out begins AND the video resumes at the same instant.
        this.phase = 'post';
        this.fadeStart = now;
        void v.play().catch(() => undefined);
        return { slide: 1, alpha: 1, flash: 0, anchor };
      }
      return { slide: 1, alpha: 1, flash, anchor };
    }

    if (this.phase === 'post') {
      const fadeElapsed = now - this.fadeStart;
      const alpha = Math.max(0, 1 - fadeElapsed / Math.max(1, cfg.timing.fadeOut));
      if (v.ended) this.phase = 'done';
      return { slide: 1, alpha, flash: 0, anchor };
    }

    return { slide: 0, alpha: 0, flash: 0, anchor };
  }

  private frameForImage(): BannerFrame {
    const cfg = this.getConfig();
    const anchor = POSITION_ANCHORS[cfg.position];
    const t = performance.now() - this.imgStart;
    const { freeze, slideIn, hold, fadeOut, total } = cfg.timing;
    const lock = freeze + slideIn;

    if (t >= total) {
      this.phase = 'done';
      return { slide: 0, alpha: 0, flash: 0, anchor };
    }
    if (t < freeze) return { slide: 0, alpha: 0, flash: 0, anchor };
    if (t < lock) {
      this.maybeSlash(cfg); // slide-in has begun
      return { slide: easeOutBack((t - freeze) / Math.max(1, slideIn)), alpha: 1, flash: 0, anchor };
    }
    const flash = Math.max(0, 1 - (t - lock) / FLASH_MS);
    if (t < lock + hold) return { slide: 1, alpha: 1, flash, anchor };
    const fadeElapsed = t - (lock + hold);
    const alpha = Math.max(0, 1 - fadeElapsed / Math.max(1, fadeOut));
    return { slide: 1, alpha, flash: 0, anchor };
  }

  private loop = (): void => {
    if (!this.media) return;
    this.syncOutputSize();
    const cfg = this.getConfig();
    const src = this.media.video ?? this.media.image!;
    drawSource(this.ctx, src, this.out, cfg.fillMode);
    if (this.sfx) this.sfx.setVolume(cfg.sfxEnabled ? cfg.sfxVolume : 0);

    const frame = this.media.kind === 'video' ? this.frameForVideo() : this.frameForImage();
    drawBanner(this.ctx, this.out, cfg.style, frame);

    const curSec = this.media.video ? this.media.video.currentTime : (performance.now() - this.imgStart) / 1000;
    this.onTime?.(curSec, this.phase);

    if (this.phase === 'done') {
      if (this.recording) {
        this.stopLoop();
        return; // export resolves via the recorder's stop handler
      }
      // preview: loop the whole sequence
      this.startSequence();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

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

  /** Record one full pass of the sequence and return the raw WebM blob. */
  async record(onFrameStats?: (sec: number) => void): Promise<Blob> {
    if (!this.media) throw new Error('No media loaded');
    this.stopLoop();
    this.recording = true;
    this.ensureSfx();

    const stream = this.canvas.captureStream(FPS);
    if (this.media.kind === 'video') {
      const audio = this.ensureAudio();
      audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
    } else if (this.sfx) {
      // Image mode has no video audio; capture the SFX bus alone.
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
    this.startSequence();

    // Drive the loop; onTime forwards playback position for progress reporting.
    const origOnTime = this.onTime;
    this.onTime = (sec, ph) => {
      origOnTime?.(sec, ph);
      onFrameStats?.(sec);
    };
    this.loop();

    // Wait for the sequence to finish (loop stops itself when phase === 'done').
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.phase === 'done' || !this.recording) resolve();
        else setTimeout(check, 50);
      };
      check();
    });

    recorder.stop();
    await stopped;
    this.onTime = origOnTime;
    this.recording = false;

    // Drop the recorder's canvas-stream tracks (leave the media element intact).
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
    this.media = null;
  }
}
