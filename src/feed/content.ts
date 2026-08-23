// ===== What the feed is actually made of =====
//
// The cards need to read as a feed at a glance, which means a real headline and
// a handle — and then nothing else. Body copy is drawn as skeleton bars rather
// than sentences, the way a feed looks in the half-second before it loads:
// it scans as text, it never needs wrapping or truncating at four different
// window sizes, and it keeps the player's eyes on the one line that matters.
//
// The copy is invented, and deliberately mundane on the posts and shrill on the
// bait, because that contrast *is* the tell the player learns to read before
// the colours register.

import type { Card, CardKind } from './types';

const POSTS: string[] = [
  'made soup. it was fine.',
  'the cat has learned to open the fridge',
  'six years in and I still misspell "recieve"',
  'took the long way home for no reason',
  'finally fixed the squeaky drawer',
  'my sourdough starter has a name now',
  'saw a heron on the way to work',
  'the good pen ran out mid-sentence',
  'repotted everything. one survivor so far.',
  'learned my building has a roof you can sit on',
  'ran a mile without checking the watch',
  'found the receipt. two years late.',
  'the bus was early, somehow',
  'ate lunch outside. small win.',
  'someone left a piano in the courtyard',
  'day three of the same album on repeat',
  'the library got new chairs',
  'wrote a letter by hand. felt strange.',
  'fog all morning, sun by two',
  'my plant is taller than the shelf now',
];

const HOT: string[] = [
  'she finished the boat. it floats.',
  'twelve years of photos, one wall',
  'the whole street showed up for it',
  'he taught himself the whole thing at 61',
  'first snow, and the dog understood',
  'they found the missing chapter',
  'the bridge opened this morning',
  'her thesis is a garden now',
];

const BAIT: string[] = [
  "YOU WON'T BELIEVE WHAT HAPPENED NEXT",
  'everyone you know is doing this wrong',
  'this is why nobody replies to you',
  'nine habits that are quietly ruining you',
  'READ THIS BEFORE IT GETS TAKEN DOWN',
  'the truth they will not put on the box',
  'reply if you agree. scroll if you are scared.',
  'your morning routine is a lie',
  'what your handwriting says about your future',
  'ONE MISTAKE IS COSTING YOU EVERYTHING',
  'they do not want you to see this list',
  'stop what you are doing and look at this',
];

const ADS: string[] = [
  'A mattress, probably',
  'The last water bottle you will ever buy',
  'Meal kits, but for your dog',
  'Learn six languages in your sleep',
  'A subscription to your own thermostat',
  'Socks, monthly, forever',
  'The productivity app that ends productivity apps',
  'Insurance for things that cannot break',
];

const HANDLES: string[] = [
  '@kel',
  '@morningbread',
  '@nine_volts',
  '@your.friend.kyle',
  '@paperlanterns',
  '@dtc',
  '@hallway.light',
  '@rosewater',
  '@slow_train',
  '@mimi.builds',
  '@notthatanna',
  '@brick_and_moss',
];

const BAIT_HANDLES: string[] = [
  '@dailychurn',
  '@truthdrop',
  '@engagement.farm',
  '@viral.today',
  '@wakeupfeed',
  '@the.real.list',
];

const AD_HANDLES: string[] = ['Sponsored', 'Promoted', 'Paid partnership'];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** Card geometry, in feed units. A viewport is 1.0 tall, so two or three fit. */
const PAD = 0.052;
const HEADLINE = 0.062;
const BAR_STEP = 0.036;
const MEDIA_MIN = 0.16;
const MEDIA_VAR = 0.12;

/**
 * Build one card of the given kind at the given offset down the feed.
 *
 * The height is derived from the contents rather than chosen, so a card is
 * always exactly as tall as the thing drawn inside it and the renderer never
 * has to guess where the bottom edge is.
 */
export function makeCard(id: number, kind: CardKind, top: number): Card {
  const bars = kind === 'ad' ? 1 : 1 + Math.floor(Math.random() * 3);
  const media =
    kind === 'ad' || (kind !== 'bait' && Math.random() < 0.42)
      ? MEDIA_MIN + Math.random() * MEDIA_VAR
      : 0;

  return {
    id,
    kind,
    top,
    h: PAD * 2 + HEADLINE + bars * BAR_STEP + (media ? media + 0.028 : 0),
    handle:
      kind === 'ad' ? pick(AD_HANDLES) : kind === 'bait' ? pick(BAIT_HANDLES) : pick(HANDLES),
    headline:
      kind === 'ad'
        ? pick(ADS)
        : kind === 'bait'
          ? pick(BAIT)
          : kind === 'hot'
            ? pick(HOT)
            : pick(POSTS),
    bars: Array.from({ length: bars }, () => 0.55 + Math.random() * 0.45),
    media,
    meter: 0,
    done: false,
    focus: 0,
    seed: Math.random() * 6.283,
  };
}

/** Inner padding of a card, units — shared by the renderer. */
export const CARD_PAD = PAD;
/** Height reserved for the headline line, units. */
export const CARD_HEADLINE = HEADLINE;
/** Vertical step between skeleton body bars, units. */
export const CARD_BAR_STEP = BAR_STEP;
