// ===== Doomscroll: renderer =====
//
// Everything is drawn in feed units: the transform is set once per frame so
// that 1.0 == the viewport's on-screen height, which keeps every card, gap and
// line weight resolution-independent. The two passes that work in pixels are
// the card copy and the score pops, because sub-pixel font sizes rasterise
// badly — they recompute their positions from the same unit geometry through
// `layoutCard`, so the words never drift away from the box they belong to.
//
// Glows are radial gradients rather than `shadowBlur` — the shadow pipeline is
// slow and its blur radius doesn't follow the transform consistently across
// browsers, so it would look different at every window size.

import { QUIRK_BY_ID, STICKY_STEP, scrollGain, type QuirkId } from './quirks';
import { CARD_BAR_STEP, CARD_HEADLINE, CARD_PAD } from './content';
import { ZONE_H, ZONE_Y } from './types';
import type { Card, CardKind, FeedState } from './types';

export interface View {
  /** Viewport size in CSS pixels. */
  w: number;
  h: number;
  dpr: number;
  aspect: number;
  reduceMotion: boolean;
}

const KIND_COLOR: Record<CardKind, string> = {
  post: '#7ff0ff',
  hot: '#ffd60a',
  bait: '#ff453a',
  ad: '#bf5af2',
};

const BADGE: Partial<Record<CardKind, string>> = {
  hot: 'TRENDING',
  bait: 'FOR YOU',
  ad: 'SPONSORED',
};

const rgbCache = new Map<string, string>();
function rgb(hex: string): string {
  let v = rgbCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    rgbCache.set(hex, v);
  }
  return v;
}

/** Rounded rectangle, written out rather than relying on `roundRect`. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
) {
  if (r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${alpha})`);
  g.addColorStop(0.45, `rgba(${color},${alpha * 0.34})`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** The column: a phone-shaped feed centred in whatever window it is given. */
function column(A: number) {
  const w = Math.min(0.92, Math.max(0.4, A - 0.36));
  return { x: (A - w) / 2, w };
}

interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Avatar centre. */
  ax: number;
  ay: number;
  ar: number;
  /** Baselines and boxes for the pixel text pass, in units. */
  handleY: number;
  headlineY: number;
  barsY: number;
  mediaY: number;
  innerX: number;
  innerW: number;
}

/**
 * Where everything inside a card sits, in units. Both the shape pass and the
 * text pass go through this, so a change to the padding moves the box and the
 * words it contains together.
 */
function layoutCard(c: Card, sy: number, colX: number, colW: number): CardBox {
  const ar = 0.026;
  const innerX = colX + CARD_PAD;
  const innerW = colW - CARD_PAD * 2;
  const handleY = sy + CARD_PAD + ar;
  const headlineY = handleY + ar + CARD_HEADLINE * 0.62;
  const barsY = headlineY + CARD_HEADLINE * 0.5;
  return {
    x: colX,
    y: sy,
    w: colW,
    h: c.h,
    ax: innerX + ar,
    ay: handleY,
    ar,
    handleY,
    headlineY,
    barsY,
    mediaY: barsY + c.bars.length * CARD_BAR_STEP + 0.012,
    innerX,
    innerW,
  };
}

export function draw(ctx: CanvasRenderingContext2D, st: FeedState, view: View) {
  const S = view.h;
  const A = st.aspect;
  const active = new Set<QuirkId>(st.quirks.map((q) => q.id));
  const col = column(A);

  const shakeX = st.shake ? (Math.random() - 0.5) * st.shake : 0;
  const shakeY = st.shake ? (Math.random() - 0.5) * st.shake : 0;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.setTransform(view.dpr * S, 0, 0, view.dpr * S, view.dpr * shakeX * S, view.dpr * shakeY * S);

  drawBackdrop(ctx, st, A);
  drawZoneWash(ctx, st, A);

  const visible = st.cards.filter((c) => {
    const sy = c.top - st.y;
    return sy < 1.06 && sy + c.h > -0.06;
  });

  for (const c of visible) drawCard(ctx, st, c, col);
  drawCardText(ctx, st, view, visible, col, shakeX, shakeY);
  ctx.setTransform(view.dpr * S, 0, 0, view.dpr * S, view.dpr * shakeX * S, view.dpr * shakeY * S);

  drawZoneLines(ctx, st, A);
  drawRail(ctx, st, active, A);

  ctx.globalCompositeOperation = 'lighter';
  drawParticles(ctx, st);
  ctx.globalCompositeOperation = 'source-over';
  drawRings(ctx, st);

  drawVignette(ctx, st, A);
  drawPops(ctx, st, view, shakeX, shakeY);
}

