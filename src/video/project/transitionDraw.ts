// ===== Canvas compositing for the eight clip-boundary transitions =====
//
// One renderer instance per Compositor, so the scratch canvases are allocated
// once rather than per frame. The caller supplies two PAINT CALLBACKS which each
// fill a full output frame (base clip → zoom crop / aspect composite / grade);
// this module never learns how a frame is produced, only how the two are mixed.
// Sides are painted lazily — `flash` only ever paints one of them.
//
// Everything here is pure 2D compositing except `glitch`, which needs real pixel
// work; that runs on a downscaled buffer (see GLITCH_MAX_EDGE) and is blitted
// back up, which keeps 60fps export capture viable at 4K and suits the effect —
// the crunch reads as part of the glitch.

import type { OutputSize } from '../types';
import type { Transition, TransitionDir } from './transitions';

/** Paints one complete output frame into the given context. */
export type PaintFrame = (ctx: CanvasRenderingContext2D) => void;

/** Longest edge of the glitch pixel buffer. Half-res, but capped so 4K stays real-time. */
const GLITCH_MAX_EDGE = 960;

/** Chunky glitch judder: the noise pattern re-rolls this many times per window. */
const GLITCH_STEPS = 24;

function smoothstep(p: number): number {
  return p * p * (3 - 2 * p);
}

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

