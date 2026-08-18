// ===== Drift: renderer =====
//
// Everything is drawn in arena units: the transform is set once per frame so
// that 1.0 == the arena's on-screen height, which keeps every radius, speed and
// line weight in the simulation resolution-independent. The only pass that
// works in pixels is the text at the end, because sub-pixel font sizes rasterise
// badly.
//
// Glows are radial gradients rather than `shadowBlur` — the shadow pipeline is
// slow and its blur radius doesn't follow the transform consistently across
// browsers, so it would look different at every window size.

import { WARP_BY_ID, warpBasis, type WarpId } from './warps';
import { HUNTER_GRACE } from './types';
import type { GameState } from './types';

export interface View {
  /** Arena size in CSS pixels. */
  w: number;
  h: number;
  dpr: number;
  aspect: number;
  reduceMotion: boolean;
}

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

export function draw(ctx: CanvasRenderingContext2D, st: GameState, view: View) {
  const S = view.h;
  const A = st.aspect;
  const active = new Set<WarpId>(st.warps.map((w) => w.id));

  const shakeX = st.shake ? (Math.random() - 0.5) * st.shake : 0;
  const shakeY = st.shake ? (Math.random() - 0.5) * st.shake : 0;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.setTransform(view.dpr * S, 0, 0, view.dpr * S, view.dpr * shakeX * S, view.dpr * shakeY * S);

  drawBackdrop(ctx, st, A);
  drawGrid(ctx, st, view, active, A);
  drawWells(ctx, st);
  drawRings(ctx, st);

  ctx.globalCompositeOperation = 'lighter';
  drawOrbs(ctx, st);
  drawParticles(ctx, st);
  ctx.globalCompositeOperation = 'source-over';

  drawHunters(ctx, st);
  drawPlayer(ctx, st, active);
  drawVignette(ctx, st, A);
  drawPops(ctx, st, view, shakeX, shakeY);
}

// --- Layers -----------------------------------------------------------------

function drawBackdrop(ctx: CanvasRenderingContext2D, st: GameState, A: number) {
  const g = ctx.createRadialGradient(A / 2, 0.5, 0.05, A / 2, 0.5, Math.max(A, 1) * 0.78);
  g.addColorStop(0, '#141a2c');
  g.addColorStop(0.6, '#0d1120');
  g.addColorStop(1, '#070912');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, A, 1);

  if (st.flash > 0.01) {
    ctx.fillStyle = `rgba(${st.flashColor},${st.flash * 0.22})`;
    ctx.fillRect(0, 0, A, 1);
  }
}

