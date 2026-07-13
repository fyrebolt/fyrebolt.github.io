// ===== Rendering: aspect-ratio compositing + the Smash-style banner =====

import type { BannerFrame, BannerStyle, FillMode, OutputSize, RatioKey } from './types';
import { RATIOS } from './types';

// ---- easing ----

export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/** Ease-out with a slight overshoot past the target — gives the banner its snap. */
export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// ---- colour helpers ----

/** Multiply an #rrggbb colour toward white (f>1) or black (f<1). */
export function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 0xff) * f);
  const g = clamp(((n >> 8) & 0xff) * f);
  const b = clamp((n & 0xff) * f);
  return `rgb(${r},${g},${b})`;
}

// ---- output sizing ----

export function outputSizeFor(ratio: RatioKey, srcW: number, srcH: number): OutputSize {
  if (ratio === 'original') {
    // Keep native dimensions but clamp to sane, even numbers for the encoder.
    const w = Math.max(2, Math.round(srcW / 2) * 2);
    const h = Math.max(2, Math.round(srcH / 2) * 2);
    return { w, h };
  }
  return RATIOS[ratio];
}

// ---- source compositing (fill modes) ----

type Source = HTMLVideoElement | HTMLImageElement;

function sourceDims(src: Source): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  return { w: src.naturalWidth, h: src.naturalHeight };
}

/** cover: fill the box, cropping overflow. contain: fit inside, letterboxed. */
function fitRect(
  boxW: number,
  boxH: number,
  srcW: number,
  srcH: number,
  mode: 'cover' | 'contain',
): { dx: number; dy: number; dw: number; dh: number } {
  if (srcW <= 0 || srcH <= 0) return { dx: 0, dy: 0, dw: boxW, dh: boxH };
  const boxR = boxW / boxH;
  const srcR = srcW / srcH;
  const fillWidth = mode === 'cover' ? srcR < boxR : srcR > boxR;
  let dw: number, dh: number;
  if (fillWidth) {
    dw = boxW;
    dh = boxW / srcR;
  } else {
    dh = boxH;
    dw = boxH * srcR;
  }
  return { dx: (boxW - dw) / 2, dy: (boxH - dh) / 2, dw, dh };
}

/**
 * Draw the source into the full output frame, actively converting the aspect ratio:
 *  - crop: scale-to-cover and centre-crop (full-bleed, edges trimmed).
 *  - blur: a blurred cover copy fills the frame, the sharp footage sits contained on top.
 */
export function drawSource(
  ctx: CanvasRenderingContext2D,
  src: Source,
  out: OutputSize,
  mode: FillMode,
): void {
  const { w: sw, h: sh } = sourceDims(src);
  if (sw <= 0 || sh <= 0) return;

  if (mode === 'blur') {
    const cover = fitRect(out.w, out.h, sw, sh, 'cover');
    ctx.save();
    // Blurred, slightly enlarged + darkened background.
    ctx.filter = `blur(${Math.round(out.w * 0.03)}px) brightness(0.6)`;
    const bleed = out.w * 0.06;
    ctx.drawImage(src, cover.dx - bleed, cover.dy - bleed, cover.dw + bleed * 2, cover.dh + bleed * 2);
    ctx.restore();

    const contain = fitRect(out.w, out.h, sw, sh, 'contain');
    ctx.drawImage(src, contain.dx, contain.dy, contain.dw, contain.dh);
    return;
  }

  // crop-to-fill
  const cover = fitRect(out.w, out.h, sw, sh, 'cover');
  ctx.drawImage(src, cover.dx, cover.dy, cover.dw, cover.dh);
}

// ---- the banner ----

/** Draw a right-leaning parallelogram band. Top edge is shifted right by `skew`. */
function band(
  ctx: CanvasRenderingContext2D,
  xL: number,
  xR: number,
  yTop: number,
  yBot: number,
  skew: number,
): void {
  ctx.beginPath();
  ctx.moveTo(xL + skew, yTop);
  ctx.lineTo(xR + skew, yTop);
  ctx.lineTo(xR, yBot);
  ctx.lineTo(xL, yBot);
  ctx.closePath();
}

const CONDENSED_STACK = '"Arial Narrow", "Roboto Condensed", "Oswald", Impact, sans-serif';
const SQUEEZE = 0.88; // horizontal squeeze to fake a condensed face

/** Full-frame white flash used at the instant the banner locks. */
function drawFlash(ctx: CanvasRenderingContext2D, out: OutputSize, flash: number): void {
  if (flash <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, flash) * 0.85;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.w, out.h);
  ctx.restore();
}

/**
 * Draw the layered character-intro banner.
 * Composed of a dark base band, an accent diagonal slash, a bright leading-edge
 * highlight, and the name on its own solid plate. Scales with frame height so it
 * stays proportional across 9:16 / 1:1 / 4:5 / original outputs.
 */