/** Deterministic PRNG so preview and the exported re-capture glitch identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TransitionRenderer {
  private layers: HTMLCanvasElement[] = [];
  private glitchBuf: HTMLCanvasElement | null = null;
  private glitchAlt: HTMLCanvasElement | null = null;

  /** A scratch canvas of the output size (index-keyed so A and B coexist). */
  private layer(i: number, out: OutputSize): CanvasRenderingContext2D | null {
    let c = this.layers[i];
    if (!c) {
      c = document.createElement('canvas');
      this.layers[i] = c;
    }
    if (c.width !== out.w || c.height !== out.h) {
      c.width = out.w;
      c.height = out.h;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, out.w, out.h);
    return ctx;
  }

  private paintTo(i: number, out: OutputSize, paint: PaintFrame): HTMLCanvasElement | null {
    const ctx = this.layer(i, out);
    if (!ctx) return null;
    paint(ctx);
    return this.layers[i];
  }

  /**
   * Composite the boundary at `progress` (0 = fully outgoing, 1 = fully incoming)
   * onto `ctx`. `salt` keeps each boundary's glitch pattern its own.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    out: OutputSize,
    tr: Transition,
    progress: number,
    paintA: PaintFrame,
    paintB: PaintFrame,
    salt = 0,
  ): void {
    const p = Math.max(0, Math.min(1, progress));
    switch (tr.kind) {
      case 'crossfade':
        return this.crossfade(ctx, out, p, paintA, paintB);
      case 'wipe':
        return this.wipe(ctx, out, p, tr.dir ?? 'left', paintA, paintB);
      case 'push':
        return this.push(ctx, out, p, tr.dir ?? 'left', paintA, paintB);
      case 'iris':
        return this.iris(ctx, out, p, tr.iris ?? 'in', paintA, paintB);
      case 'zoom':
        return this.zoom(ctx, out, p, paintA, paintB);
      case 'glitch':
        return this.glitch(ctx, out, p, paintA, paintB, salt);
      case 'flash':
        return this.flash(ctx, out, p, tr.flash ?? 'white', paintA, paintB);
      default:
        // 'cut' never reaches here (it has no window); paint the incoming side.
        return paintB(ctx);
    }
  }

  // ---- 2. crossfade — straight alpha dissolve ----

  private crossfade(ctx: CanvasRenderingContext2D, out: OutputSize, p: number, paintA: PaintFrame, paintB: PaintFrame): void {
    paintA(ctx);
    const b = this.paintTo(0, out, paintB);
    if (!b) return;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.drawImage(b, 0, 0);
    ctx.restore();
  }

  // ---- 3. wipe — hard-edged line sweeping across, with a lit leading edge ----

  private wipe(
    ctx: CanvasRenderingContext2D,
    out: OutputSize,
    p: number,
    dir: TransitionDir,
    paintA: PaintFrame,
    paintB: PaintFrame,
  ): void {
    paintA(ctx);
    const b = this.paintTo(0, out, paintB);
    if (!b) return;
    const { w, h } = out;
    // The revealed region grows from the side the wipe travels FROM.
    let rect: [number, number, number, number];
    let edge: [number, number, number, number]; // the bright line, in the sweep's path
    const thickness = Math.max(2, Math.round(Math.min(w, h) * 0.004));
    if (dir === 'left') {
      const x = w * p;
      rect = [0, 0, x, h];
      edge = [x - thickness, 0, thickness, h];
    } else if (dir === 'right') {
      const x = w * (1 - p);
      rect = [x, 0, w - x, h];
      edge = [x, 0, thickness, h];
    } else if (dir === 'up') {
      const y = h * p;
      rect = [0, 0, w, y];
      edge = [0, y - thickness, w, thickness];
    } else {
      const y = h * (1 - p);
      rect = [0, y, w, h - y];
      edge = [0, y, w, thickness];
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect[0], rect[1], rect[2], rect[3]);
    ctx.clip();
    ctx.drawImage(b, 0, 0);
    ctx.restore();
    // Leading edge: a thin bright line so the cut reads as a deliberate wipe
    // rather than a rectangle appearing. Fades out at both ends of the sweep.
    ctx.save();
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fff';
    ctx.fillRect(edge[0], edge[1], edge[2], edge[3]);
    ctx.restore();
  }

  // ---- 4. push — both frames physically slide; the incoming shoves the outgoing off ----

  private push(
    ctx: CanvasRenderingContext2D,
    out: OutputSize,
    p: number,
    dir: TransitionDir,
    paintA: PaintFrame,
    paintB: PaintFrame,
  ): void {
    const a = this.paintTo(0, out, paintA);
    const b = this.paintTo(1, out, paintB);
    if (!a || !b) return;
    const e = smoothstep(p);
    const { w, h } = out;
    // Travel vector: the incoming enters from `dir`'s opposite side and both
    // frames move together, so they stay edge-to-edge for the whole sweep.
    let ax = 0;
    let ay = 0;
    if (dir === 'left') ax = -w * e;
    else if (dir === 'right') ax = w * e;
    else if (dir === 'up') ay = -h * e;
    else ay = h * e;
    const bx = dir === 'left' ? ax + w : dir === 'right' ? ax - w : ax;
    const by = dir === 'up' ? ay + h : dir === 'down' ? ay - h : ay;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(a, ax, ay);
    ctx.drawImage(b, bx, by);
    ctx.restore();
  }

  // ---- 5. iris — a circle opening (or closing) onto the incoming clip ----

  private iris(
    ctx: CanvasRenderingContext2D,
    out: OutputSize,
    p: number,
    mode: 'in' | 'out',
    paintA: PaintFrame,
    paintB: PaintFrame,
  ): void {
    const { w, h } = out;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(w, h) / 2;
    const e = easeOutCubic(p);
    if (mode === 'in') {
      // Expanding circle of the INCOMING clip over the outgoing one.
      paintA(ctx);
      const b = this.paintTo(0, out, paintB);
      if (!b) return;
      const r = maxR * e;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(b, 0, 0);
      ctx.restore();
      this.irisRing(ctx, cx, cy, r, p);
    } else {
      // Contracting circle of the OUTGOING clip shrinking to nothing.
      paintB(ctx);
      const a = this.paintTo(0, out, paintA);
      if (!a) return;
      const r = maxR * (1 - smoothstep(p));
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(a, 0, 0);
      ctx.restore();
      this.irisRing(ctx, cx, cy, r, p);
    }
  }

  /** A thin lit ring on the iris edge — keeps the shape legible over busy frames. */
  private irisRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, p: number): void {
    if (r <= 1) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.75;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, r * 0.006);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 6. zoom — outgoing punches in and blurs away, incoming drops in from large ----

  private zoom(ctx: CanvasRenderingContext2D, out: OutputSize, p: number, paintA: PaintFrame, paintB: PaintFrame): void {
    const a = this.paintTo(0, out, paintA);
    const b = this.paintTo(1, out, paintB);
    if (!a || !b) return;
    const { w, h } = out;
    const e = smoothstep(p);
    const blurMax = Math.max(4, Math.min(w, h) * 0.02);

    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Outgoing: scales UP past the frame, blurring and fading out.
    const sA = 1 + 0.85 * e;
    ctx.save();
    ctx.filter = `blur(${(blurMax * e).toFixed(2)}px)`;
    ctx.globalAlpha = 1 - e;
    ctx.translate(w / 2, h / 2);
    ctx.scale(sA, sA);
    ctx.drawImage(a, -w / 2, -h / 2);
    ctx.restore();

    // Incoming: starts much larger and settles to 1:1, blur resolving as it lands.
    const sB = 1 + 1.6 * (1 - e);
    ctx.save();
    ctx.filter = `blur(${(blurMax * (1 - e)).toFixed(2)}px)`;
    ctx.globalAlpha = e;
    ctx.translate(w / 2, h / 2);
    ctx.scale(sB, sB);
    ctx.drawImage(b, -w / 2, -h / 2);
    ctx.restore();

    ctx.restore();
  }

  // ---- 7. glitch — RGB channel split, slice displacement, noise, scanline jitter ----

  private glitchCanvas(which: 'buf' | 'alt', w: number, h: number): HTMLCanvasElement {
    const key = which === 'buf' ? 'glitchBuf' : 'glitchAlt';
    let c = this[key];
    if (!c) {
      c = document.createElement('canvas');
      this[key] = c;
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c;
  }

  private glitch(
    ctx: CanvasRenderingContext2D,
    out: OutputSize,
    p: number,
    paintA: PaintFrame,
    paintB: PaintFrame,
    salt: number,
  ): void {
    const { w, h } = out;
    // Downscaled working buffer (see GLITCH_MAX_EDGE).
    const scale = Math.min(0.5, GLITCH_MAX_EDGE / Math.max(w, h));
    const bw = Math.max(8, Math.round(w * scale));
    const bh = Math.max(8, Math.round(h * scale));

    // The frame we're actually on, plus the other side to tear slices from.
    const past = p >= 0.5;
    const main = this.paintTo(0, out, past ? paintB : paintA);
    const other = this.paintTo(1, out, past ? paintA : paintB);
    if (!main || !other) return;

    const buf = this.glitchCanvas('buf', bw, bh);
    const alt = this.glitchCanvas('alt', bw, bh);
    const bctx = buf.getContext('2d', { willReadFrequently: true });
    const actx = alt.getContext('2d', { willReadFrequently: true });
    if (!bctx || !actx) return;
    bctx.clearRect(0, 0, bw, bh);
    bctx.drawImage(main, 0, 0, bw, bh);
    actx.clearRect(0, 0, bw, bh);
    actx.drawImage(other, 0, 0, bw, bh);

    // Intensity peaks hard at the cut and is never quite zero at the edges.
    const inten = 0.25 + 0.75 * (1 - Math.abs(2 * p - 1));
    const rnd = mulberry32(Math.floor(p * GLITCH_STEPS) * 9176 + Math.round(salt * 1000));

    const img = bctx.getImageData(0, 0, bw, bh);
    const src = img.data;
    const copy = new Uint8ClampedArray(src); // pre-glitch snapshot to sample from
    const altData = actx.getImageData(0, 0, bw, bh).data;

    // (a) RGB channel split — red pulled one way, blue the other.
    const shift = Math.max(1, Math.round(bw * 0.03 * inten));
    for (let y = 0; y < bh; y++) {
      const row = y * bw * 4;
      for (let x = 0; x < bw; x++) {
        const i = row + x * 4;
        const xr = Math.min(bw - 1, x + shift);
        const xb = Math.max(0, x - shift);
        src[i] = copy[row + xr * 4];
        src[i + 2] = copy[row + xb * 4 + 2];
      }
    }

    // (b) Slice displacement — horizontal bands torn sideways, some of them
    //     showing the OTHER clip, which is what makes the two frames interleave.
    const slices = Math.round(2 + rnd() * 8 * inten);
    for (let s = 0; s < slices; s++) {
      const y0 = Math.floor(rnd() * bh);
      const sh = Math.max(1, Math.floor(rnd() * bh * 0.09));
      const dx = Math.round((rnd() - 0.5) * bw * 0.28 * inten);
      const fromOther = rnd() < 0.45;
      const from = fromOther ? altData : copy;
      for (let y = y0; y < Math.min(bh, y0 + sh); y++) {
        const row = y * bw * 4;
        for (let x = 0; x < bw; x++) {
          const sx = Math.max(0, Math.min(bw - 1, x - dx));
          const si = row + sx * 4;
          const di = row + x * 4;
          src[di] = from[si];
          src[di + 1] = from[si + 1];
          src[di + 2] = from[si + 2];
        }
      }
    }

    // (c) Scanline jitter + sparse noise speckle.
    const lineDrop = 0.35 * inten;
    for (let y = 0; y < bh; y++) {
      const dark = y % 2 === 0 ? 1 : 1 - lineDrop * (0.5 + rnd() * 0.5);
      const row = y * bw * 4;
      const speckle = rnd() < 0.12 * inten;
      for (let x = 0; x < bw; x++) {
        const i = row + x * 4;
        if (dark !== 1) {
          src[i] *= dark;
          src[i + 1] *= dark;
          src[i + 2] *= dark;
        }
        if (speckle && rnd() < 0.04) {
          const n = rnd() * 255;
          src[i] = n;
          src[i + 1] = n;
          src[i + 2] = n;
        }
      }
    }

    bctx.putImageData(img, 0, 0);

    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false; // keep it crunchy on the way back up
    ctx.drawImage(buf, 0, 0, w, h);
    ctx.restore();
  }

  // ---- 8. flash — a tight blink to white/black across the cut, no sustained overlap ----

  private flash(
    ctx: CanvasRenderingContext2D,
    out: OutputSize,
    p: number,
    color: 'white' | 'black',
    paintA: PaintFrame,
    paintB: PaintFrame,
  ): void {
    // Only ONE side is ever on screen — the blink hides the splice itself.
    if (p < 0.5) paintA(ctx);
    else paintB(ctx);
    // Peaks at the cut, with a fast attack / slightly slower decay so it snaps.
    const t = Math.abs(2 * p - 1); // 1 at the window edges, 0 at the cut
    const alpha = Math.pow(1 - t, 0.55);
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color === 'white' ? '#fff' : '#000';
    ctx.fillRect(0, 0, out.w, out.h);
    ctx.restore();
  }
}
