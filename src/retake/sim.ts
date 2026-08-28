// ===== The world, one fixed step at a time =====
//
// This module is the game. It holds no canvas, no clock and no event
// listeners: you hand it a level, then hand it one `Input` per fixed step and
// it tells you what happened. `engine.ts` drives it from an animation frame
// and `test/retake-*.test.mjs` drives it from a loop, and because there is no
// wall-clock term anywhere in here those two produce identical play.
//
// That determinism is not a nicety. A take is replayed from a recorded path,
// and the player stands on that path; if the same inputs could produce two
// different runs, ghosts would drift out from under people's feet.

import { cellAt } from './levels';
import { stepBody, type Collider } from './physics';
import {
  Cell,
  FIXED_DT,
  PLAYER_H,
  PLAYER_W,
  makeBody,
  sampleTake,
  type Body,
  type Box,
  type Input,
  type Level,
  type Take,
} from './types';

/** How a take finished, or null while it is still running. */
export type Ending = Take['ending'];

export interface SimState {
  level: Level;
  body: Body;
  /** Fixed steps elapsed in the current take. */
  step: number;
  /** Takes already recorded, oldest first. They all replay from step 0. */
  ghosts: Take[];
  /** Positions recorded for the take in progress. */
  recording: number[];
  /** Boxes the ghosts occupy right now — recomputed every step. */
  movers: Box[];
  /** Set once the take ends; null while it runs. */
  ending: Ending | null;
  /** True once the mark has been reached on any take. */
  cleared: boolean;
}

export function createSim(level: Level, ghosts: Take[] = []): SimState {
  const state: SimState = {
    level,
    body: makeBody(level.spawn.x, level.spawn.y),
    step: 0,
    ghosts,
    recording: [],
    movers: [],
    ending: null,
    cleared: false,
  };
  syncMovers(state);
  return state;
}

/** Start a fresh take, keeping the ghosts already banked. */
export function nextTake(state: SimState, banked: Take[]): SimState {
  return createSim(state.level, banked);
}

/** Place every ghost at the current step. */
function syncMovers(state: SimState): void {
  state.movers.length = 0;
  for (const take of state.ghosts) {
    const box = sampleTake(take, state.step);
    if (box) state.movers.push(box);
  }
}

/** The collider the body sees: static terrain plus every past take. */
function colliderFor(state: SimState): Collider {
  const { level } = state;
  return {
    solidAt(tx, ty) {
      // Out of bounds is a wall at the sides and open sky above; below the
      // grid is open too, and falling out of it is what kills you.
      if (tx < 0 || tx >= level.w) return true;
      if (ty < 0 || ty >= level.h) return false;
      return cellAt(level, tx, ty) === Cell.Solid;
    },
    movers: state.movers,
  };
}

/** Every cell the body's box currently touches. */
function forEachTouched(body: Body, fn: (cell: Cell) => void, level: Level): void {
  const x0 = Math.floor(body.x);
  const x1 = Math.floor(body.x + PLAYER_W - 1e-9);
  const y0 = Math.floor(body.y);
  const y1 = Math.floor(body.y + PLAYER_H - 1e-9);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) fn(cellAt(level, tx, ty));
  }
}

export interface StepEvents {
  landed: boolean;
  jumped: boolean;
  /** The take ended this step, and how. */
  ended: Ending | null;
}

/**
 * Advance the world by one fixed step.
 *
 * Returns what happened, so the caller can make a noise about it. Once
 * `state.ending` is set the call is a no-op — a finished take does not keep
 * simulating just because frames keep arriving.
 */
export function stepSim(state: SimState, input: Input): StepEvents {
  const events: StepEvents = { landed: false, jumped: false, ended: null };
  if (state.ending) return events;

  // Record where the performer is at the START of this step, so recording
  // index N is the position a replay shows at step N.
  state.recording.push(state.body.x, state.body.y);

  syncMovers(state);
  const result = stepBody(state.body, input, colliderFor(state), FIXED_DT);
  events.landed = result.landed;
  events.jumped = result.jumped;

  state.step++;

  // --- Did anything happen to the body? ---
  let hitSpike = false;
  let onMark = false;
  forEachTouched(
    state.body,
    (cell) => {
      if (cell === Cell.Spike) hitSpike = true;
      else if (cell === Cell.Mark) onMark = true;
    },
    state.level,
  );

  if (onMark) {
    state.cleared = true;
    events.ended = end(state, 'made');
  } else if (hitSpike || state.body.y > state.level.h + 1) {
    events.ended = end(state, 'died');
  } else if (state.step >= Math.round(state.level.seconds / FIXED_DT)) {
    events.ended = end(state, 'expired');
  }

  return events;
}

/** End the running take deliberately — the player pressed Cut. */
export function cutTake(state: SimState): Ending | null {
  return state.ending ? null : end(state, 'cut');
}

function end(state: SimState, ending: Ending): Ending {
  state.ending = ending;
  return ending;
}

/** Freeze the take in progress into something the next take can stand on. */
export function bankTake(state: SimState): Take {
  return {
    path: Float32Array.from(state.recording),
    steps: state.recording.length / 2,
    ending: state.ending ?? 'cut',
  };
}

/** Seconds elapsed in the running take. */
export const elapsed = (state: SimState): number => state.step * FIXED_DT;

/** Seconds left before the take is cut for you. */
export const remaining = (state: SimState): number =>
  Math.max(0, state.level.seconds - elapsed(state));