/**
 * The lattice is drawn through the *same* matrix the input goes through, so the
 * floor visibly tilts, mirrors and coarsens exactly as your control does. It is
 * the only cue that tells you which lie is currently in force without reading
 * the HUD.
 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  st: GameState,
  view: View,
  active: Set<WarpId>,
  A: number,
) {
  const { e1, e2 } = warpBasis(active, st.spinAngle);
  const tint = st.warps.length ? rgb(WARP_BY_ID[st.warps[0].id].color) : '90,200,250';

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, A, 1);
  ctx.clip();

  const cx = st.player.p.x;
  const cy = st.player.p.y;
  const g = 0.08;
  const n = Math.ceil((Math.max(A, 1) * 1.6) / g) + 2;
  const span = n * g;

  ctx.lineWidth = 0.0016;
  ctx.strokeStyle = `rgba(${tint},${st.warps.length ? 0.11 : 0.07})`;
  ctx.beginPath();
  for (let i = -n; i <= n; i++) {
    const o = i * g;
    // Family 1: constant along e1, swept along e2 (and vice versa).
    ctx.moveTo(cx + e1.x * o - e2.x * span, cy + e1.y * o - e2.y * span);
    ctx.lineTo(cx + e1.x * o + e2.x * span, cy + e1.y * o + e2.y * span);
    ctx.moveTo(cx + e2.x * o - e1.x * span, cy + e2.y * o - e1.y * span);
    ctx.lineTo(cx + e2.x * o + e1.x * span, cy + e2.y * o + e1.y * span);
  }
  ctx.stroke();

  // Axes of the warped frame, brighter — this is "which way is right".
  if (st.warps.length && !view.reduceMotion) {
    ctx.lineWidth = 0.0026;
    ctx.strokeStyle = `rgba(${tint},0.22)`;
    ctx.beginPath();
    ctx.moveTo(cx - e1.x * span, cy - e1.y * span);
    ctx.lineTo(cx + e1.x * span, cy + e1.y * span);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWells(ctx: CanvasRenderingContext2D, st: GameState) {
  for (const w of st.wells) {
    const color = w.sign > 0 ? '255,69,58' : '48,209,88';
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, w.p.x, w.p.y, 0.2, color, 0.16);
    ctx.globalCompositeOperation = 'source-over';

    ctx.lineWidth = 0.0035;
    for (let i = 0; i < 3; i++) {
      const r = 0.045 + i * 0.035;
      // Attractors spiral inward, repulsors outward.
      const a = w.phase * (w.sign > 0 ? 1 : -1) * (1 + i * 0.35);
      ctx.strokeStyle = `rgba(${color},${0.5 - i * 0.13})`;
      ctx.beginPath();
      ctx.arc(w.p.x, w.p.y, r, a, a + 2.1);
      ctx.stroke();
    }
  }
}

function drawRings(ctx: CanvasRenderingContext2D, st: GameState) {
  ctx.globalCompositeOperation = 'lighter';
  for (const r of st.rings) {
    const k = r.life / r.maxLife;
    ctx.strokeStyle = `rgba(${rgb(r.color)},${k * 0.55})`;
    ctx.lineWidth = r.width * k;
    ctx.beginPath();
    ctx.arc(r.p.x, r.p.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawOrbs(ctx: CanvasRenderingContext2D, st: GameState) {
  for (const o of st.orbs) {
    const pop = Math.min(1, o.age / 0.26);
    const s = 1 - Math.pow(1 - pop, 3);
    const pulse = 1 + Math.sin(st.t * 3.1 + o.seed) * 0.12;
    const r = o.r * s * pulse;

    glow(ctx, o.p.x, o.p.y, r * 4.2, '127,240,255', 0.5);
    ctx.fillStyle = 'rgba(226,253,255,0.95)';
    ctx.beginPath();
    ctx.arc(o.p.x, o.p.y, r * 0.52, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(127,240,255,${0.55 * s})`;
    ctx.lineWidth = 0.0026;
    ctx.beginPath();
    ctx.arc(o.p.x, o.p.y, r * (1.5 + Math.sin(st.t * 2.2 + o.seed) * 0.18), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, st: GameState) {
  for (const q of st.particles) {
    const a = Math.max(0, q.life / q.max);
    ctx.fillStyle = `rgba(${rgb(q.color)},${a})`;
    ctx.beginPath();
    ctx.arc(q.p.x, q.p.y, q.r * (0.4 + a), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHunters(ctx: CanvasRenderingContext2D, st: GameState) {
  for (const h of st.hunters) {
    // The fade-in doubles as the damage grace period, so a hunter is only ever
    // dangerous once it is fully drawn.
    const entering = Math.min(1, h.age / HUNTER_GRACE);

    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, h.p.x, h.p.y, h.r * 4, '255,55,95', 0.34 * entering);
    ctx.globalCompositeOperation = 'source-over';

    // A three-pointed shard, rotating, with the points stretched along travel.
    const speed = Math.hypot(h.v.x, h.v.y);
    const stretch = 1 + Math.min(0.6, speed * 0.8);
    ctx.save();
    ctx.translate(h.p.x, h.p.y);
    ctx.rotate(Math.atan2(h.v.y, h.v.x));
    ctx.scale(stretch, 1 / Math.sqrt(stretch));
    ctx.rotate(h.spin);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rr = i % 2 === 0 ? h.r * 1.15 : h.r * 0.42;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(24,6,14,${0.92 * entering})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,69,90,${0.95 * entering})`;
    ctx.lineWidth = 0.0032;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = `rgba(255,120,140,${0.9 * entering})`;
    ctx.beginPath();
    ctx.arc(h.p.x, h.p.y, h.r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, st: GameState, active: Set<WarpId>) {
  const pl = st.player;
  const speed = Math.hypot(pl.v.x, pl.v.y);
  const hot = Math.min(1, speed / 1.8);
  const hurt = pl.invuln > 0;
  const blink = hurt ? 0.45 + 0.55 * Math.abs(Math.sin(st.t * 22)) : 1;

  // Trail: one tapered stroke per segment so it thins and fades toward the tail.
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 1; i < pl.trail.length; i++) {
    const k = i / pl.trail.length;
    ctx.strokeStyle = `rgba(140,220,255,${k * k * 0.4 * blink})`;
    ctx.lineWidth = 0.002 + k * 0.014;
    ctx.beginPath();
    ctx.moveTo(pl.trail[i - 1].x, pl.trail[i - 1].y);
    ctx.lineTo(pl.trail[i].x, pl.trail[i].y);
    ctx.stroke();
  }

  glow(ctx, pl.p.x, pl.p.y, 0.075 + hot * 0.05, '150,225,255', 0.5 * blink);
  ctx.globalCompositeOperation = 'source-over';

  // Ghost chevron: the direction your hand actually moved, before the warps got
  // hold of it. Under Mirror or Spin this is the only truth on screen.
  if (active.size && (Math.abs(pl.raw.x) > 0.01 || Math.abs(pl.raw.y) > 0.01)) {
    const gx = pl.p.x + pl.raw.x * 0.062;
    const gy = pl.p.y + pl.raw.y * 0.062;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(Math.atan2(pl.raw.y, pl.raw.x));
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.0028;
    ctx.beginPath();
    ctx.moveTo(-0.012, -0.011);
    ctx.lineTo(0.008, 0);
    ctx.lineTo(-0.012, 0.011);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = `rgba(255,255,255,${blink})`;
  ctx.beginPath();
  ctx.arc(pl.p.x, pl.p.y, 0.02, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${hurt ? '255,90,110' : '120,215,255'},${0.9 * blink})`;
  ctx.lineWidth = 0.0038;
  ctx.beginPath();
  ctx.arc(pl.p.x, pl.p.y, 0.031, 0, Math.PI * 2);
  ctx.stroke();

  if (hurt) {
    ctx.strokeStyle = `rgba(255,69,58,${0.5 * (pl.invuln / 1.5)})`;
    ctx.lineWidth = 0.003;
    ctx.beginPath();
    ctx.arc(pl.p.x, pl.p.y, 0.045 + (1.5 - pl.invuln) * 0.02, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, st: GameState, A: number) {
  const g = ctx.createRadialGradient(A / 2, 0.5, Math.max(A, 1) * 0.28, A / 2, 0.5, Math.max(A, 1) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, A, 1);

  // Rim: turns red as the clock runs out, so the pressure is peripheral.
  const panic = st.phase === 'playing' ? Math.max(0, 1 - st.timeLeft / 6) : 0;
  if (panic > 0) {
    ctx.strokeStyle = `rgba(255,69,58,${panic * (0.35 + 0.25 * Math.sin(st.t * 9))})`;
    ctx.lineWidth = 0.012;
    ctx.strokeRect(0.006, 0.006, A - 0.012, 1 - 0.012);
  }
}

function drawPops(
  ctx: CanvasRenderingContext2D,
  st: GameState,
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
