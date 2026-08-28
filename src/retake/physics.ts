// ===== The movement model =====
//
// One pure function, `stepBody`, integrated at a fixed rate. It is pure in the
// sense that matters here: given the same body, input and collider it always
// produces the same result — no clock, no randomness, no frame-rate term. That
// is not tidiness, it is the whole game. A take is replayed by handing the
// recorded path back to the world, and a ghost that drifts by a pixel is a
// ghost you fall through.
//
// Everything is in tiles and seconds. y grows downward, so gravity is +y and a
// jump is a negative vy.

import { PLAYER_H, PLAYER_W, type Body, type Box, type Input } from './types';

// ===== Tuning =====
// Chosen so a jump clears 2 tiles comfortably and 3 never, which is the unit
// every level is designed in. Changing these re-designs every shot at once.

/** Downward acceleration, tiles/s². */
export const GRAVITY = 46;
/** Upward speed at the instant of a jump. Apex ≈ v²/2g ≈ 2.6 tiles. */
export const JUMP_V = 15.5;
/** Falling is capped so a long drop stays readable and can't tunnel. */
export const MAX_FALL = 28;
/** Top running speed. */
export const RUN_SPEED = 8.5;
/** How hard the body accelerates toward RUN_SPEED. */
export const RUN_ACCEL = 85;
export const AIR_ACCEL = 55;
/** How hard it slows when nothing is held. */
export const RUN_FRICTION = 75;
export const AIR_FRICTION = 12;

/**
 * Ground-leniency: you may still jump for this long after walking off an edge.
 * Every platformer does this and none of them mention it; a jump refused one
 * frame after the ledge reads as the game being broken, not as precision.
 */
export const COYOTE = 0.09;
/**
 * A jump pressed this long before landing still fires on touchdown, so holding
 * a rhythm down a staircase works instead of eating a dropped input.
 */
export const JUMP_BUFFER = 0.11;
/**
 * Releasing jump early clips the rise to this speed, which is what makes the
 * height variable. It is a clamp rather than a multiply so the result doesn't
 * depend on how many steps happened before the release.
 */
export const JUMP_CUT_V = 5.0;

/** The world a body moves through. */
export interface Collider {
  /** Solid terrain. Out of bounds is solid at the sides and open above/below. */
  solidAt(tx: number, ty: number): boolean;
  /** Solid moving boxes — past takes — already advanced for this step. */
  movers: readonly Box[];
}

/** What happened to a body during one step. */
export interface StepResult {
  /** Landed on something this step (was airborne, now grounded). */
  landed: boolean;
  /** A jump actually fired this step. */
  jumped: boolean;
  /** Ran into a wall horizontally. */
  hitWall: boolean;
  /** The mover the body is standing on, or -1. */
  carrier: number;
}

const overlaps = (
  ax: number, ay: number, aw: number, ah: number,
  b: Box,
) => ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;

/**
 * Advance one body by exactly `dt`.
 *
 * Axis-separated: the body moves in x and resolves, then moves in y and
 * resolves. Resolving one axis at a time is what stops a body that is walking
 * into a wall from also being ejected upward, which is the classic way a
 * platformer starts climbing sheer surfaces.
 */
export function stepBody(
  body: Body,
  input: Input,
  world: Collider,
  dt: number,
): StepResult {
  const result: StepResult = { landed: false, jumped: false, hitWall: false, carrier: -1 };
  const wasGrounded = body.onGround;

  // --- Intent -------------------------------------------------------------
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) body.facing = dir as 1 | -1;

  const accel = body.onGround ? RUN_ACCEL : AIR_ACCEL;
  if (dir !== 0) {
    body.vx += dir * accel * dt;
    // Clamp only the direction being pushed, so speed picked up elsewhere
    // (being carried, say) bleeds off through friction instead of vanishing.
    if (dir > 0 && body.vx > RUN_SPEED) body.vx = Math.max(RUN_SPEED, body.vx - accel * dt);
    if (dir < 0 && body.vx < -RUN_SPEED) body.vx = Math.min(-RUN_SPEED, body.vx + accel * dt);
  } else {
    const friction = (body.onGround ? RUN_FRICTION : AIR_FRICTION) * dt;
    body.vx = Math.abs(body.vx) <= friction ? 0 : body.vx - Math.sign(body.vx) * friction;
  }

  // --- Jump ---------------------------------------------------------------
  // The press is an edge, not a level: holding the button through a landing
  // must not re-fire, or every landing bounces.
  if (input.jump && !body.heldJump) body.buffer = JUMP_BUFFER;
  body.heldJump = input.jump;
  body.buffer = Math.max(0, body.buffer - dt);

  if (body.buffer > 0 && (body.onGround || body.coyote > 0)) {
    body.vy = -JUMP_V;
    body.buffer = 0;
    body.coyote = 0;
    body.onGround = false;
    result.jumped = true;
  }

  // Let go on the way up and the rise is clipped short.
  if (!input.jump && body.vy < -JUMP_CUT_V) body.vy = -JUMP_CUT_V;

  // --- Gravity ------------------------------------------------------------
  body.vy += GRAVITY * dt;
  if (body.vy > MAX_FALL) body.vy = MAX_FALL;

  // --- Carry --------------------------------------------------------------
  // Standing on a past take means moving with it. This happens before the
  // body's own motion so that riding a ghost upward doesn't read as a
  // collision from below.
  if (wasGrounded) {
    for (const m of world.movers) {
      if (
        body.x < m.x + m.w &&
        body.x + PLAYER_W > m.x &&
        Math.abs(body.y + PLAYER_H - m.y) < 0.06
      ) {
        body.x += m.dx;
        body.y += m.dy;
        break;
      }
    }
  }

  // --- Move X -------------------------------------------------------------
  body.x += body.vx * dt;
  if (resolveX(body, world)) {
    body.vx = 0;
    result.hitWall = true;
  }

  // --- Move Y -------------------------------------------------------------
  body.y += body.vy * dt;
  body.onGround = false;
  const hitY = resolveY(body, world, result);
  if (hitY !== 0) {
    if (hitY > 0) {
      body.onGround = true;
      result.landed = !wasGrounded;
    }
    body.vy = 0;
  }

  body.coyote = body.onGround ? COYOTE : Math.max(0, body.coyote - dt);
  return result;
}

