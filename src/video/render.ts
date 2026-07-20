// ===== Rendering: aspect-ratio compositing + the Smash-style banner =====

import type { BannerFrame, BannerStyle, FillMode, OutputSize, RatioKey } from './types';
import { RATIOS } from './types';
import type { CaptionEl, CaptionTextStyle, TypewriterProgress } from './captions/types';
import { attachmentReveal, staticWindowOf } from './captions/types';
import type { DramaticWord } from './dramatic/types';
import { wordEnvelope } from './dramatic/types';
import type { ZoomRect } from './zoom/types';
import type { BoilFont } from './captions/fonts';
import { fontCss } from './captions/fonts';
import type { SketchElement, SketchPoint, SketchStroke } from './sketch/types';
import { geometryFor, sampleAt, sketchProgress, totalArc } from './sketch/types';

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

/** Accelerating ease — used to fling the banner off-screen on exit. */
export function easeInCubic(x: number): number {
  return x * x * x;
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

  if (mode === 'fit') {
    // Show the WHOLE clip: contain-fit (fits width or height as appropriate),
    // centred, with solid black bars filling the rest.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.w, out.h);
    const contain = fitRect(out.w, out.h, sw, sh, 'contain');
    ctx.drawImage(src, contain.dx, contain.dy, contain.dw, contain.dh);
    return;
  }

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

/** Steep, additive motion streaks that read as speed behind the plate. */
function drawSpeedLines(
  ctx: CanvasRenderingContext2D,
  xL: number,
  xR: number,
  cy: number,
  plateH: number,
  accent: string,
  t: number,
  alpha: number,
): void {
  const zoneH = plateH * 2.1;
  const yA = cy - zoneH / 2;
  const yB = cy + zoneH / 2;
  const streakSkew = plateH * 1.6; // steeper than the bar
  const span = xR - xL + streakSkew;
  const count = 22;
  const step = span / count;
  const drift = (t * 80) % step; // slow left→right march
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = -1; i < count + 1; i++) {
    const base = xL + i * step + drift;
    // thin, fairly uniform streaks so they read as motion, not blotches
    const w = plateH * (0.03 + 0.028 * (((i % 5) + 5) % 5) / 5);
    const a = (0.09 + 0.11 * (((i * 3) % 4) + 4) % 4 / 4) * alpha;
    ctx.globalAlpha = a;
    ctx.fillStyle = i % 4 === 0 ? shade(accent, 1.4) : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(base + streakSkew, yA);
    ctx.lineTo(base + streakSkew + w, yA);
    ctx.lineTo(base + w, yB);
    ctx.lineTo(base, yB);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Marching ›› chevrons along the accent slash for directional punch. */
function drawChevrons(
  ctx: CanvasRenderingContext2D,
  xL: number,
  xR: number,
  yTop: number,
  yBot: number,
  skew: number,
  t: number,
): void {
  ctx.save();
  band(ctx, xL, xR, yTop, yBot, skew);
  ctx.clip();
  const h = yBot - yTop;
  const midY = (yTop + yBot) / 2;
  const cw = h * 0.42; // chevron width
  const half = h * 0.34; // chevron half-height (tall enough to read)
  const spacing = cw * 1.35; // dense march
  const drift = (t * 90) % spacing; // marching →
  ctx.lineWidth = h * 0.14;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  for (let x = xL - spacing + drift; x < xR + spacing; x += spacing) {
    // faint dark drop for depth, then a bright chevron on top
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(x, midY - half + h * 0.06);
    ctx.lineTo(x + cw, midY + h * 0.06);
    ctx.lineTo(x, midY + half + h * 0.06);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(x, midY - half);
    ctx.lineTo(x + cw, midY);
    ctx.lineTo(x, midY + half);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw the layered character-intro banner.
 * A single accent→base gradient body joins what used to be separate bands, with
 * optional game-intro FX layered on: a pulsing glow rim, chrome bevel + sweeping
 * sheen, marching chevrons, motion streaks, and scanline texture. Scales with
 * frame height so it stays proportional across 9:16 / 1:1 / 4:5 / original.
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

  const t = f.t ?? 0;
  const a = f.alpha;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2); // glow breathing, 0..1

  const plateH = H * 0.115;
  const skew = plateH * 0.5;
  const over = W * 0.14 + skew;
  const xL = -over;
  const xR = W + over;
  const cy = H * f.anchor;
  const yTop = cy - plateH / 2;
  const yBot = cy + plateH / 2;

  // Slide offset: off-screen left at slide=0, locked at slide=1, off-screen
  // right at slide=2 (the exit fling), with a touch past lock for the overshoot.
  const travel = W + over * 2 + skew;
  const xOff = travel * (f.slide - 1);

  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(xOff, 0);

  // 1. Motion streaks behind the plate (show above/below the opaque bar).
  if (style.speedLines) drawSpeedLines(ctx, xL, xR, cy, plateH, style.accent, t, a);

  // 2. Drop shadow beneath the whole bar.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = plateH * 0.28;
  ctx.shadowOffsetY = plateH * 0.12;
  ctx.fillStyle = shade(style.primary, 0.9);
  band(ctx, xL, xR, yTop, yBot, skew);
  ctx.fill();
  ctx.restore();

  // 3. Unified body: one vertical gradient that flows from the bright accent
  //    slash at the top down into the dark base — no hard seam between layers.
  const body = ctx.createLinearGradient(0, yTop, 0, yBot);
  body.addColorStop(0.0, shade(style.accent, 1.2)); // bright accent top edge
  body.addColorStop(0.16, shade(style.accent, 0.95)); // accent body
  body.addColorStop(0.34, shade(style.accent, 0.62)); // accent shading down
  body.addColorStop(0.44, shade(style.primary, 1.28)); // luminous join (was the hard line)
  body.addColorStop(0.62, shade(style.primary, 0.98));
  body.addColorStop(1.0, shade(style.primary, 0.72)); // dark base bottom
  ctx.fillStyle = body;
  band(ctx, xL, xR, yTop, yBot, skew);
  ctx.fill();

  const slashBot = yTop + plateH * 0.4;

  // 4. Scanline texture over the base band (clipped to the bar).
  if (style.scanlines) {
    ctx.save();
    band(ctx, xL, xR, yTop, yBot, skew);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    const gap = Math.max(3, plateH * 0.055);
    for (let y = yTop + gap * 0.5; y < yBot; y += gap) {
      ctx.fillRect(xL, y, xR - xL + skew, gap * 0.42);
    }
    ctx.restore();
  }

  // 5. Chrome bevel + sweeping specular sheen (clipped to the bar).
  if (style.metallic) {
    ctx.save();
    band(ctx, xL, xR, yTop, yBot, skew);
    ctx.clip();
    const bw = xR - xL + skew + 2;
    // top bevel highlight
    const topBevel = ctx.createLinearGradient(0, yTop, 0, yTop + plateH * 0.16);
    topBevel.addColorStop(0, 'rgba(255,255,255,0.5)');
    topBevel.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = topBevel;
    ctx.fillRect(xL, yTop, bw, plateH * 0.16);
    // bottom bevel shadow
    const botBevel = ctx.createLinearGradient(0, yBot - plateH * 0.2, 0, yBot);
    botBevel.addColorStop(0, 'rgba(0,0,0,0)');
    botBevel.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = botBevel;
    ctx.fillRect(xL, yBot - plateH * 0.2, bw, plateH * 0.2);
    // moving specular glare
    const sweepW = plateH * 1.3;
    const sx = xL - sweepW + ((t * 0.22) % 1) * (bw + sweepW * 2);
    const glare = ctx.createLinearGradient(sx - sweepW, 0, sx + sweepW, 0);
    glare.addColorStop(0, 'rgba(255,255,255,0)');
    glare.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    glare.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glare;
    band(ctx, sx - sweepW, sx + sweepW, yTop, yBot, skew);
    ctx.fill();
    ctx.restore();
  }

  // 6. Marching chevrons along the accent slash.
  if (style.chevrons) drawChevrons(ctx, xL, xR, yTop, slashBot, skew, t);

  // 7. Leading-edge highlight sliver (the front edge that sells the motion).
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

  // ---- Name on its own plate, blended into the bar via a horizontal fade ----
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

  // Plate: darker than the bar so the name reads, but its left/right ends fade
  // out so it merges into the body instead of sitting as a separate block.
  ctx.save();
  band(ctx, pL - pSkew, pR + pSkew, plateTop, plateBot, pSkew);
  ctx.clip();
  const plateFade = ctx.createLinearGradient(pL, 0, pR, 0);
  plateFade.addColorStop(0, 'rgba(0,0,0,0)');
  plateFade.addColorStop(0.22, shade(style.primary, 0.5));
  plateFade.addColorStop(0.78, shade(style.primary, 0.5));
  plateFade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = plateFade;
  ctx.fillRect(pL - pSkew, plateTop, plateW + pSkew * 2, plateBot - plateTop);
  ctx.restore();
  // Accent underline along the plate bottom (with a soft glow when lit).
  ctx.save();
  if (style.glow) {
    ctx.shadowColor = style.accent;
    ctx.shadowBlur = plateH * 0.12 * (0.6 + pulse);
  }
  ctx.fillStyle = style.accent;
  band(ctx, pL, pR, plateBot - (plateBot - plateTop) * 0.12, plateBot, pSkew);
  ctx.fill();
  ctx.restore();

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
  // fill — a metallic vertical gradient (embossed from the chosen text colour)
  // when the metallic FX is on, otherwise the flat text colour.
  if (style.metallic) {
    const metal = ctx.createLinearGradient(0, -nameSize * 0.55, 0, nameSize * 0.55);
    metal.addColorStop(0, '#ffffff');
    metal.addColorStop(0.5, style.text);
    metal.addColorStop(0.52, shade(style.text, 0.72));
    metal.addColorStop(1, shade(style.text, 0.95));
    ctx.fillStyle = metal;
  } else {
    ctx.fillStyle = style.text;
  }
  ctx.fillText(nameText, 0, 0);
  ctx.restore();

  // 8. Pulsing accent glow rim (the "glowing border") — additive so it lights
  //    up the top & bottom edges over whatever is behind, and breathes with t.
  if (style.glow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.4 + 0.45 * pulse);
    ctx.shadowColor = style.accent;
    ctx.shadowBlur = plateH * (0.45 + 0.6 * pulse);
    ctx.strokeStyle = style.accent;
    ctx.lineJoin = 'round';
    // Bright crisp edge…
    ctx.lineWidth = plateH * 0.05;
    band(ctx, xL, xR, yTop, yBot, skew);
    ctx.stroke();
    // …and a wider, softer bloom pass.
    ctx.globalAlpha = a * (0.25 + 0.3 * pulse);
    ctx.lineWidth = plateH * 0.14;
    band(ctx, xL, xR, yTop, yBot, skew);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore(); // slide translate + alpha

  drawFlash(ctx, out, f.flash);
}

// ---- caption text (multi-element overlays) ----

const CAPTION_BASE_FRAC = 0.055; // base font size as a fraction of frame height
const CAPTION_MAX_WIDTH_FRAC = 0.86; // wrap width relative to frame width

/** Wrap `text` to `maxWidth`, respecting manual line breaks. ctx.font must be set. */
export function layoutCaptionLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paras = text.replace(/\r/g, '').split('\n');
  const lines: string[] = [];
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${cur} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) cur = test;
      else {
        lines.push(cur);
        cur = words[i];
      }
    }
    lines.push(cur);
  }
  return lines;
}

