// ===== Drawing =====
//
// Reads state, mutates nothing. Like Drift, this is the only file that knows
// what a pixel is: it sets one transform per frame so that 1 world unit is one
// tile on screen, and everything below is drawn in tiles.
//
// The look is a soundstage — a dark floor, a hard key light on the performer,
// and the past takes standing around in it like exposures left on the film.

import { cellAt } from './levels';
import { Cell, PLAYER_H, PLAYER_W, sampleTake, type Level, type Take } from './types';
import type { SimState } from './sim';

export interface View {
  w: number;
  h: number;
  dpr: number;
}

/** How the level is mapped onto the canvas this frame. */
interface Camera {
  scale: number;
  ox: number;
  oy: number;
}

interface Bounds { x0: number; y0: number; x1: number; y1: number }

/**
 * The part of the grid worth showing.
 *
 * Levels are authored on a generous grid so there is always sky to jump into,
 * but framing the whole grid puts the action in a strip along the bottom with
 * two thirds of the stage empty. So the shot is composed on the cells that
 * actually exist, plus enough headroom above the highest one to follow a jump
 * — which is the only reason the empty rows were there in the first place.
 */
const HEADROOM = 3.4;
const boundsCache = new WeakMap<Level, Bounds>();

function contentBounds(level: Level): Bounds {
  const cached = boundsCache.get(level);
  if (cached) return cached;

  let x0 = level.w, y0 = level.h, x1 = 0, y1 = 0;
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      if (cellAt(level, x, y) === Cell.Empty) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  // A level with nothing in it would invert; fall back to the whole grid.
  if (x0 > x1 || y0 > y1) {
    x0 = 0; y0 = 0; x1 = level.w - 1; y1 = level.h - 1;
  }
  const b: Bounds = {
    x0: x0 - 0.5,
    y0: Math.max(-1, y0 - HEADROOM),
    x1: x1 + 1.5,
    y1: y1 + 1.5,
  };
  boundsCache.set(level, b);
  return b;
}

/**
 * The shape of the composed shot, so the page can give the stage exactly that
 * aspect. Letterboxing a wide shot into a fixed box was leaving a third of the
 * stage as dead black; matching the box to the shot means every level fills it.
 */
export function shotAspect(level: Level): number {
  const b = contentBounds(level);
  return clamp((b.x1 - b.x0) / (b.y1 - b.y0), 1.9, 4.0);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Fit the composed shot into the canvas, centred. */
function cameraFor(level: Level, view: View): Camera {
  const b = contentBounds(level);
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const scale = Math.min(view.w / bw, view.h / bh);
  return {
    scale,
    ox: (view.w - bw * scale) / 2 - b.x0 * scale,
    oy: (view.h - bh * scale) / 2 - b.y0 * scale,
  };
}

const PALETTE = {
  sky: '#0b0d14',
  floorTop: '#3a3f52',
  floorBody: '#22263a',
  floorEdge: '#4d5470',
  spike: '#ff4d6d',
  mark: '#ffd60a',
  player: '#fff6e8',
  playerEdge: '#ffb703',
  ghost: '#5ac8fa',
};

export function draw(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
  const { level } = state;
  const cam = cameraFor(level, view);

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);

  // Stage backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, view.h);
  bg.addColorStop(0, '#10131f');
  bg.addColorStop(1, PALETTE.sky);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, view.w, view.h);

  // From here on, one unit is one tile.
  ctx.setTransform(view.dpr * cam.scale, 0, 0, view.dpr * cam.scale, view.dpr * cam.ox, view.dpr * cam.oy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawKeyLight(ctx, state, level);
  drawTerrain(ctx, level);
  drawGhosts(ctx, state);
  drawPerformer(ctx, state);

  // Vignette, drawn back in screen space so it hugs the frame not the level.
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const vig = ctx.createRadialGradient(
    view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.35,
    view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, view.w, view.h);
}

/** A soft pool of light following the performer, so the eye knows who to watch. */
function drawKeyLight(ctx: CanvasRenderingContext2D, state: SimState, level: Level): void {
  const cx = state.body.x + PLAYER_W / 2;
  const cy = state.body.y + PLAYER_H / 2;
  const g = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, 9);
  g.addColorStop(0, 'rgba(255, 236, 200, 0.16)');
  g.addColorStop(1, 'rgba(255, 236, 200, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(-2, -HEADROOM - 2, level.w + 4, level.h + 4);
}