/** Push the body out of anything it overlaps horizontally. Returns true if it hit. */
function resolveX(body: Body, world: Collider): boolean {
  let hit = false;
  const y0 = Math.floor(body.y);
  const y1 = Math.floor(body.y + PLAYER_H - 1e-9);

  if (body.vx > 0) {
    const tx = Math.floor(body.x + PLAYER_W - 1e-9);
    for (let ty = y0; ty <= y1; ty++) {
      if (world.solidAt(tx, ty)) {
        body.x = tx - PLAYER_W;
        hit = true;
        break;
      }
    }
  } else if (body.vx < 0) {
    const tx = Math.floor(body.x);
    for (let ty = y0; ty <= y1; ty++) {
      if (world.solidAt(tx, ty)) {
        body.x = tx + 1;
        hit = true;
        break;
      }
    }
  }

  // Movers are few, so a linear sweep is cheaper than any structure.
  for (const m of world.movers) {
    if (!overlaps(body.x, body.y, PLAYER_W, PLAYER_H, m)) continue;
    // Only push out sideways if this is genuinely a side hit: a body a hair
    // above a ghost's top edge is standing on it, not embedded in its flank.
    const fromTop = m.y - (body.y + PLAYER_H);
    if (fromTop > -0.12) continue;
    if (body.vx === 0) continue;

    // How far in this contact actually is. A shallow one is a body arriving at
    // a flank and should be stopped; a deep one means the body is already
    // *inside* the mover and must be allowed to walk out instead of being
    // ejected. That is not a rare case: every take begins at the same spawn,
    // so the performer starts life perfectly overlapping every past take. Eject
    // on that and each new take opens by shoving you backwards off your mark.
    const penetration =
      body.vx > 0 ? body.x + PLAYER_W - m.x : m.x + m.w - body.x;
    if (penetration > m.w * 0.75) continue;

    if (body.vx > 0) body.x = m.x - PLAYER_W;
    else body.x = m.x + m.w;
    hit = true;
  }
  return hit;
}

/**
 * Push the body out of anything it overlaps vertically.
 * Returns +1 for a floor, -1 for a ceiling, 0 for nothing.
 */
function resolveY(body: Body, world: Collider, result: StepResult): number {
  let hit = 0;
  const x0 = Math.floor(body.x);
  const x1 = Math.floor(body.x + PLAYER_W - 1e-9);

  if (body.vy > 0) {
    const ty = Math.floor(body.y + PLAYER_H - 1e-9);
    for (let tx = x0; tx <= x1; tx++) {
      if (world.solidAt(tx, ty)) {
        body.y = ty - PLAYER_H;
        hit = 1;
        break;
      }
    }
  } else if (body.vy < 0) {
    const ty = Math.floor(body.y);
    for (let tx = x0; tx <= x1; tx++) {
      if (world.solidAt(tx, ty)) {
        body.y = ty + 1;
        hit = -1;
        break;
      }
    }
  }

  for (let i = 0; i < world.movers.length; i++) {
    const m = world.movers[i];
    if (!overlaps(body.x, body.y, PLAYER_W, PLAYER_H, m)) continue;
    if (body.vy >= 0 && body.y + PLAYER_H - m.y < m.h * 0.6) {
      // Landing on a past take.
      body.y = m.y - PLAYER_H;
      hit = 1;
      result.carrier = i;
    } else if (body.vy < 0 && m.y + m.h - body.y < m.h * 0.6) {
      body.y = m.y + m.h;
      hit = -1;
    }
  }
  return hit;
}
