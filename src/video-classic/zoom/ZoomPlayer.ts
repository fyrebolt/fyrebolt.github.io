// ===== Zoom engine: interpolated crop rendering + edit view + export =====

import { drawZoomed, outputSizeFor } from '../render';
import type { OutputSize, RatioKey } from '../types';
import type { ZoomKeyframe } from './types';
import { FULL_RECT, rectAt, sortedZooms } from './types';
import { SfxEngine } from '../sfx';

const FPS = 30;

export type MediaKind = 'video' | 'image';

export interface LoadedMedia {
  kind: MediaKind;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  duration: number;
}

export interface ZoomState {
  keyframes: ZoomKeyframe[];
  ratio: RatioKey;
  sfxVolume: number;
  /**
   * For image sources, a fixed total output length (seconds). When set, this is
   * the timeline/export length — so holds before and after the zooms are kept.
   * Omitted for video (which uses the clip's own duration) and for the original
   * Zoom tool (which derives the length from the last keyframe).
   */
  imageDuration?: number;
}

/**
 * Renders the source with the interpolated zoom crop during playback, and the
 * full (un-zoomed) source while a keyframe is being edited.
 */
export class ZoomPlayer {
  private ctx: CanvasRenderingContext2D;
  private out: OutputSize = { w: 2, h: 2 };
  private media: LoadedMedia | null = null;
  private raf = 0;
  private imgStart = 0;
  private recording = false;
  private editing = false;

  private audioCtx: AudioContext | null = null;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private sfx: SfxEngine | null = null;
  private firedWhoosh = new Set<string>();

  private canvas: HTMLCanvasElement;
  private getState: () => ZoomState;
  private onTime?: (sec: number) => void;

  constructor(canvas: HTMLCanvasElement, getState: () => ZoomState, onTime?: (sec: number) => void) {
    this.canvas = canvas;
    this.getState = getState;
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

  private syncOutputSize(): void {
    if (!this.media) return;
    const { ratio } = this.getState();
    const { w: sw, h: sh } = this.sourceDims();
    const size = outputSizeFor(ratio, sw, sh);
    if (size.w !== this.out.w || size.h !== this.out.h) {
      this.out = size;
      this.canvas.width = size.w;
      this.canvas.height = size.h;
    }
  }

  sourceDims(): { w: number; h: number } {
    if (!this.media) return { w: 0, h: 0 };
    if (this.media.video) return { w: this.media.video.videoWidth, h: this.media.video.videoHeight };
    return { w: this.media.image!.naturalWidth, h: this.media.image!.naturalHeight };
  }

  get outputSize(): OutputSize {
    return this.out;
  }

  totalSec(): number {
    if (!this.media) return 0;
    if (this.media.kind === 'video') return this.media.duration;
    const state = this.getState();
    if (state.imageDuration && state.imageDuration > 0) return state.imageDuration;
    const ends = state.keyframes.map((k) => k.start + k.duration);
    return Math.max(3, ...ends);
  }

  private nowSec(): number {
    if (!this.media) return 0;
    if (this.media.video) return this.media.video.currentTime;
    return (performance.now() - this.imgStart) / 1000;
  }

  currentTimeSec(): number {
    return this.nowSec();
  }

  private drawFrameAt(sec: number, fireSfx = false): void {
    if (!this.media) return;
    this.syncOutputSize();
    const state = this.getState();
    const src = this.media.video ?? this.media.image!;
    drawZoomed(this.ctx, src, this.out, rectAt(sec, state.keyframes));

    if (this.sfx) this.sfx.setVolume(state.sfxVolume);
    if (fireSfx && this.sfx) {
      for (const kf of sortedZooms(state.keyframes)) {
        if (sec >= kf.start && !this.firedWhoosh.has(kf.id)) {
          this.firedWhoosh.add(kf.id);
          if (kf.whoosh) this.sfx.trigger('whoosh', this.audioCtx?.currentTime);
        }
      }
    }
  }

  /** Playback frame at the current time (paused / after a normal seek). */
  renderStatic(): void {
    if (this.editing) return; // don't clobber the edit view
    this.drawFrameAt(this.nowSec(), false);
  }

  // ---- edit view: always the full, un-zoomed source ----

  /** Seek to `sec` and show the full source frame (for editing a keyframe's rect). */
  editAt(sec: number): void {
    if (!this.media) return;
    this.stopLoop();
    this.editing = true;
    if (this.media.video) {
      const v = this.media.video;
      v.pause();
      const draw = () => {
        this.syncOutputSize();
        drawZoomed(this.ctx, v, this.out, FULL_RECT);
        v.removeEventListener('seeked', draw);
      };
      v.addEventListener('seeked', draw);
      v.currentTime = Math.max(0, Math.min(sec, this.media.duration - 0.03));
    } else {
      this.imgStart = performance.now() - sec * 1000;
      this.syncOutputSize();
      drawZoomed(this.ctx, this.media.image!, this.out, FULL_RECT);
    }
  }

  /** Redraw the full source frame at the current time (during live rect editing). */
  redrawEdit(): void {
    if (!this.media) return;
    this.editing = true;
    this.syncOutputSize();
    const src = this.media.video ?? this.media.image!;
    drawZoomed(this.ctx, src, this.out, FULL_RECT);
  }

  exitEdit(): void {
    this.editing = false;
    this.renderStatic();
  }

  /** Seek + show the zoomed playback frame (not editing). */
  scrubTo(sec: number): void {
    if (!this.media) return;
    this.stopLoop();
    this.editing = false;
    if (this.media.video) {
      const v = this.media.video;
      v.pause();
      const draw = () => {
        this.drawFrameAt(v.currentTime, false);
        v.removeEventListener('seeked', draw);
      };
      v.addEventListener('seeked', draw);
      v.currentTime = Math.max(0, Math.min(sec, this.media.duration - 0.03));
    } else {
      this.imgStart = performance.now() - sec * 1000;
      this.drawFrameAt(sec, false);
    }
  }

  // ---- audio ----

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
      this.sfx = new SfxEngine(ctx, this.getState().sfxVolume);
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
    this.editing = false;
    this.ensureSfx();
    this.startPlayback();
    this.loop();
  }

  private startPlayback(): void {
    if (!this.media) return;
    this.firedWhoosh.clear();
    if (this.media.video) {
      this.media.video.currentTime = 0;
      void this.media.video.play().catch(() => undefined);
    } else {
      this.imgStart = performance.now();
    }
  }

  private loop = (): void => {
    if (!this.media) return;
    let sec = this.nowSec();
    if (this.media.kind === 'video') {
      if (this.media.video!.ended) {
        if (this.recording) {
          this.stopLoop();
          return;
        }
        this.startPlayback();
        sec = 0;
      }
    } else {
      const total = this.totalSec();
      if (sec >= total) {
        if (this.recording) {
          this.stopLoop();
          return;
        }
        this.imgStart = performance.now();
        sec = 0;
      }
    }
    this.drawFrameAt(sec, true);
    this.onTime?.(sec);
    this.raf = requestAnimationFrame(this.loop);
  };

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  stop(): void {
    this.stopLoop();
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
