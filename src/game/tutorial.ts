// ===== The tutorial: one warp at a time, at your own pace =====
//
// Drift's whole difficulty is that the controls lie to you, and in a real run
// you meet each lie mid-panic, with a clock running and hunters closing. The
// tutorial takes the pressure away and shows the lies one at a time: no clock,
// no score, exactly one orb on the floor and exactly one warp in force. Banking
// the orb is what turns the page, so the pace is entirely the player's — you
// can sit inside Spin for a minute if that is what it takes.
//
// A lesson stores only what the warp catalogue doesn't: the teaching line, the
// order, and whether a hunter comes along. Name, hint and colour are looked up
// from `WARP_BY_ID` where the card is drawn, so they can never drift out of
// sync with the warp itself. That also keeps this module free of value imports,
// which is what lets `test/game-tutorial.test.mjs` load it directly.

import type { WarpId } from './warps';

interface Common {
  /** *What to do about it* — the part a real run never has time to explain. */
  body: string;
  /** Send a single hunter after the player for the length of this lesson. */
  hunter?: boolean;
}

/** A lesson about one warp; its name, hint and colour come from the catalogue. */
interface WarpLesson extends Common {
  warp: WarpId;
}

/** A lesson about the plain game, which has no catalogue entry to borrow from. */
interface PlainLesson extends Common {
  warp: null;
  title: string;
  hint: string;
  color: string;
}

export type Lesson = WarpLesson | PlainLesson;

export const LESSONS: Lesson[] = [
  {
    warp: null,
    title: 'The cursor',
    hint: 'That white dot is yours — for now.',
    color: '#7ff0ff',
    body: 'It moves by the fraction of the arena your hand covered, never by pixels, so the arena is always exactly one sweep wide. Take the dot to the cyan orb to move on.',
  },
  {
    warp: null,
    title: 'Hunters',
    hint: 'The red shards want the cursor.',
    color: '#ff453a',
    body: 'They arc toward you instead of tracking straight, so committing early leaves you a lane to slip through. In a real run three hits end it; in here they only sting. Bank the orb without being caught.',
    hunter: true,
  },
  {
    warp: 'mirror',
    body: 'Reach away from the orb and you close on it. Stop reading your hand and start reading the floor grid — it is drawn through the same matrix your input is, so it always shows the lie in force.',
  },
  {
    warp: 'flip',
    body: 'The same trick on the other axis. Pull the mouse toward you to send the cursor up.',
  },
  {
    warp: 'swap',
    body: 'Horizontal hand, vertical cursor. Diagonals still work — they just reflect about the 45° line, so aim at where the orb would be on the other side of that diagonal.',
  },
  {
    warp: 'zoom',
    body: 'Nothing is reversed here, only amplified. Halve every movement and stop the mouse sooner than feels right.',
  },
  {
    warp: 'spin',
    body: 'Right never stays right: the frame keeps turning for as long as this one runs. Short pushes and constant correction beat one committed sweep, and the turning grid is your only readout of where "right" is this second.',
  },
  {
    warp: 'syrup',
    body: 'The cursor is chasing a lagged copy of your hand. Start each move early and finish it early — it keeps travelling after you have stopped.',
  },
  {
    warp: 'ice',
    body: 'Your hand is an engine, not a steering wheel. Tap to build speed, then push back the other way to brake before the orb, or you sail straight past it.',
  },
  {
    warp: 'tide',
    body: 'A steady current that slowly changes heading. Hold a little way into it even when you mean to stand still.',
  },
  {
    warp: 'wells',
    body: 'Red pulls, green shoves, and both fall away fast with distance. Swing wide rather than skimming one — or, when the pull is unavoidable, ride it like a slingshot.',
    hunter: true,
  },
];