export interface CaptionLayout {
  lines: string[];
  sizePx: number;
  lineHeight: number;
  blockW: number;
  blockH: number;
  cx: number;
  cy: number;
  /** Bounding box in canvas px (for hit-testing / selection). */
  left: number;
  top: number;
}

// ---- per-font height normalisation ----
// Fonts at the same em size have very different actual glyph heights, so a boil
// that cycles fonts looks like it changes size each frame. When enabled, we
// scale each font so a reference string renders to a consistent visual height.

const NORM_REF_TEXT = 'Hxg';
const NORM_TARGET = 72; // target (ascent+descent) height at a 100px reference

let normCtx: CanvasRenderingContext2D | null = null;
const heightScaleCache = new Map<string, number>();

function fontHeightScale(font: BoilFont, enabled: boolean): number {
  if (!enabled) return 1;
  const key = `${font.weight}:${font.family}`;
  const cached = heightScaleCache.get(key);
  if (cached !== undefined) return cached;
  // Don't measure (or cache) until the real font is loaded, or we'd bake in the
  // fallback font's metrics.
  if (typeof document === 'undefined' || !document.fonts?.check(`${font.weight} 100px "${font.family}"`)) {
    return 1;
  }
  if (!normCtx) normCtx = document.createElement('canvas').getContext('2d');
  if (!normCtx) return 1;
  normCtx.font = `${font.weight} 100px "${font.family}", sans-serif`;
  const m = normCtx.measureText(NORM_REF_TEXT);
  const h = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
  if (!h) return 1;
  const scale = Math.max(0.6, Math.min(1.6, NORM_TARGET / h));
  heightScaleCache.set(key, scale);
  return scale;
}

