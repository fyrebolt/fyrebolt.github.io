// ===== Captions engine: compositing + timed caption rendering + export =====

import { drawSource, measureCaption, drawCaption, outputSizeFor } from '../render';
import type { FillMode, OutputSize, RatioKey } from '../types';
import type { Caption } from './types';
import { boilFontIndex } from './types';
import type { BoilPoolId } from './fonts';
import { poolById } from './fonts';

const FPS = 30;

export type MediaKind = 'video' | 'image';

export interface LoadedMedia {
  kind: MediaKind;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  duration: number;
}

export interface CaptionsState {
  captions: Caption[];
  fillMode: FillMode;
  ratio: RatioKey;
  boilPool: BoilPoolId;
  normalize: boolean;
}

export interface CaptionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Plays the source straight through and renders each caption over its time range. */
export class CaptionsPlayer {
  private ctx: CanvasRenderingContext2D;
  private out: OutputSize = { w: 2, h: 2 };
  private media: LoadedMedia | null = null;
  private raf = 0;
  private imgStart = 0;
  private recording = false;

  private audioCtx: AudioContext | null = null;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;

  private canvas: HTMLCanvasElement;
  private getState: () => CaptionsState;
  private onTime?: (sec: number) => void;

  constructor(
    canvas: HTMLCanvasElement,
    getState: () => CaptionsState,
    onTime?: (sec: number) => void,
  ) {
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
    const sw = this.media.video ? this.media.video.videoWidth : this.media.image!.naturalWidth;
    const sh = this.media.video ? this.media.video.videoHeight : this.media.image!.naturalHeight;
    const size = outputSizeFor(ratio, sw, sh);
    if (size.w !== this.out.w || size.h !== this.out.h) {
      this.out = size;
      this.canvas.width = size.w;
      this.canvas.height = size.h;
    }
  }

  /** Duration used for the timeline / image loops. */
  totalSec(): number {
    if (!this.media) return 0;
    if (this.media.kind === 'video') return this.media.duration;
    const ends = this.getState().captions.map((c) => c.end);
    return Math.max(2, ...ends);
  }

  private nowSec(): number {
    if (!this.media) return 0;
    if (this.media.kind === 'video') return this.media.video!.currentTime;
    return (performance.now() - this.imgStart) / 1000;
  }

  currentTimeSec(): number {
    return this.nowSec();
  }

  private drawFrameAt(sec: number): void {
    if (!this.media) return;
    this.syncOutputSize();
    const state = this.getState();
    const src = this.media.video ?? this.media.image!;
    drawSource(this.ctx, src, this.out, state.fillMode);
    const pool = poolById(state.boilPool);
    for (const cap of state.captions) {
      if (sec >= cap.start && sec < cap.end) {
        const fi = boilFontIndex(cap, (sec - cap.start) * 1000, pool.fonts.length);
        const font = pool.fonts[fi] ?? pool.fonts[0];
        drawCaption(this.ctx, this.out, cap, font, state.normalize, 1);
      }
    }
  }

  /** Draw the current frame without advancing (paused / after a seek). */
  renderStatic(): void {
    this.drawFrameAt(this.nowSec());
  }

  private ensureAudio(): MediaStream | null {
    if (!this.media?.video) return null;
    if (!this.audioCtx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AC();
      this.srcNode = this.audioCtx.createMediaElementSource(this.media.video);
      this.streamDest = this.audioCtx.createMediaStreamDestination();
      this.srcNode.connect(this.audioCtx.destination);
      this.srcNode.connect(this.streamDest);
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.streamDest?.stream ?? null;
  }

  playPreview(): void {
    if (!this.media) return;
    this.stopLoop();
    this.recording = false;
    this.startPlayback();
    this.loop();
  }

  private startPlayback(): void {
    if (!this.media) return;
    if (this.media.kind === 'video' && this.media.video) {
      this.media.video.currentTime = 0;
      void this.media.video.play().catch(() => undefined);
    } else {
      this.imgStart = performance.now();
    }
  }

  scrubTo(sec: number): void {
    if (!this.media) return;
    this.stopLoop();
    if (this.media.kind === 'video' && this.media.video) {
      const v = this.media.video;
      v.pause();
      const draw = () => {
        this.renderStatic();
        v.removeEventListener('seeked', draw);
      };
      v.addEventListener('seeked', draw);
      v.currentTime = Math.max(0, Math.min(sec, this.media.duration - 0.03));
    } else {
      this.imgStart = performance.now() - sec * 1000;
      this.renderStatic();
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

    this.drawFrameAt(sec);
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

  // ---- pointer helpers (normalised 0..1 coords) ----

  /** Topmost caption at a normalised point, or null. */
  hitTest(nx: number, ny: number): string | null {
    if (!this.media) return null;
    const px = nx * this.out.w;
    const py = ny * this.out.h;
    const state = this.getState();
    const pool = poolById(state.boilPool);
    const sec = this.nowSec();
    for (let i = state.captions.length - 1; i >= 0; i--) {
      const cap = state.captions[i];
      const fi = boilFontIndex(cap, (sec - cap.start) * 1000, pool.fonts.length);
      const font = pool.fonts[fi] ?? pool.fonts[0];
      const L = measureCaption(this.ctx, this.out, cap, font, state.normalize);
      const pad = L.sizePx * 0.3;
      if (px >= L.left - pad && px <= L.left + L.blockW + pad && py >= L.top - pad && py <= L.top + L.blockH + pad) {
        return cap.id;
      }
    }
    return null;
  }

  /** Selection-box bounds for a caption, in canvas px. */
  boundsOf(id: string): CaptionBounds | null {
    if (!this.media) return null;
    const state = this.getState();
    const cap = state.captions.find((c) => c.id === id);
    if (!cap) return null;
    const pool = poolById(state.boilPool);
    const sec = this.nowSec();
    const fi = boilFontIndex(cap, (sec - cap.start) * 1000, pool.fonts.length);
    const font = pool.fonts[fi] ?? pool.fonts[0];
    const L = measureCaption(this.ctx, this.out, cap, font, state.normalize);
    const pad = L.sizePx * 0.25;
    return { left: L.left - pad, top: L.top - pad, width: L.blockW + pad * 2, height: L.blockH + pad * 2 };
  }

  get outputSize(): OutputSize {
    return this.out;
  }

  // ---- export ----

  async record(onProgress?: (sec: number) => void): Promise<Blob> {
    if (!this.media) throw new Error('No media loaded');
    this.stopLoop();
    this.recording = true;

    const stream = this.canvas.captureStream(FPS);
    if (this.media.kind === 'video') {
      const audio = this.ensureAudio();
      audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
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
    this.media = null;
  }
}
