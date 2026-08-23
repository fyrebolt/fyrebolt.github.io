// ===== Quirks: the ways the algorithm takes the scroll away from you =====
//
// A quirk is a rule that sits between the wheel under your finger and the feed
// on screen. Two of them are a pure function of the incoming scroll distance
// (invert, firehose) and one filters it (sticky); the rest change how that
// distance is *integrated* into an offset (molasses, slick, snap) or move the
// feed when you don't (autoplay, rubberband).
//
// Keeping the catalogue declarative means the scheduler, the HUD chips and the
// scrollbar rail all read one table instead of three switch statements — and
// the rail derives its arrow and its tick spacing from `scrollGain`, which is
// recovered by pushing a unit scroll through the real transform below. It
// therefore cannot draw a lie the controls aren't telling.

export type QuirkId =
  | 'invert'
  | 'firehose'
  | 'sticky'
  | 'slick'
  | 'molasses'
  | 'snap'
  | 'autoplay'
  | 'rubberband';

export interface QuirkDef {
  id: QuirkId;
  name: string;
  /** One line shown on the banner when it engages, and in the chip title. */
  hint: string;
  color: string;
  /** Quirks that must never run alongside this one. */
  excludes: QuirkId[];
  /** How it acts: on the distance, on the integration, or as a force. */
  kind: 'transform' | 'integration' | 'force';
}

export const QUIRKS: QuirkDef[] = [
  {
    id: 'invert',
    name: 'Inverted',
    hint: 'Down is up.',
    color: '#64d2ff',
    excludes: [],
    kind: 'transform',
  },
  {
    id: 'firehose',
    name: 'Firehose',
    hint: 'Every flick counts double.',
    color: '#ffd60a',
    excludes: [],
    kind: 'transform',
  },
  {
    id: 'sticky',
    name: 'Sticky',
    hint: 'Small scrolls do nothing at all.',
    color: '#bf5af2',
    excludes: [],
    kind: 'transform',
  },
  {
    id: 'slick',
    name: 'Slick',
    hint: 'Nothing you start ever stops.',
    color: '#a0e9ff',
    // Snap only bites below a speed Slick spends most of its life above, so
    // together they read as "the detents are broken" rather than as either.
    excludes: ['molasses', 'snap'],
    kind: 'integration',
  },
  {
    id: 'molasses',
    name: 'Molasses',
    hint: 'The feed leans in late and drags.',
    color: '#ff7ab6',
    excludes: ['slick'],
    kind: 'integration',
  },
  {
    id: 'snap',
    name: 'Snap',
    hint: 'The feed picks the card, not you.',
    color: '#30d158',
    excludes: ['slick'],
    kind: 'integration',
  },
  {
    id: 'autoplay',
    name: 'Autoplay',
    hint: 'It scrolls itself now.',
    color: '#ff9f0a',
    excludes: ['rubberband'],
    kind: 'force',
  },
  {
    id: 'rubberband',
    name: 'Rubberband',
    hint: 'It keeps pulling you back up.',
    color: '#ff453a',
    excludes: ['autoplay'],
    kind: 'force',
  },
];

export const QUIRK_BY_ID: Record<QuirkId, QuirkDef> = Object.fromEntries(
  QUIRKS.map((q) => [q.id, q]),
) as Record<QuirkId, QuirkDef>;

/** Sensitivity multiplier applied by `firehose`. */
const FIREHOSE_GAIN = 2.2;

/**
 * Scroll distances below this are swallowed whole by `sticky`, in units — a
 * touch under a hundredth of the screen. Exported because the rail draws the
 * dead band at exactly this size, so what you see is the threshold in force.
 */
export const STICKY_STEP = 0.045;

/**
 * Run an incoming scroll distance (feed units, positive travels down the feed)
 * through every active *transform* quirk.
 *
 * Order is fixed here rather than by activation order, so the same set always
 * composes to the same feel: the dead band is judged on what your hand actually
 * did, before any inversion or gain rewrites it.
 */
export function transformScroll(d: number, active: Set<QuirkId>): number {
  let out = d;

  if (active.has('sticky') && Math.abs(out) < STICKY_STEP) out = 0;
  if (active.has('invert')) out = -out;
  if (active.has('firehose')) out *= FIREHOSE_GAIN;

  return out;
}

/**
 * The signed gain `transformScroll` currently applies to a scroll big enough to
 * clear the dead band — negative when the feed is running backwards.
 *
 * The scrollbar rail is drawn through this: its arrow flips under Inverted and
 * its ticks bunch up under Firehose, for free and forever. Recovering the
 * number by pushing a unit scroll through the real transform is what keeps the
 * picture from ever disagreeing with the maths, so don't "optimise" this into a
 * hand-written multiplier — `test/feed-quirks.test.mjs` asserts they match.
 */
export function scrollGain(active: Set<QuirkId>): number {
  return transformScroll(1, active);
}