// --- Layers -----------------------------------------------------------------

function drawBackdrop(ctx: CanvasRenderingContext2D, st: FeedState, A: number) {
  const g = ctx.createLinearGradient(0, 0, 0, 1);
  g.addColorStop(0, '#070912');
  g.addColorStop(0.5, '#0e1223');
  g.addColorStop(1, '#070912');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, A, 1);

  if (st.flash > 0.01) {
    ctx.fillStyle = `rgba(${st.flashColor},${st.flash * 0.22})`;
    ctx.fillRect(0, 0, A, 1);
  }
}

/**
 * The read band, drawn *under* the cards and lit by `engagement` — so the
 * screen physically brightens as you slow down, and washes out when you flick.
 * It is the only readout of the number the entire game is scored on.
 */
function drawZoneWash(ctx: CanvasRenderingContext2D, st: FeedState, A: number) {
  const top = ZONE_Y - ZONE_H / 2;
  const eng = st.phase === 'playing' ? st.engagement : 0.35;
  const tint = st.focus >= 0 ? rgb(KIND_COLOR[st.cards[st.focus].kind]) : '120,180,255';

  const g = ctx.createLinearGradient(0, top, 0, top + ZONE_H);
  g.addColorStop(0, `rgba(${tint},0)`);
  g.addColorStop(0.5, `rgba(${tint},${0.05 + eng * 0.13})`);
  g.addColorStop(1, `rgba(${tint},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, A, ZONE_H);
}

function drawZoneLines(ctx: CanvasRenderingContext2D, st: FeedState, A: number) {
  const eng = st.phase === 'playing' ? st.engagement : 0.35;
  const tint = st.focus >= 0 ? rgb(KIND_COLOR[st.cards[st.focus].kind]) : '120,180,255';

  ctx.strokeStyle = `rgba(${tint},${0.16 + eng * 0.34})`;
  ctx.lineWidth = 0.0022;
  ctx.beginPath();
  ctx.moveTo(0, ZONE_Y);
  ctx.lineTo(A, ZONE_Y);
  ctx.stroke();

  // Ticks at the ends, so the line reads as an instrument rather than a seam.
  ctx.strokeStyle = `rgba(${tint},${0.3 + eng * 0.4})`;
  ctx.lineWidth = 0.004;
  for (const [x0, x1] of [
    [0, 0.055],
    [A - 0.055, A],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, ZONE_Y);
    ctx.lineTo(x1, ZONE_Y);
    ctx.stroke();
  }
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  st: FeedState,
  c: Card,
  col: { x: number; w: number },
) {
  const sy = c.top - st.y;
  const b = layoutCard(c, sy, col.x, col.w);
  const color = KIND_COLOR[c.kind];
  const tint = rgb(color);
  const focused = st.focus >= 0 && st.cards[st.focus].id === c.id;
  const live = focused && !c.done;

  ctx.save();
  if (c.done) ctx.globalAlpha = 0.42;

  if (live) glow(ctx, col.x + col.w / 2, sy + c.h / 2, col.w * 0.75, tint, 0.1);

  // Body.
  rr(ctx, b.x, b.y, b.w, b.h, 0.026);
  const g = ctx.createLinearGradient(0, sy, 0, sy + c.h);
  g.addColorStop(0, `rgba(${tint},${c.kind === 'post' ? 0.05 : 0.09})`);
  g.addColorStop(1, 'rgba(10,13,24,0.0)');
  ctx.fillStyle = 'rgba(16,20,34,0.94)';
  ctx.fill();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `rgba(${tint},${live ? 0.55 : 0.2})`;
  ctx.lineWidth = live ? 0.0032 : 0.0018;
  ctx.stroke();

  // Avatar.
  ctx.fillStyle = `rgba(${tint},0.28)`;
  ctx.beginPath();
  ctx.arc(b.ax, b.ay, b.ar, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${tint},0.5)`;
  ctx.lineWidth = 0.0016;
  ctx.stroke();

  // Skeleton body copy — a feed in the half-second before it loads.
  ctx.fillStyle = 'rgba(190,206,235,0.14)';
  for (let i = 0; i < c.bars.length; i++) {
    rr(ctx, b.innerX, b.barsY + i * CARD_BAR_STEP, b.innerW * c.bars[i], 0.016, 0.008);
    ctx.fill();
  }

  if (c.media) {
    rr(ctx, b.innerX, b.mediaY, b.innerW, c.media, 0.016);
    const mg = ctx.createLinearGradient(b.innerX, b.mediaY, b.innerX + b.innerW, b.mediaY + c.media);
    mg.addColorStop(0, `rgba(${tint},0.16)`);
    mg.addColorStop(1, 'rgba(120,140,190,0.06)');
    ctx.fillStyle = mg;
    ctx.fill();
  }

  ctx.restore();

  // The meter: a bar down the left edge of the card, in the card's own colour.
  // Posts fill it to bank, bait fills it to hook, ads fill it while they hold —
  // one shape, so "something is filling up" always means "act now".
  if (c.meter > 0.001) {
    const mx = b.x - 0.014;
    ctx.strokeStyle = `rgba(${tint},${c.done ? 0.35 : 0.9})`;
    ctx.lineWidth = 0.007;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx, sy + 0.02);
    ctx.lineTo(mx, sy + 0.02 + (c.h - 0.04) * Math.min(1, c.meter));
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

/**
 * The words. A separate pass under a pixel transform, because a font size of
 * 0.046 units means nothing to a rasteriser — but every position still comes
 * from `layoutCard`, in units, multiplied up here.
 */
function drawCardText(
  ctx: CanvasRenderingContext2D,
  st: FeedState,
  view: View,
  visible: Card[],
  col: { x: number; w: number },
  shakeX: number,
  shakeY: number,
) {
  const S = view.h;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.textBaseline = 'middle';

  const ui = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  for (const c of visible) {
    const sy = c.top - st.y;
    const b = layoutCard(c, sy, col.x, col.w);
    const tint = rgb(KIND_COLOR[c.kind]);
    const alpha = c.done ? 0.4 : 1;
    const px = (u: number) => (u + shakeX) * S;
    const py = (u: number) => (u + shakeY) * S;

    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(S * 0.03)}px ${ui}`;
    ctx.fillStyle = `rgba(${tint},${0.75 * alpha})`;
    ctx.fillText(c.handle, px(b.ax + b.ar + 0.018), py(b.handleY));

    const badge = BADGE[c.kind];
    if (badge) {
      ctx.textAlign = 'right';
      ctx.font = `700 ${Math.round(S * 0.023)}px ${ui}`;
      ctx.fillStyle = `rgba(${tint},${0.62 * alpha})`;
      ctx.fillText(badge, px(b.innerX + b.innerW), py(b.handleY));
      ctx.textAlign = 'left';
    }

    ctx.font = `${c.kind === 'bait' ? 800 : 600} ${Math.round(S * 0.045)}px ${ui}`;
    ctx.fillStyle =
      c.kind === 'bait'
        ? `rgba(255,140,150,${0.95 * alpha})`
        : `rgba(233,241,255,${0.94 * alpha})`;
    ctx.fillText(
      fit(ctx, c.kind === 'bait' ? c.headline.toUpperCase() : c.headline, b.innerW * S),
      px(b.innerX),
      py(b.headlineY),
    );
  }

  // The ad's countdown, drawn last so it sits over its own card.
  const pin = st.pin;
  if (pin) {
    const card = st.cards.find((c) => c.id === pin.id);
    if (card) {
      const b = layoutCard(card, card.top - st.y, col.x, col.w);
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(S * 0.032)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillStyle = 'rgba(216,180,255,0.92)';
      ctx.fillText(
        `SKIP IN ${Math.max(0, pin.left).toFixed(1)}s`,
        (b.x + b.w / 2 + shakeX) * S,
        (b.y + b.h - 0.03 + shakeY) * S,
      );
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Truncate to fit a pixel width, with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string {
  if (ctx.measureText(text).width <= maxPx) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/**
 * The rail: a scrollbar drawn through the *same* gain the input goes through.
 * Its ticks are one tenth of a screen of hand movement apart, so under Firehose
 * they visibly spread, and its arrow points wherever a downward flick actually
 * sends the feed — which flips under Inverted. Like Drift's floor grid, it is
 * derived from the transform rather than drawn to match it, so it can't show a
 * distortion the controls aren't applying.
 */
function drawRail(
  ctx: CanvasRenderingContext2D,
  st: FeedState,
  active: Set<QuirkId>,
  A: number,
) {
  const x = A - 0.052;
  const gain = scrollGain(active);
  const mag = Math.max(0.05, Math.abs(gain));
  const tint = st.quirks.length ? rgb(QUIRK_BY_ID[st.quirks[0].id].color) : '120,180,255';

  ctx.strokeStyle = `rgba(${tint},0.14)`;
  ctx.lineWidth = 0.0035;
  ctx.beginPath();
  ctx.moveTo(x, 0.08);
  ctx.lineTo(x, 0.92);
  ctx.stroke();

  // Ticks travel with the feed, spaced by the distance one notch now covers.
  const step = 0.1 * mag;
  const phase = ((st.y / step) % 1) * step;
  ctx.strokeStyle = `rgba(${tint},0.3)`;
  ctx.lineWidth = 0.0028;
  ctx.beginPath();
  for (let y = 0.08 - phase; y < 0.92; y += step) {
    if (y < 0.08) continue;
    ctx.moveTo(x - 0.012, y);
    ctx.lineTo(x + 0.012, y);
  }
  ctx.stroke();

  // Which way a push down the wheel sends the feed.
  const dir = gain < 0 ? -1 : 1;
  const ay = ZONE_Y + dir * 0.1;
  ctx.fillStyle = `rgba(${tint},0.75)`;
  ctx.beginPath();
  ctx.moveTo(x, ay + dir * 0.026);
  ctx.lineTo(x - 0.018, ay - dir * 0.012);
  ctx.lineTo(x + 0.018, ay - dir * 0.012);
  ctx.closePath();
  ctx.fill();

  // The dead band, at exactly the size Sticky swallows.
  if (active.has('sticky')) {
    const half = (STICKY_STEP * mag) / 2;
    ctx.strokeStyle = 'rgba(191,90,242,0.85)';
    ctx.lineWidth = 0.009;
    ctx.beginPath();
    ctx.moveTo(x, ZONE_Y - half);
    ctx.lineTo(x, ZONE_Y + half);
    ctx.stroke();
  }

  // A thumb that shows how fast the feed is actually moving.
  const speed = Math.min(1, Math.abs(st.v) / 2.5);
  if (speed > 0.02) {
    ctx.strokeStyle = `rgba(${tint},${0.25 + speed * 0.5})`;
    ctx.lineWidth = 0.0075;
    ctx.lineCap = 'round';
    const len = 0.05 + speed * 0.16;
    const from = ZONE_Y - (st.v > 0 ? len : -len);
    ctx.beginPath();
    ctx.moveTo(x, from);
    ctx.lineTo(x, ZONE_Y);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, st: FeedState) {
  for (const q of st.particles) {
    const a = q.life / q.max;
    ctx.fillStyle = `rgba(${rgb(q.color)},${a * 0.85})`;
    ctx.beginPath();
    ctx.arc(q.p.x, q.p.y, q.r * (0.4 + a), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRings(ctx: CanvasRenderingContext2D, st: FeedState) {
  for (const r of st.rings) {
    const a = r.life / r.maxLife;
    ctx.strokeStyle = `rgba(${rgb(r.color)},${a * 0.5})`;
    ctx.lineWidth = r.width * (0.4 + a);
    ctx.beginPath();
    ctx.arc(r.p.x, r.p.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, st: FeedState, A: number) {
  const g = ctx.createLinearGradient(0, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.22, 'rgba(0,0,0,0)');
  g.addColorStop(0.78, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, A, 1);

  // Rim: turns red as the attention runs out, so the pressure is peripheral.
  const panic = st.phase === 'playing' ? Math.max(0, 1 - st.attention / 6) : 0;
  if (panic > 0) {
    ctx.strokeStyle = `rgba(255,69,58,${panic * (0.35 + 0.25 * Math.sin(st.t * 9))})`;
    ctx.lineWidth = 0.012;
    ctx.strokeRect(0.006, 0.006, A - 0.012, 1 - 0.012);
  }
}

function drawPops(
  ctx: CanvasRenderingContext2D,
  st: FeedState,
  view: View,
  shakeX: number,
  shakeY: number,
) {
  if (!st.pops.length) return;
  const S = view.h;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(S * 0.036)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  for (const p of st.pops) {
    const a = Math.min(1, p.life / 0.55);
    ctx.fillStyle = `rgba(${rgb(p.color)},${a})`;
    ctx.fillText(p.text, (p.p.x + shakeX) * S, (p.p.y + shakeY) * S);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