function drawTerrain(ctx: CanvasRenderingContext2D, level: Level): void {
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const cell = cellAt(level, x, y);
      if (cell === Cell.Solid) drawSolid(ctx, level, x, y);
      else if (cell === Cell.Spike) drawSpikes(ctx, x, y);
      else if (cell === Cell.Mark) drawMark(ctx, x, y);
    }
  }
}

function drawSolid(ctx: CanvasRenderingContext2D, level: Level, x: number, y: number): void {
  ctx.fillStyle = PALETTE.floorBody;
  ctx.fillRect(x, y, 1, 1);
  // Only cap the tiles that are actually a surface — an unbroken lit edge along
  // the top of each platform reads as a floor; capping every tile reads as tiles.
  if (cellAt(level, x, y - 1) !== Cell.Solid) {
    ctx.fillStyle = PALETTE.floorTop;
    ctx.fillRect(x, y, 1, 0.16);
    ctx.fillStyle = PALETTE.floorEdge;
    ctx.fillRect(x, y, 1, 0.05);
  }
}

function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PALETTE.spike;
  const teeth = 3;
  for (let i = 0; i < teeth; i++) {
    const x0 = x + i / teeth;
    ctx.beginPath();
    ctx.moveTo(x0, y + 1);
    ctx.lineTo(x0 + 1 / teeth / 2, y + 0.28);
    ctx.lineTo(x0 + 1 / teeth, y + 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 77, 109, 0.22)';
  ctx.fillRect(x, y + 0.86, 1, 0.14);
}

/** The mark: tape on the floor, the thing you have to hit. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x + 0.5, y + 0.5);
  ctx.strokeStyle = PALETTE.mark;
  ctx.lineWidth = 0.14;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(-0.3, -0.3); ctx.lineTo(0.3, 0.3);
  ctx.moveTo(0.3, -0.3); ctx.lineTo(-0.3, 0.3);
  ctx.stroke();
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 0.34;
  ctx.stroke();
  ctx.restore();
}

/** Past takes, oldest faintest — they read as exposures left on the film. */
function drawGhosts(ctx: CanvasRenderingContext2D, state: SimState): void {
  const n = state.ghosts.length;
  state.ghosts.forEach((take: Take, i: number) => {
    const box = sampleTake(take, state.step);
    if (!box) return;
    const held = state.step >= take.steps;
    // Newer takes are more present than older ones, but never so faint that a
    // platform you are about to stand on is invisible.
    const alpha = (0.34 + 0.42 * ((i + 1) / n)) * (held ? 0.92 : 1);
    figure(ctx, box.x, box.y, PALETTE.ghost, alpha, true);
  });
}

function drawPerformer(ctx: CanvasRenderingContext2D, state: SimState): void {
  if (state.ending === 'died') return;
  figure(ctx, state.body.x, state.body.y, PALETTE.player, 1, false);
}

/** One body: a shoulders-and-head silhouette, drawn in tiles. */
function figure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  alpha: number,
  ghost: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;

  const headR = PLAYER_W * 0.30;
  const headY = y + headR + 0.04;
  const bodyTop = headY + headR * 0.72;

  ctx.fillStyle = color;
  // Torso
  roundRect(ctx, x + 0.06, bodyTop, PLAYER_W - 0.12, y + PLAYER_H - bodyTop, 0.14);
  ctx.fill();
  // Head
  ctx.beginPath();
  ctx.arc(x + PLAYER_W / 2, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  if (ghost) {
    // A thin rim keeps a faint take readable as a solid surface.
    ctx.globalAlpha = Math.min(1, alpha + 0.28);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.035;
    roundRect(ctx, x + 0.06, bodyTop, PLAYER_W - 0.12, y + PLAYER_H - bodyTop, 0.14);
    ctx.stroke();
    // The surface you can stand on, called out explicitly.
    ctx.globalAlpha = Math.min(1, alpha + 0.4);
    ctx.lineWidth = 0.055;
    ctx.beginPath();
    ctx.moveTo(x + 0.04, y + 0.015);
    ctx.lineTo(x + PLAYER_W - 0.04, y + 0.015);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PALETTE.playerEdge;
    ctx.lineWidth = 0.045;
    roundRect(ctx, x + 0.06, bodyTop, PLAYER_W - 0.12, y + PLAYER_H - bodyTop, 0.14);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
