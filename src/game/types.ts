// ===== Shared shapes for the Drift arena =====
//
// Everything in the simulation lives in *arena units*, not pixels: the arena is
// exactly 1.0 unit tall and `aspect` units wide. Pixels only appear in
// render.ts (which scales by the arena's on-screen height) and in pointer.ts
// (which divides raw mouse movement by that same height). That is what makes
// the game feel identical in a small window and a large one — you always sweep
// the arena by moving the mouse across the arena, whatever size it happens to
// be right now.

import type { WarpId } from './warps';

export interface Vec {
  x: number;
  y: number;
}

export type Phase = 'menu' | 'playing' | 'paused' | 'over';

export interface Orb {
  p: Vec;
  r: number;
  /** Age in seconds — drives the spawn pop and the idle pulse. */
  age: number;
  /** Per-orb phase offset so a field of orbs doesn't pulse in lockstep. */
  seed: number;
}

export interface Hunter {
  p: Vec;
  v: Vec;
  r: number;
  age: number;
  /** Current shard rotation, radians. */
  spin: number;
  /** Sideways wobble phase, so hunters arc instead of tracking dead straight. */
  wobble: number;
  speed: number;
  /** Seconds of "knocked senseless" left after landing a hit — no homing. */
  stun: number;
}

/** Hunters can't hurt you while they are still fading in at the rim. */
export const HUNTER_GRACE = 0.7;

export interface Particle {
  p: Vec;
  v: Vec;
  life: number;
  max: number;
  r: number;
  color: string;
}

/** An expanding shockwave ring — orb pickups, hits, and warp activations. */
export interface Ring {
  p: Vec;
  r: number;
  max: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

/** A floating "+120" that rises and fades where an orb was banked. */
export interface Pop {
  p: Vec;
  text: string;
  life: number;
  color: string;
}

/** Gravity well used by the `wells` warp — it drags the cursor as you pass. */
export interface Well {
  p: Vec;
  /** +1 attracts, -1 repels. */
  sign: number;
  phase: number;
}

/**
 * Where the player is in the guided tutorial (see tutorial.ts). Non-null for
 * the whole of a tutorial run, including the completion card, which is what
 * every "is this a lesson, not a run?" check in the engine reads.
 */
export interface TutorialState {
  /** Index into `LESSONS` — equal to `LESSONS.length` once the last is banked. */
  step: number;
}

export interface ActiveWarp {
  id: WarpId;
  remaining: number;
  total: number;
}

export interface Player {
  p: Vec;
  /** Units per second, derived — used for the trail and the speed glow. */
  v: Vec;
  /** Ring buffer of recent positions, newest last. */
  trail: Vec[];
  /** Seconds of post-hit invulnerability left. */
  invuln: number;
  /** Last *raw* (un-warped) input direction, for the ghost chevron. */
  raw: Vec;
}

export interface GameState {
  phase: Phase;
  /** Seconds elapsed in the current run. */
  t: number;
  aspect: number;

  player: Player;
  /** Low-pass accumulator used by the `syrup` warp. */
  smooth: Vec;

  orbs: Orb[];
  hunters: Hunter[];
  particles: Particle[];
  rings: Ring[];
  pops: Pop[];
  wells: Well[];

  warps: ActiveWarp[];
  /** Non-null while the guided tutorial is running instead of a scored run. */
  tutorial: TutorialState | null;
  /** Ever-turning angle used by the `spin` warp, radians. */
  spinAngle: number;
  /** Ever-turning angle used by the `tide` warp, radians. */
  tideAngle: number;
  /** Run time at which the next warp rolls in. */
  nextWarpAt: number;

  score: number;
  best: number;
  combo: number;
  comboTimer: number;
  shields: number;
  wave: number;
  collected: number;
  timeLeft: number;

  /** Screen-shake amplitude in units; decays every frame. */
  shake: number;
  /** Full-arena colour flash, 0..1. */
  flash: number;
  flashColor: string;
}

/** The slice of state the React HUD re-renders from (see GameApp). */
export interface HudSnapshot {
  phase: Phase;
  score: number;
  best: number;
  combo: number;
  shields: number;
  wave: number;
  warps: ActiveWarp[];
  locked: boolean;
  /** Lesson index and total, or null during an ordinary run. */
  tutorial: { step: number; total: number } | null;
}
