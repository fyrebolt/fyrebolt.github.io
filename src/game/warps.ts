// ===== Warps: the ways the game takes your cursor away from you =====
//
// A warp is a rule that sits between your hand and the thing on screen. Most of
// them are a pure linear transform on the input delta (mirror, flip, swap,
// spin, zoom); the rest change how that delta is *integrated* into a position
// (ice, syrup) or add a force that moves you when you don't (tide, wells).
//
// Keeping the catalogue declarative means the scheduler, the HUD chips and the
// background grid all read from one table instead of three switch statements.

import type { Vec } from './types';

export type WarpId =
  | 'mirror'
  | 'flip'
  | 'swap'
  | 'spin'
  | 'zoom'
  | 'ice'
  | 'syrup'
  | 'tide'
  | 'wells';

export interface WarpDef {
  id: WarpId;
  name: string;
  /** One line shown on the banner when it engages, and in the HUD chip title. */
  hint: string;
  color: string;
  /** Warps that must never run alongside this one. */
  excludes: WarpId[];
  /** How it acts: a delta transform, an integration change, or a force. */
  kind: 'transform' | 'integration' | 'force';
}

export const WARPS: WarpDef[] = [
  {
    id: 'mirror',
    name: 'Mirror',
    hint: 'Left is right.',
    color: '#5ac8fa',
    excludes: [],
    kind: 'transform',
  },
  {
    id: 'flip',
    name: 'Flip',
    hint: 'Up is down.',
    color: '#64d2ff',
    excludes: [],
    kind: 'transform',
  },
  {
    id: 'swap',
    name: 'Swap',
    hint: 'The axes trade places.',
    color: '#bf5af2',
    excludes: ['spin'],
    kind: 'transform',
  },
  {
    id: 'spin',
    name: 'Spin',
    hint: 'Your frame of reference is turning.',
    color: '#ff9f0a',
    excludes: ['swap'],
    kind: 'transform',
  },
  {
    id: 'zoom',
    name: 'Twitch',
    hint: 'Every movement counts double.',
    color: '#ffd60a',
    excludes: [],
    kind: 'transform',
  },
  {
    id: 'ice',
    name: 'Ice',
    hint: 'You steer momentum, not position.',
    color: '#a0e9ff',
    excludes: ['syrup'],
    kind: 'integration',
  },
  {
    id: 'syrup',
    name: 'Syrup',
    hint: 'The cursor arrives late.',
    color: '#ff7ab6',
    excludes: ['ice'],
    kind: 'integration',
  },
  {
    id: 'tide',
    name: 'Tide',
    hint: 'The whole arena is sliding.',
    color: '#30d158',
    excludes: [],
    kind: 'force',
  },
  {
    id: 'wells',
    name: 'Wells',
    hint: 'Mass bends your path.',
    color: '#ff453a',
    excludes: [],
    kind: 'force',
  },
];

export const WARP_BY_ID: Record<WarpId, WarpDef> = Object.fromEntries(
  WARPS.map((w) => [w.id, w]),
) as Record<WarpId, WarpDef>;

/**
 * The four warps that lie about *direction* rather than about physics.
 *
 * Ice, Syrup, Tide and Wells all leave "right is right" intact — they change
 * how much you slide, or drag you somewhere, but the mapping from hand to
 * cursor still points the way you expect. These four break that mapping, which
 * is a categorically harder thing to play through, and stacking two of them is
 * where most runs end. They are what the console benches.
 */
export const HARD_WARPS: WarpId[] = ['mirror', 'flip', 'swap', 'spin'];

const NONE: ReadonlySet<WarpId> = new Set<WarpId>();

/**
 * Which warps could legally engage right now, given what's already running.
 *
 * The rule lives here rather than in the scheduler so it can be checked without
 * a canvas: a warp is eligible unless it's already active, benched, or excluded
 * by something active. Exclusions are asserted mutual by the test suite, but
 * both directions are checked anyway — this is the function that decides
 * whether the game can hand you two contradictory lies at once.
 */
export function eligibleWarps(
  active: ReadonlySet<WarpId>,
  benched: ReadonlySet<WarpId> = NONE,
): WarpDef[] {
  return WARPS.filter((w) => {
    if (benched.has(w.id)) return false;
    if (active.has(w.id)) return false;
    if (w.excludes.some((x) => active.has(x))) return false;
    for (const id of active) if (WARP_BY_ID[id].excludes.includes(w.id)) return false;
    return true;
  });
}

/** Sensitivity multiplier applied by `zoom`. */
const ZOOM_GAIN = 2.15;

/**
 * Run an input delta (arena units) through every active *transform* warp.
 *
 * Order matters and is fixed by the array below rather than by activation
 * order, so the same set of warps always composes to the same feel — swap then
 * spin then the reflections then the gain.
 */
export function transformDelta(d: Vec, active: Set<WarpId>, spinAngle: number): Vec {
  let { x, y } = d;

  if (active.has('swap')) {
    const t = x;
    x = y;
    y = t;
  }
  if (active.has('spin')) {
    const c = Math.cos(spinAngle);
    const s = Math.sin(spinAngle);
    const nx = x * c - y * s;
    y = x * s + y * c;
    x = nx;
  }
  if (active.has('mirror')) x = -x;
  if (active.has('flip')) y = -y;
  if (active.has('zoom')) {
    x *= ZOOM_GAIN;
    y *= ZOOM_GAIN;
  }

  return { x, y };
}

/**
 * The 2×2 matrix that `transformDelta` currently applies, as column vectors.
 *
 * The background grid is drawn through this so the distortion is *visible*:
 * under Spin the grid turns, under Mirror it flips, under Twitch it coarsens.
 * Recovering it by pushing the basis vectors through the real transform means
 * the picture can never drift out of sync with the maths.
 */
export function warpBasis(active: Set<WarpId>, spinAngle: number): { e1: Vec; e2: Vec } {
  return {
    e1: transformDelta({ x: 1, y: 0 }, active, spinAngle),
    e2: transformDelta({ x: 0, y: 1 }, active, spinAngle),
  };
}
