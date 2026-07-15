// ===== Sketch engine: compositing + timed sketch replay + export =====

import { drawSource, drawSketch, outputSizeFor } from '../render';
import type { FillMode, OutputSize, RatioKey } from '../types';
import type { SketchElement } from './types';
import { elementEnd } from './types';
import { SfxEngine } from '../sfx';

const FPS = 30;
const PENCIL_INTERVAL = 0.06; // seconds between pencil grains while animating

export type MediaKind = 'video' | 'image';

export interface LoadedMedia {
  kind: MediaKind;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  duration: number;
}

export interface SketchState {
  elements: SketchElement[];
  fillMode: FillMode;
  ratio: RatioKey;
  sfxEnabled: boolean;
  /** SFX bus gain (0..1), balancing effects against the clip's own audio. */
  sfxVolume: number;
}

/** Plays the source straight through and replays each sketch over its time range. */
export class SketchPlayer {
  private ctx: CanvasRenderingContext2D;
  private out: OutputSize = { w: 2, h: 2 };
  private media: LoadedMedia | null = null;
  private raf = 0;
  private imgStart = 0;
  private recording = false;

  private audioCtx: AudioContext | null = null;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private sfx: SfxEngine | null = null;
  // Per-element last pencil-grain audio time (reset each playback).
  private lastPencil = new Map<string, number>();

  private canvas: HTMLCanvasElement;
  private getState: () => SketchState;
  private onTime?: (sec: number) => void;

  constructor(canvas: HTMLCanvasElement, getState: () => SketchState, onTime?: (sec: number) => void) {
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

  totalSec(): number {
    if (!this.media) return 0;
    if (this.media.kind === 'video') return this.media.duration;
    const ends = this.getState().elements.map(elementEnd);
    return Math.max(3, ...ends);
  }

  private nowSec(): number {
    if (!this.media) return 0;
    if (this.media.kind === 'video') return this.media.video!.currentTime;
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
    drawSource(this.ctx, src, this.out, state.fillMode);

    if (this.sfx) this.sfx.setVolume(state.sfxEnabled ? state.sfxVolume : 0);
    const sfxOn = fireSfx && state.sfxEnabled && !!this.sfx;
    const when = this.audioCtx ? this.audioCtx.currentTime : 0;

    for (const el of state.elements) {
      if (sec < el.start || sec >= elementEnd(el)) continue;
      const area = { x: el.x * this.out.w, y: el.y * this.out.h, w: el.w * this.out.w, h: el.h * this.out.h };
      drawSketch(this.ctx, area, el, sec);

      if (sfxOn && el.sound && el.animationDur > 0 && sec - el.start < el.animationDur) {
        const last = this.lastPencil.get(el.id) ?? -Infinity;
        if (when - last >= PENCIL_INTERVAL) {
          this.sfx!.trigger('pencil', when);
          this.lastPencil.set(el.id, when);
        }
      }
    }
  }

  /** Draw the current frame without advancing (paused / after a seek). No SFX. */
  renderStatic(): void {
    this.drawFrameAt(this.nowSec(), false);
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

  playPreview(): void {
    if (!this.media) return;
    this.stopLoop();
    this.recording = false;
    this.ensureSfx();
    this.startPlayback();
    this.loop();
  }

  private startPlayback(): void {
    if (!this.media) return;
    this.lastPencil.clear();
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

  // ---- selection ----

  /** Topmost sketch whose placement box contains a normalised point, or null. */
  hitTest(nx: number, ny: number): string | null {
    if (!this.media) return null;
    const state = this.getState();
    const sec = this.nowSec();
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const el = state.elements[i];
      if (sec < el.start || sec >= elementEnd(el)) continue;
      if (nx >= el.x && nx <= el.x + el.w && ny >= el.y && ny <= el.y + el.h) return el.id;
    }
    return null;
  }

  get outputSize(): OutputSize {
    return this.out;
  }

  // ---- export ----

  async record(onProgress?: (sec: number) => void): Promise<Blob> {
    if (!this.media) throw new Error('No media loaded');
    this.stopLoop();
    this.recording = true;
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
