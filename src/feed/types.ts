// ===== Shared shapes for the Doomscroll feed =====
//
// Everything in the simulation lives in *feed units*, not pixels: the viewport
// is exactly 1.0 unit tall and `aspect` units wide, and a card that is 0.3 tall
// covers three tenths of the screen at any window size. Pixels only appear in
// render.ts (which scales by the viewport's on-screen height) and in scroll.ts
// (which divides raw wheel and drag distances by that same height).
//
// That is what makes a flick mean the same thing in a small window and a large
// one: you always travel the feed by a fraction of the screen, never by a count
// of pixels, so a tall display doesn't hand you a slower, easier feed.

import type { QuirkId } from './quirks';

export type Phase = 'menu' | 'playing' | 'paused' | 'over';

/**
 * Where the read line sits, as a fraction down the viewport, and the height of
 * the band drawn around it. These are the constants the engine and the renderer
 * must agree on: the engine decides which card is focused by the line alone,
 * and the band is the player's only picture of where that line is.
 */
export const ZONE_Y = 0.46;
export const ZONE_H = 0.28;

/**
 * What a card does to you while it holds the read line.
 *
 * - `post` — the point of the game: dwell on it and it banks.
 * - `hot`  — a rarer post worth more, and slower to read.
 * - `bait` — drains attention while you look at it, and hooks you if you stay.
 * - `ad`   — pins the feed for a moment unless you were already moving.
 */
export type CardKind = 'post' | 'hot' | 'bait' | 'ad';

export interface Card {
  id: number;
  kind: CardKind;
  /** Distance from the top of the feed to this card's top edge, in units. */
  top: number;
  /** Card height, units. */
  h: number;
  handle: string;
  headline: string;
  /** Widths of the skeleton body bars, each a fraction of the inner width. */
  bars: number[];
  /** Height of the media block, units. Zero for a text-only card. */
  media: number;
  /**
   * 0..1 progress against whatever this kind of card is counting: reading for
   * posts, hooking for bait, the hold for an ad.
   */
  meter: number;
  /** Spent — read, hooked, or an ad that has played out. Never counts twice. */
  done: boolean;
  /** Seconds this card has held the read line, for the highlight fade-in. */
  focus: number;
  /** Per-card phase offset so a column of cards doesn't pulse in lockstep. */
  seed: number;
}

export interface Particle {
  /** Screen position in units — particles live for well under a flick. */
  p: { x: number; y: number };
  v: { x: number; y: number };
  life: number;
  max: number;
  r: number;
  color: string;
}

/** An expanding ring — banked posts, hooks, and quirk arrivals. */
export interface Ring {
  p: { x: number; y: number };
  r: number;
  max: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

/** A floating "+120" that rises and fades where a post was banked. */
export interface Pop {
  p: { x: number; y: number };
  text: string;
  life: number;
  color: string;
}

export interface ActiveQuirk {
  id: QuirkId;
  remaining: number;
  total: number;
}

/** An ad holding the feed still, and the seconds left on it. */
export interface Pin {
  id: number;
  left: number;
  total: number;
}

export interface FeedState {
  phase: Phase;
  /** Seconds elapsed in the current run. */
  t: number;
  aspect: number;

  /** Scroll offset: how far the top of the viewport is down the feed, units. */
  y: number;
  /** Feed velocity, units per second. Positive travels down the feed. */
  v: number;
  /**
   * How much of the focused card's effect lands right now, 0..1 — one number
   * derived from speed alone. Standing still is total engagement; a flick past
   * is none. Reading, draining, hooking and ad triggers all read from it, which
   * is the whole thesis of the game in one variable.
   */
  engagement: number;
  /** Low-pass accumulator used by the `heavy` quirk. */
  smooth: number;
  /** Lagging position the `rubberband` quirk pulls you back toward. */
  anchor: number;

  cards: Card[];
  /** Feed offset where the next generated card starts. */
  nextTop: number;
  nextId: number;
  /** Index into `cards` of the card under the read line, or -1 for a gap. */
  focus: number;
  /** Id of the card that last held the line, so crossings can tick. */
  lastFocusId: number;

  pin: Pin | null;

  quirks: ActiveQuirk[];
  /** Run time at which the next quirk rolls in. */
  nextQuirkAt: number;

  particles: Particle[];
  rings: Ring[];
  pops: Pop[];

  score: number;
  best: number;
  combo: number;
  comboTimer: number;
  /** Hooks left before the run ends — Drift's shields, by another name. */
  shields: number;
  wave: number;
  /** Posts banked this run. Drives the wave counter. */
  read: number;
  /** Seconds of attention left. The clock. */
  attention: number;

  /** Screen-shake amplitude in units; decays every frame. */
  shake: number;
  /** Full-screen colour flash, 0..1. */
  flash: number;
  flashColor: string;
}

/** The slice of state the React HUD re-renders from (see FeedApp). */
export interface HudSnapshot {
  phase: Phase;
  score: number;
  best: number;
  combo: number;
  shields: number;
  wave: number;
  quirks: ActiveQuirk[];
  /** Seconds left on the ad currently holding the feed, or null. */
  pinned: number | null;
}