export function drawBanner(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  style: BannerStyle,
  f: BannerFrame,
): void {
  const { w: W, h: H } = out;

  if (f.alpha <= 0.001) {
    drawFlash(ctx, out, f.flash);
    return;
  }

  const plateH = H * 0.115;
  const skew = plateH * 0.5;
  const over = W * 0.14 + skew;
  const xL = -over;
  const xR = W + over;
  const cy = H * f.anchor;
  const yTop = cy - plateH / 2;
  const yBot = cy + plateH / 2;

  // Slide offset: fully off-screen left at slide=0, locked at slide=1, a touch
  // past lock for the overshoot when slide>1.
  const travel = W + over * 2 + skew;
  const xOff = travel * (f.slide - 1);

  ctx.save();
  ctx.globalAlpha = f.alpha;
  ctx.translate(xOff, 0);

  // 1. Drop shadow beneath the whole bar.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = plateH * 0.28;
  ctx.shadowOffsetY = plateH * 0.12;
  ctx.fillStyle = shade(style.primary, 0.9);
  band(ctx, xL, xR, yTop, yBot, skew);
  ctx.fill();
  ctx.restore();

  // 2. Dark base band with a subtle top→bottom gradient.
  const grad = ctx.createLinearGradient(0, yTop, 0, yBot);
  grad.addColorStop(0, shade(style.primary, 1.25));
  grad.addColorStop(1, shade(style.primary, 0.78));
  ctx.fillStyle = grad;
  band(ctx, xL, xR, yTop, yBot, skew);
  ctx.fill();

  // 3. Accent diagonal slash across the upper portion.
  const slashBot = yTop + plateH * 0.4;
  const slashGrad = ctx.createLinearGradient(0, yTop, 0, slashBot);
  slashGrad.addColorStop(0, shade(style.accent, 1.15));
  slashGrad.addColorStop(1, shade(style.accent, 0.85));
  ctx.fillStyle = slashGrad;
  band(ctx, xL, xR, yTop, slashBot, skew);
  ctx.fill();

  // 4. Thin bright separator/highlight line under the accent slash.
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  band(ctx, xL, xR, slashBot - plateH * 0.028, slashBot, skew);
  ctx.fill();

  // 5. Leading-edge highlight sliver (the front edge that sells the motion).
  const edgeW = plateH * 0.16;
  const edgeGrad = ctx.createLinearGradient(xR - edgeW, 0, xR, 0);
  edgeGrad.addColorStop(0, 'rgba(255,255,255,0)');
  edgeGrad.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = edgeGrad;
  band(ctx, xR - edgeW, xR, yTop, yBot, skew);
  ctx.fill();

  // Thin dark trailing edge for definition.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  band(ctx, xL, xL + edgeW * 0.6, yTop, yBot, skew);
  ctx.fill();

  const cx = W / 2;

  // ---- Tagline: small uppercase italic sitting in the accent slash ----
  if (style.tagline) {
    const tSize = plateH * 0.2;
    ctx.font = `italic 700 ${tSize}px ${CONDENSED_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try {
      ctx.letterSpacing = `${tSize * 0.08}px`;
    } catch {
      /* letterSpacing unsupported — ignore */
    }
    ctx.save();
    ctx.translate(cx + skew * 0.6, yTop + plateH * 0.2);
    ctx.transform(SQUEEZE, 0, -0.18, 1, 0, 0); // squeeze + italic shear
    ctx.fillStyle = shade(style.accent, 0.25);
    ctx.fillText(style.tagline.toUpperCase(), 1, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(style.tagline.toUpperCase(), 0, 0);
    ctx.restore();
    try {
      ctx.letterSpacing = '0px';
    } catch {
      /* ignore */
    }
  }

  // ---- Name on its own solid plate ----
  const nameSize = plateH * 0.5;
  ctx.font = `italic 900 ${nameSize}px ${CONDENSED_STACK}`;
  const nameText = (style.name || ' ').toUpperCase();
  const measured = ctx.measureText(nameText).width * SQUEEZE;
  const padX = nameSize * 0.55;
  const plateW = measured + padX * 2;
  const nameCy = yTop + plateH * 0.68;
  const plateTop = nameCy - nameSize * 0.62;
  const plateBot = nameCy + nameSize * 0.6;
  const pL = cx - plateW / 2;
  const pR = cx + plateW / 2;
  const pSkew = (plateBot - plateTop) * 0.42;

  // Plate: solid block behind the name.
  ctx.fillStyle = shade(style.primary, 0.55);
  band(ctx, pL, pR, plateTop, plateBot, pSkew);
  ctx.fill();
  // Accent underline along the plate bottom.
  ctx.fillStyle = style.accent;
  band(ctx, pL, pR, plateBot - (plateBot - plateTop) * 0.12, plateBot, pSkew);
  ctx.fill();

  // Name text: condensed italic, hard outline + emboss for legibility.
  ctx.save();
  ctx.translate(cx, nameCy);
  ctx.transform(SQUEEZE, 0, -0.2, 1, 0, 0); // squeeze + italic shear
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // outline
  ctx.lineWidth = nameSize * 0.14;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(nameText, 0, 0);
  // emboss shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(nameText, nameSize * 0.03, nameSize * 0.04);
  // fill
  ctx.fillStyle = style.text;
  ctx.fillText(nameText, 0, 0);
  ctx.restore();

  ctx.restore(); // slide translate + alpha

  drawFlash(ctx, out, f.flash);
}