/** Measure a caption's wrapped layout at the current output size (no drawing). */
export function measureCaption(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  cap: CaptionTextStyle,
  font: BoilFont,
  normalize: boolean,
): CaptionLayout {
  const sizePx = out.h * CAPTION_BASE_FRAC * cap.sizeScale * fontHeightScale(font, normalize);
  const maxWidth = out.w * CAPTION_MAX_WIDTH_FRAC;
  ctx.font = fontCss(font, sizePx);
  const lines = layoutCaptionLines(ctx, cap.text || ' ', maxWidth);
  const lineHeight = sizePx * 1.18;
  let maxLineWidth = 0;
  for (const ln of lines) maxLineWidth = Math.max(maxLineWidth, ctx.measureText(ln).width);
  const blockW = Math.min(maxWidth, maxLineWidth);
  const blockH = lines.length * lineHeight;
  const cx = cap.x * out.w;
  const cy = cap.y * out.h;
  return { lines, sizePx, lineHeight, blockW, blockH, cx, cy, left: cx - blockW / 2, top: cy - blockH / 2 };
}

/** Draw a caption (wrapped, aligned, with the chosen legibility treatment). */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  cap: CaptionTextStyle,
  font: BoilFont,
  normalize: boolean,
  alpha = 1,
): CaptionLayout {
  const L = measureCaption(ctx, out, cap, font, normalize);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  ctx.textAlign = cap.align;
  ctx.font = fontCss(font, L.sizePx);
  ctx.lineJoin = 'round';

  // Block is centred on (cap.x, cap.y); pick the per-line anchor for the alignment.
  let anchorX = L.cx;
  if (cap.align === 'left') anchorX = L.cx - L.blockW / 2;
  else if (cap.align === 'right') anchorX = L.cx + L.blockW / 2;
  const firstLineY = L.cy - L.blockH / 2 + L.lineHeight / 2;

  if (cap.legibility === 'shadow') {
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = L.sizePx * 0.18;
    ctx.shadowOffsetY = L.sizePx * 0.06;
  }
  const outline = cap.legibility === 'outline';
  ctx.lineWidth = L.sizePx * 0.16;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';

  for (let i = 0; i < L.lines.length; i++) {
    const y = firstLineY + i * L.lineHeight;
    if (outline) ctx.strokeText(L.lines[i], anchorX, y);
    ctx.fillStyle = cap.color;
    ctx.fillText(L.lines[i], anchorX, y);
  }
  ctx.restore();
  return L;
}

function lastTextLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].length > 0) return i;
  return lines.length - 1;
}

/**
 * Draw a typewriter caption for the given phase progress. Uses the full text's
 * wrapped layout (so nothing reflows as it types), reveals a leading substring,
 * and draws a blinking end-of-text cursor plus an optional select-all highlight.
 */
export function drawTypewriter(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  style: CaptionTextStyle,
  font: BoilFont,
  prog: TypewriterProgress,
): void {
  const L = measureCaption(ctx, out, style, font, false); // single font: no normalisation
  const sizePx = L.sizePx;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; // anchor each line from a fixed left edge so text doesn't reflow while typing
  ctx.font = fontCss(font, sizePx);
  ctx.lineJoin = 'round';

  const totalChars = L.lines.reduce((n, ln) => n + ln.length, 0);
  const revealCount = prog.showText
    ? Math.round(Math.max(0, Math.min(1, prog.revealFrac)) * totalChars)
    : 0;
  const firstLineY = L.cy - L.blockH / 2 + L.lineHeight / 2;

  const outline = style.legibility === 'outline';
  if (style.legibility === 'shadow') {
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = sizePx * 0.18;
    ctx.shadowOffsetY = sizePx * 0.06;
  }
  ctx.lineWidth = sizePx * 0.16;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';

  const lineLeft = (fullW: number): number => {
    if (style.align === 'center') return L.cx - fullW / 2;
    if (style.align === 'right') return L.cx + L.blockW / 2 - fullW;
    return L.cx - L.blockW / 2;
  };

  let seen = 0;
  let cursorX: number | null = null;
  let cursorY = firstLineY;

  for (let i = 0; i < L.lines.length; i++) {
    const line = L.lines[i];
    const y = firstLineY + i * L.lineHeight;
    const fullW = ctx.measureText(line).width;
    const left = lineLeft(fullW);

    let visible: string;
    if (!prog.showText) visible = '';
    else if (seen + line.length <= revealCount) visible = line;
    else if (seen < revealCount) visible = line.slice(0, revealCount - seen);
    else visible = '';

    if (prog.selectAll && line.length > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(80,140,255,0.55)';
      ctx.fillRect(left - sizePx * 0.06, y - sizePx * 0.62, fullW + sizePx * 0.12, sizePx * 1.24);
      ctx.restore();
    }

    if (visible) {
      if (outline) ctx.strokeText(visible, left, y);
      ctx.fillStyle = style.color;
      ctx.fillText(visible, left, y);
    }

    if (prog.cursor) {
      const endsHere = seen < revealCount && seen + line.length >= revealCount;
      const fullyRevealedLast = revealCount >= totalChars && i === lastTextLine(L.lines);
      if (endsHere || fullyRevealedLast) {
        cursorX = left + ctx.measureText(visible).width;
        cursorY = y;
      }
    }
    seen += line.length;
  }

  // Cursor at the very start (nothing revealed yet).
  if (prog.cursor && cursorX === null && prog.showText) {
    const l0 = L.lines[0] ?? '';
    cursorX = lineLeft(ctx.measureText(l0).width);
    cursorY = firstLineY;
  }

  if (prog.cursor && prog.cursorOn && cursorX !== null) {
    ctx.fillStyle = style.color;
    ctx.fillRect(cursorX + sizePx * 0.04, cursorY - sizePx * 0.42, Math.max(2, sizePx * 0.08), sizePx * 0.84);
  }

  ctx.restore();
}

// ---- word attachments: highlight / underline over static words ----

interface WordBox {
  index: number;
  left: number;
  right: number;
}
interface WordLine {
  yMid: number;
  words: WordBox[];
}
interface WordBoxes {
  sizePx: number;
  totalWords: number;
  lines: WordLine[];
}

/**
 * Per-word x boxes for a caption's wrapped layout, matching exactly how the
 * text is drawn (same wrap, alignment and font). Word indices run in reading
 * order across lines — the space attachments select over.
 */
