// ===== Rendering: aspect-ratio compositing + the Smash-style banner =====

import type { BannerFrame, BannerStyle, FillMode, OutputSize, RatioKey } from './types';
import { RATIOS } from './types';
import type { CaptionTextStyle, TypewriterProgress } from './captions/types';
import type { BoilFont } from './captions/fonts';
import { fontCss } from './captions/fonts';

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
