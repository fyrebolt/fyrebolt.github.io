// ===== Retake — shared shapes and the constants two modules must agree on =====
//
// Like Drift, nothing in the simulation knows what a pixel is. The world is a
// grid of 1.0-unit tiles and every speed below is in tiles per second. Only
// `render.ts` converts, with one transform per frame. If you find a pixel value
// outside the renderer, that's the bug.

/**
 * What a cell in a level can be.
 *
 * A frozen object rather than a TS `enum` on purpose: the repo builds with
 * `erasableSyntaxOnly`, and the test suite imports these modules straight into
 * node, which strips types rather than compiling them. An `enum` emits runtime
 * code and would be rejected by both.
 */
export const Cell = {
  Empty: 0,
  /** Solid ground. */
  Solid: 1,
  /** Kills on contact. Not solid — you fall into it. */
  Spike: 2,
  /** The mark. Stand on it to make the shot. */
  Mark: 3,
} as const;
export type Cell = (typeof Cell)[keyof typeof Cell];

/** The player's box, in tiles. Slightly under a tile so a 1-wide gap is a gap. */
export const PLAYER_W = 0.7;
export const PLAYER_H = 0.9;

/** The simulation's fixed step. Everything is integrated at exactly this rate. */
export const FIXED_DT = 1 / 120;

/**
 * An axis-aligned box. `dx`/`dy` are how far it moved during the current step,
 * which is what lets a body standing on it get carried along.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

/** One frame of intent. The only thing a take records. */
export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export const NO_INPUT: Input = { left: false, right: false, jump: false };

/** A moving thing with the state the movement model needs between steps. */
export interface Body {
  /** Top-left of the AABB, in tiles. y grows downward, like the grid. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  /** Seconds of ground-leniency left — see COYOTE in physics.ts. */
  coyote: number;
  /** Seconds an unconsumed jump press stays live. */
  buffer: number;
  /** Was the jump button down last step? Edge detection, not level. */
  heldJump: boolean;
  facing: 1 | -1;
}

export function makeBody(x: number, y: number): Body {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    onGround: false,
    coyote: 0,
    buffer: 0,
    heldJump: false,
    facing: 1,
  };
}

/** A parsed, playable level. */
export interface Level {
  id: string;
  name: string;
  /** One line of teaching, shown on the slate before the shot. */
  hint: string;
  w: number;
  h: number;
  /** Row-major, length w*h. */
  cells: Uint8Array;
  /** Top-left of the player's box at the start of every take. */
  spawn: { x: number; y: number };
  /** How many takes the shot is budgeted for. Running out reshoots it. */
  takes: number;
  /** Seconds before a take is cut automatically. */
  seconds: number;
}

/** A finished take: where the performer was at every fixed step. */
export interface Take {
  /** Interleaved x,y pairs — one pair per fixed step. */
  path: Float32Array;
  /** Number of recorded steps (path holds 2 * steps entries). */
  steps: number;
  /** How the take ended, for the film-strip readout. */
  ending: 'cut' | 'died' | 'expired' | 'made';
}

/**
 * Where a take's performer is at a given step, and how far it moved to get
 * there.
 *
 * Past the end of the recording the performer holds its last position forever
 * — a freeze frame. That is a design decision, not a convenience: if a take
 * evaporated when its recording ran out, "walk somewhere and cut" would
 * produce a platform that quietly stops existing partway through the next
 * take, and the level would appear to break rather than to be hard. Freezing
 * makes a cut a promise, and still leaves a moving take interactable while it
 * is playing.
 */
export function sampleTake(take: Take, step: number): Box | null {
  if (take.steps === 0) return null;
  const s = step < 0 ? 0 : step >= take.steps ? take.steps - 1 : step;
  const x = take.path[s * 2];
  const y = take.path[s * 2 + 1];
  const p = s > 0 ? s - 1 : 0;
  return {
    x,
    y,
    w: PLAYER_W,
    h: PLAYER_H,
    // A held frame is motionless, so it carries nothing along with it.
    dx: s === step ? x - take.path[p * 2] : 0,
    dy: s === step ? y - take.path[p * 2 + 1] : 0,
  };
}