export function captionWordBoxes(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  cap: CaptionTextStyle,
  font: BoilFont,
  normalize: boolean,
): WordBoxes {
  const L = measureCaption(ctx, out, cap, font, normalize);
  ctx.font = fontCss(font, L.sizePx);
  const firstLineY = L.cy - L.blockH / 2 + L.lineHeight / 2;

  const lineLeftFor = (fullW: number): number => {
    if (cap.align === 'center') return L.cx - fullW / 2;
    if (cap.align === 'right') return L.cx + L.blockW / 2 - fullW;
    return L.cx - L.blockW / 2;
  };

  const lines: WordLine[] = [];
  let gIndex = 0;
  for (let i = 0; i < L.lines.length; i++) {
    const lineStr = L.lines[i];
    const yMid = firstLineY + i * L.lineHeight;
    const tokens = lineStr.length ? lineStr.split(' ') : [];
    const lineLeft = lineLeftFor(ctx.measureText(lineStr).width);
    const words: WordBox[] = [];
    for (let k = 0; k < tokens.length; k++) {
      // Measure real prefixes so boxes line up with the rendered glyphs.
      const before = k === 0 ? '' : tokens.slice(0, k).join(' ') + ' ';
      const through = tokens.slice(0, k + 1).join(' ');
      const left = lineLeft + ctx.measureText(before).width;
      const right = lineLeft + ctx.measureText(through).width;
      words.push({ index: gIndex++, left, right });
    }
    lines.push({ yMid, words });
  }
  return { sizePx: L.sizePx, totalWords: gIndex, lines };
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const a = Math.max(0, Math.min(1, alpha));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${a})`;
}

/**
 * Draw an element's attachments for one compositing layer at time `sec`.
 * Highlights render on the `below` layer (behind the text); underlines on the
 * `above` layer. No-op unless the element is inside its static window.
 */
export function drawAttachmentsLayer(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  el: CaptionEl,
  font: BoilFont,
  sec: number,
  normalize: boolean,
  layer: 'below' | 'above',
): void {
  if (el.attachments.length === 0) return;
  const sw = staticWindowOf(el);
  if (!sw || sec < sw.start || sec >= sw.end) return;

  const wantType = layer === 'below' ? 'highlight' : 'underline';
  const relevant = el.attachments.filter((a) => a.type === wantType);
  if (relevant.length === 0) return;

  const boxes = captionWordBoxes(ctx, out, el, font, normalize);
  if (boxes.totalWords === 0) return;
  const sizePx = boxes.sizePx;
  const maxIdx = boxes.totalWords - 1;

  ctx.save();
  for (const att of relevant) {
    const absStart = sw.start + att.startInStatic;
    const p = (sec - absStart) / Math.max(0.001, att.duration);
    const reveal = attachmentReveal(att, p);
    if (!reveal) continue;

    const lo = Math.max(0, Math.min(maxIdx, Math.min(att.wordStart, att.wordEnd)));
    const hi = Math.max(0, Math.min(maxIdx, Math.max(att.wordStart, att.wordEnd)));

    for (const line of boxes.lines) {
      const inSpan = line.words.filter((w) => w.index >= lo && w.index <= hi);
      if (inSpan.length === 0) continue;
      const padX = sizePx * (att.type === 'highlight' ? 0.12 : 0.04);
      const segLeft = Math.min(...inSpan.map((w) => w.left)) - padX;
      const segRight = Math.max(...inSpan.map((w) => w.right)) + padX;
      const segW = segRight - segLeft;
      const visLeft = segLeft + segW * reveal.a;
      const visRight = segLeft + segW * reveal.b;
      const visW = visRight - visLeft;
      if (visW <= 0.5) continue;

      if (att.type === 'highlight') {
        ctx.fillStyle = hexToRgba(att.color, att.opacity);
        ctx.fillRect(visLeft, line.yMid - sizePx * 0.62, visW, sizePx * 1.24);
      } else {
        const thickness = Math.max(2, sizePx * 0.09);
        const y = line.yMid + sizePx * 0.5;
        ctx.fillStyle = att.color;
        ctx.fillRect(visLeft, y, visW, thickness);
      }
    }
  }
  ctx.restore();
}

// ---- standalone highlighter box ----

/**
 * Draw a free highlighter box at time `sec`: a translucent rectangle that
 * sweeps in from the left, holds, then slips off to the right (same easing as
 * the caption highlight). `sweepIn`/`sweepOut` are absolute seconds.
 */
export function drawHighlightBox(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  hl: {
    start: number;
    duration: number;
    sweepIn: number;
    sweepOut: number;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    opacity: number;
  },
  sec: number,
): void {
  const dur = Math.max(0.001, hl.duration);
  const t = sec - hl.start;
  if (t < 0 || t > dur) return;
  const inFrac = Math.max(0, Math.min(1, hl.sweepIn / dur));
  const outFrac = Math.max(0, Math.min(1 - inFrac, hl.sweepOut / dur));
  const reveal = attachmentReveal({ inFrac, outFrac }, t / dur);
  if (!reveal) return;

  const bx = hl.x * out.w;
  const by = hl.y * out.h;
  const bw = hl.w * out.w;
  const bh = hl.h * out.h;
  const vx = bx + bw * reveal.a;
  const vw = bw * (reveal.b - reveal.a);
  if (vw <= 0.5) return;

  ctx.save();
  ctx.fillStyle = hexToRgba(hl.color, hl.opacity);
  ctx.fillRect(vx, by, vw, bh);
  ctx.restore();
}

// ---- dramatic wording (big plain uppercase words + dim/scrim) ----

const DRAMATIC_FONT = '"Archivo Black", "Arial Black", "Helvetica Neue", Arial, sans-serif';
const DRAMATIC_BASE_FRAC = 0.11; // base size as a fraction of frame height

export interface DramaticLayout {
  lines: string[];
  size: number;
  lineHeight: number;
  cx: number;
  cy: number;
  blockW: number;
  blockH: number;
  left: number;
  top: number;
}

/** Measure a dramatic word's wrapped uppercase layout (sets ctx.font). */
export function dramaticWordLayout(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  word: DramaticWord,
): DramaticLayout {
  const size = out.h * DRAMATIC_BASE_FRAC * word.sizeScale;
  const text = (word.text || ' ').toUpperCase();
  ctx.font = `${size}px ${DRAMATIC_FONT}`;
  const lines = layoutCaptionLines(ctx, text, out.w * 0.9);
  const lineHeight = size * 1.12;
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
  const blockW = maxW;
  const blockH = lines.length * lineHeight;
  const cx = word.x * out.w;
  const cy = word.y * out.h;
  return { lines, size, lineHeight, cx, cy, blockW, blockH, left: cx - blockW / 2, top: cy - blockH / 2 };
}

function drawWordText(ctx: CanvasRenderingContext2D, L: DramaticLayout, rot = 0): void {
  ctx.save();
  if (rot) {
    ctx.translate(L.cx, L.cy);
    ctx.rotate(rot);
    ctx.translate(-L.cx, -L.cy);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const firstY = L.cy - L.blockH / 2 + L.lineHeight / 2;
  for (let i = 0; i < L.lines.length; i++) ctx.fillText(L.lines[i], L.cx, firstY + i * L.lineHeight);
  ctx.restore();
}

let dramaticScratch: HTMLCanvasElement | null = null;

/** Get (or lazily create) the reusable full-frame scratch canvas + context. */
function dramaticScratchCtx(out: OutputSize): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!dramaticScratch) dramaticScratch = document.createElement('canvas');
  const s = dramaticScratch;
  if (s.width !== out.w || s.height !== out.h) {
    s.width = out.w;
    s.height = out.h;
  }
  return s.getContext('2d');
}

/**
 * Draw one dramatic word at time `sec`:
 *  - normal:     translucent coloured word over the clear video.
 *  - inverse:    a scrim with the word knocked out (a clear window).
 *  - reflection: the footage under the word's silhouette is colour-inverted.
 */
export function drawDramaticWord(
  ctx: CanvasRenderingContext2D,
  out: OutputSize,
  word: DramaticWord,
  sec: number,
): void {
  const env = wordEnvelope(word, sec);
  if (env <= 0) return;
  const L = dramaticWordLayout(ctx, out, word);

  if (word.mode === 'normal') {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, word.opacity)) * env;
    ctx.fillStyle = word.color;
    ctx.font = `${L.size}px ${DRAMATIC_FONT}`;
    drawWordText(ctx, L, word.rotation);
    ctx.restore();
    return;
  }

  if (word.mode === 'reflection') {
    // Colour-invert the video under the word: copy the frame, difference-blend
    // white letters over it (white − colour = the negative), clip that to the
    // letter silhouette, then composite it back with opacity as the strength
    // (a clean lerp between the original footage and its negative).
    const rc = dramaticScratchCtx(out);
    if (!rc) return;
    rc.globalAlpha = 1;
    rc.globalCompositeOperation = 'source-over';
    rc.clearRect(0, 0, out.w, out.h);
    rc.drawImage(ctx.canvas, 0, 0); // copy the current video frame
    rc.font = `${L.size}px ${DRAMATIC_FONT}`;
    // invert the footage everywhere the letters cover
    rc.globalCompositeOperation = 'difference';
    rc.fillStyle = '#ffffff';
    drawWordText(rc, L, word.rotation);
    // keep only the letter silhouette (rest becomes transparent)
    rc.globalCompositeOperation = 'destination-in';
    rc.fillStyle = '#000000';
    drawWordText(rc, L, word.rotation);
    rc.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, word.opacity)) * env;
    ctx.drawImage(dramaticScratch!, 0, 0);
    ctx.restore();
    return;
  }

  // inverse: build the scrim (with the word knocked out) on a scratch canvas so
  // the cut-out reveals the video already on the main canvas.
  const sc = dramaticScratchCtx(out);
  if (!sc) return;
  sc.clearRect(0, 0, out.w, out.h);
  sc.globalCompositeOperation = 'source-over';
  sc.globalAlpha = Math.max(0, Math.min(1, word.opacity)) * env;
  sc.fillStyle = word.color;
  sc.fillRect(0, 0, out.w, out.h);
  // punch the word out of the scrim
  sc.globalAlpha = 1;
  sc.globalCompositeOperation = 'destination-out';
  sc.fillStyle = '#000';
  sc.font = `${L.size}px ${DRAMATIC_FONT}`;
  drawWordText(sc, L, word.rotation);
  sc.globalCompositeOperation = 'source-over';
  ctx.drawImage(dramaticScratch!, 0, 0);
}

// ---- zoom (source-normalised crop -> contain-fit onto output) ----

export interface FitRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Where a source of the given pixel size lands when contain-fit into `out` (centred). */
export function containRect(srcW: number, srcH: number, out: OutputSize): FitRect {
  if (srcW <= 0 || srcH <= 0) return { dx: 0, dy: 0, dw: out.w, dh: out.h };
  const scale = Math.min(out.w / srcW, out.h / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (out.w - dw) / 2, dy: (out.h - dh) / 2, dw, dh };
}

/**
 * Draw a zoomed frame: take the crop `rect` (normalised to the source) and
 * contain-fit it onto the output canvas, centred, with black letterboxing for
 * any off-ratio / out-of-bounds space. Never crops or stretches.
 */
export function drawZoomed(
  ctx: CanvasRenderingContext2D,
  src: Source,
  out: OutputSize,
  rect: ZoomRect,
): void {
  const { w: srcW, h: srcH } = sourceDims(src);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.w, out.h);
  if (srcW <= 0 || srcH <= 0) return;

  // crop rect in source pixels (may extend beyond the source bounds)
  const sx = rect.x * srcW;
  const sy = rect.y * srcH;
  const sw = rect.w * srcW;
  const sh = rect.h * srcH;
  if (sw <= 0 || sh <= 0) return;

  // contain-fit destination for the full crop rect
  const scale = Math.min(out.w / sw, out.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (out.w - dw) / 2;
  const dy = (out.h - dh) / 2;

  // clip the crop to the valid source region, mapping proportionally into dest
  const vx = Math.max(sx, 0);
  const vy = Math.max(sy, 0);
  const vx2 = Math.min(sx + sw, srcW);
  const vy2 = Math.min(sy + sh, srcH);
  if (vx2 <= vx || vy2 <= vy) return;
  const vw = vx2 - vx;
  const vh = vy2 - vy;

  const ddx = dx + ((vx - sx) / sw) * dw;
  const ddy = dy + ((vy - sy) / sh) * dh;
  const ddw = (vw / sw) * dw;
  const ddh = (vh / sh) * dh;
  ctx.drawImage(src, vx, vy, vw, vh, ddx, ddy, ddw, ddh);
}

// ---- sketch (freehand strokes projected onto the frame) ----

/** A placement box in canvas pixels. */
export interface SketchArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Contain-fit a `padAspect` (w/h) region centred inside `area`, so the sketch never distorts. */
export function sketchFitBox(area: SketchArea, padAspect: number): { ox: number; oy: number; fw: number; fh: number } {
  const areaAR = area.w / Math.max(1e-6, area.h);
  let fw: number;
  let fh: number;
  if (areaAR > padAspect) {
    fh = area.h;
    fw = fh * padAspect;
  } else {
    fw = area.w;
    fh = fw / padAspect;
  }
  return { ox: area.x + (area.w - fw) / 2, oy: area.y + (area.h - fh) / 2, fw, fh };
}

export interface SketchRenderOpts {
  /** Arc length to reveal; omit (or ≥ total) to draw the whole sketch. */
  drawnArc?: number;
  /** Draw the pencil-tip tracer at the active drawing point. */
  tracer?: boolean;
}

/**
 * Draw a set of strokes into a placement box. Reveals up to `drawnArc` of the
 * concatenated drawing (strokes in order, instant jumps between them) and, while
 * animating, traces a pencil at the current tip.
 */
export function drawSketchStrokes(
  ctx: CanvasRenderingContext2D,
  area: SketchArea,
  strokes: SketchStroke[],
  padAspect: number,
  opts: SketchRenderOpts = {},
): void {
  if (strokes.length === 0) return;
  const { ox, oy, fw, fh } = sketchFitBox(area, padAspect);
  const shorter = Math.min(fw, fh);
  const map = (p: SketchPoint) => ({ x: ox + p.x * fw, y: oy + p.y * fh });

  const geos = strokes.map((s) => geometryFor(s, padAspect));
  const total = geos.reduce((n, g) => n + g.total, 0);
  const reveal = opts.drawnArc ?? total + 1;

  let consumed = 0;
  let tip: { x: number; y: number } | null = null;

  for (let i = 0; i < strokes.length; i++) {
    const geo = geos[i];
    const start = consumed;
    const end = consumed + geo.total;
    consumed = end;
    if (reveal <= start && geo.total > 0) continue; // not started yet
    const localArc = Math.min(geo.total, Math.max(0, reveal - start));
    const partial = reveal < end;
    drawStrokePath(ctx, geo, strokes[i], localArc, map, shorter);
    if (partial && geo.total > 0) {
      const s = sampleAt(geo, localArc, padAspect);
      if (s) tip = map(s);
    }
  }

  if (opts.tracer && tip) drawPencilTracer(ctx, tip.x, tip.y, shorter);
}

/** Stroke one processed polyline up to arc length `L` (a lone point becomes a dot). */
function drawStrokePath(
  ctx: CanvasRenderingContext2D,
  geo: { pts: SketchPoint[]; cum: number[]; total: number; smooth: boolean },
  stroke: SketchStroke,
  L: number,
  map: (p: SketchPoint) => { x: number; y: number },
  shorter: number,
): void {
  const lw = Math.max(1, stroke.width * shorter);
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = lw;
  ctx.lineJoin = geo.smooth ? 'round' : 'miter';
  ctx.lineCap = geo.smooth ? 'round' : 'square';

  if (geo.pts.length === 1) {
    const p = map(geo.pts[0]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, lw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  const p0 = map(geo.pts[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < geo.pts.length; i++) {
    if (geo.cum[i] <= L) {
      const p = map(geo.pts[i]);
      ctx.lineTo(p.x, p.y);
    } else {
      // interpolate the final partial segment to exactly L
      const seg = Math.max(1e-6, geo.cum[i] - geo.cum[i - 1]);
      const f = Math.max(0, Math.min(1, (L - geo.cum[i - 1]) / seg));
      const a = geo.pts[i - 1];
      const b = geo.pts[i];
      const p = map({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      ctx.lineTo(p.x, p.y);
      break;
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * An original, canvas-drawn pencil that traces the drawing point. The graphite
 * tip sits on (x, y) and the barrel is held at a fixed up-right tilt (it does
 * not rotate with the direction of travel). Rendered in black-and-white.
 */
function drawPencilTracer(ctx: CanvasRenderingContext2D, x: number, y: number, shorter: number): void {
  const Lp = Math.max(12, shorter * 0.14);
  const wp = Lp * 0.34;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.68); // fixed pose: barrel up-right, tip on the drawing point
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, Lp * 0.035);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';

  const tipEnd = Lp * 0.2; // graphite → wood transition
  const woodEnd = Lp * 0.3;
  const barrelEnd = Lp * 0.86;
  const ferruleEnd = Lp * 0.93;

  // soft drop shadow so it reads over any footage
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = Lp * 0.12;
  ctx.shadowOffsetY = Lp * 0.05;

  // graphite point
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tipEnd, -wp * 0.28);
  ctx.lineTo(tipEnd, wp * 0.28);
  ctx.closePath();
  ctx.fillStyle = '#1c1c1c';
  ctx.fill();

  // exposed wood cone
  ctx.beginPath();
  ctx.moveTo(tipEnd, -wp * 0.28);
  ctx.lineTo(woodEnd, -wp * 0.5);
  ctx.lineTo(woodEnd, wp * 0.5);
  ctx.lineTo(tipEnd, wp * 0.28);
  ctx.closePath();
  ctx.fillStyle = '#d2d2d2';
  ctx.fill();
  ctx.stroke();

  // painted barrel
  ctx.beginPath();
  ctx.rect(woodEnd, -wp * 0.5, barrelEnd - woodEnd, wp);
  ctx.fillStyle = '#f7f7f7';
  ctx.fill();
  ctx.stroke();
  // a subtle shading stripe down the barrel
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(woodEnd, -wp * 0.32, barrelEnd - woodEnd, wp * 0.16);

  // metal ferrule
  ctx.beginPath();
  ctx.rect(barrelEnd, -wp * 0.5, ferruleEnd - barrelEnd, wp);
  ctx.fillStyle = '#b4b4b4';
  ctx.fill();
  ctx.stroke();

  // eraser
  ctx.beginPath();
  ctx.rect(ferruleEnd, -wp * 0.42, Lp - ferruleEnd, wp * 0.84);
  ctx.fillStyle = '#8c8c8c';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/** Draw one sketch element at time `sec` into a placement box (player entry point). */
export function drawSketch(ctx: CanvasRenderingContext2D, area: SketchArea, el: SketchElement, sec: number): void {
  if (el.strokes.length === 0) return;
  const total = totalArc(el.strokes, el.padAspect);
  const prog = sketchProgress(el, sec, total);
  const animating = prog.phase === 'animate';
  drawSketchStrokes(ctx, area, el.strokes, el.padAspect, {
    drawnArc: animating ? prog.drawnArc : undefined,
    tracer: el.tracer && el.animationDur > 0 && animating,
  });
}
