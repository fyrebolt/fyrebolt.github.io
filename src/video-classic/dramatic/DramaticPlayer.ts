// ===== Dramatic wording engine: compositing + timed words + export =====

import { drawSource, drawDramaticWord, dramaticWordLayout, outputSizeFor } from '../render';
import type { FillMode, OutputSize, RatioKey } from '../types';
import type { DramaticWord } from './types';
import { elementEnd } from './types';

const FPS = 30;

export type MediaKind = 'video' | 'image';

export interface LoadedMedia {
  kind: MediaKind;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  duration: number;
}

export interface DramaticState {
  words: DramaticWord[];
  fillMode: FillMode;
  ratio: RatioKey;
}

export interface WordBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Plays the source straight through and draws each word over its time range. */
export class DramaticPlayer {
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
  private getState: () => DramaticState;
  private onTime?: (sec: number) => void;

  constructor(canvas: HTMLCanvasElement, getState: () => DramaticState, onTime?: (sec: number) => void) {
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

  private sourceDims(): { w: number; h: number } {
    if (!this.media) return { w: 0, h: 0 };
    if (this.media.video) return { w: this.media.video.videoWidth, h: this.media.video.videoHeight };
    return { w: this.media.image!.naturalWidth, h: this.media.image!.naturalHeight };
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

  totalSec(): number {
    if (!this.media) return 0;
    if (this.media.kind === 'video') return this.media.duration;
    const ends = this.getState().words.map(elementEnd);
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

  private drawFrameAt(sec: number): void {
    if (!this.media) return;
    this.syncOutputSize();
    const state = this.getState();
    const src = this.media.video ?? this.media.image!;
    drawSource(this.ctx, src, this.out, state.fillMode);
    for (const w of state.words) {
      if (sec < w.start || sec >= elementEnd(w)) continue;
      drawDramaticWord(this.ctx, this.out, w, sec);
    }
  }

  renderStatic(): void {
    this.drawFrameAt(this.nowSec());
  }

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

  private ensureAudio(): MediaStream | null {
    if (!this.media?.video) return null;
    const ctx = this.ensureCtx();
    if (!this.streamDest) {
      this.srcNode = ctx.createMediaElementSource(this.media.video);
      this.streamDest = ctx.createMediaStreamDestination();
      this.srcNode.connect(ctx.destination);
      this.srcNode.connect(this.streamDest);
    }
    return this.streamDest.stream ?? null;
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

  // ---- selection ----

  /** Topmost word whose text box contains a normalised point at the current time. */
  hitTest(nx: number, ny: number): string | null {
    if (!this.media) return null;
    const px = nx * this.out.w;
    const py = ny * this.out.h;
    const state = this.getState();
    const sec = this.nowSec();
    for (let i = state.words.length - 1; i >= 0; i--) {
      const w = state.words[i];
      if (sec < w.start || sec >= elementEnd(w)) continue;
      const L = dramaticWordLayout(this.ctx, this.out, w);
      const pad = L.size * 0.3;
      if (px >= L.left - pad && px <= L.left + L.blockW + pad && py >= L.top - pad && py <= L.top + L.blockH + pad) {
        return w.id;
      }
    }
    return null;
  }

  /** Selection-box bounds for a word, in canvas px (or null). */
  boundsOf(id: string): WordBounds | null {
    if (!this.media) return null;
    const w = this.getState().words.find((x) => x.id === id);
    if (!w) return null;
    const L = dramaticWordLayout(this.ctx, this.out, w);
    const pad = L.size * 0.25;
    return { left: L.left - pad, top: L.top - pad, width: L.blockW + pad * 2, height: L.blockH + pad * 2 };
  }

  get outputSize(): OutputSize {
    return this.out;
  }

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
