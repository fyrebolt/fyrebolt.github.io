// ===== Overlay element model: font-boil captions + typewriter captions =====

import type { BoilPoolId } from './fonts';

export type BoilMode = 'off' | 'intro' | 'continuous';

export type TextAlign = 'left' | 'center' | 'right';

export type Legibility = 'outline' | 'shadow' | 'none';

export type DeleteStyle = 'char' | 'selectAll';

// ---- word attachments: highlight / underline over static words ----

export type AttachmentType = 'underline' | 'highlight';

/**
 * A highlight or underline drawn over a contiguous run of words while they are
 * static (a typewriter's hold, or a settled/off boil). It sweeps in from the
 * left, holds, then slips off to the right; `duration` is the total lifetime,
 * split into in / hold / out by `inFrac` + `outFrac` (hold = the remainder).
 * `startInStatic` is the offset (s) from the start of the element's static
 * window, so attachments move with the element and can be staggered.
 */
export interface Attachment {
  id: string;
  type: AttachmentType;
  /** Inclusive word-index range into the element's words (reading order). */
  wordStart: number;
  wordEnd: number;
  /** Seconds after the element's static window opens. */
  startInStatic: number;
  /** Total on-screen lifetime in seconds (in + hold + out). */
  duration: number;
  /** Sweep-in / sweep-out fractions of `duration` (hold = 1 - in - out). */
  inFrac: number;
  outFrac: number;
  color: string;
  /** Highlight fill opacity (0..1); ignored by underlines. */
  opacity: number;
}

/** Fields shared by every overlay element (also the input to the text renderer). */
export interface CaptionTextStyle {
  text: string;
  /** Normalised centre position (0..1 of the output frame), so it scales across ratios. */
  x: number;
  y: number;
  color: string;
  /** Multiplier on the base font size (which scales with frame height). */
  sizeScale: number;
  /** Rotation about the text block's centre, in radians (clockwise). */
  rotation: number;
  align: TextAlign;
  legibility: Legibility;
}

interface BaseElement extends CaptionTextStyle {
  id: string;
  /** Start time in seconds. */
  start: number;
  /** Word highlight/underline attachments (empty by default). */
  attachments: Attachment[];
}

/** Font-boil caption (the original element type). */
export interface Caption extends BaseElement {
  kind: 'boil';
  /** End time in seconds. */
  end: number;
  /** Which font pool this caption boils through (per-caption, not project-global). */
  pool: BoilPoolId;
  /** Index into `pool` — the font it settles on. */
  settleFontIndex: number;
  boil: BoilMode;
  /** Even out this caption's fonts to a consistent height as it boils. */
  normalize: boolean;
}

/** Typewriter caption: types out, holds, then optionally deletes. */
export interface TypewriterCaption extends BaseElement {
  kind: 'typewriter';
  /** Font id ("poolId:index") from the combined all-pools list. */
  fontKey: string;
  typingDur: number;
  holdDur: number;
  deleteEnabled: boolean;
  deleteStyle: DeleteStyle;
  deleteDur: number;
}

export type CaptionEl = Caption | TypewriterCaption;

/** End time of any element (typewriter's is derived from its phases). */
export function elementEnd(el: CaptionEl): number {
  if (el.kind === 'boil') return el.end;
  return el.start + el.typingDur + el.holdDur + (el.deleteEnabled ? el.deleteDur : 0);
}

// ---- font boil ----

const INTRO_BURST_MS = 900; // how long the intro roll lasts before settling
const INTRO_TICKS = 18; // number of font switches packed into the burst
const CONTINUOUS_INTERVAL_MS = 90; // steady switch interval for continuous mode

/**
 * Which pool font (index into a pool of `poolLen` fonts) to show for a caption
 * at `elapsedMs` since it appeared.
 */
export function boilFontIndex(cap: Caption, elapsedMs: number, poolLen: number): number {
  const n = Math.max(1, poolLen);
  const settle = Math.max(0, Math.min(n - 1, cap.settleFontIndex));
  if (cap.boil === 'off') return settle;
  if (cap.boil === 'continuous') {
    return Math.floor(Math.max(0, elapsedMs) / CONTINUOUS_INTERVAL_MS) % n;
  }
  if (elapsedMs >= INTRO_BURST_MS) return settle;
  const p = Math.max(0, elapsedMs) / INTRO_BURST_MS;
  const eased = 1 - Math.pow(1 - p, 2);
  const tick = Math.floor(eased * INTRO_TICKS);
  return (tick * 3 + 1) % n;
}

// ---- typewriter phases ----

const CURSOR_BLINK_MS = 500; // full on+off cycle ≈ blink ~twice a second
// select-all delete: highlight for the first part of the delete window, then gone.
const SELECT_FLASH_FRAC = 0.6;

export interface TypewriterProgress {
  /** Fraction of characters to reveal (typing/deleting); 1 = full text. */
  revealFrac: number;
  /** Whether any text is on screen this frame. */
  showText: boolean;
  /** Draw the end-of-text cursor bar. */
  cursor: boolean;
  /** Cursor visible this frame (blink state). */
  cursorOn: boolean;
  /** Draw the select-all highlight behind the full text. */
  selectAll: boolean;
}

/** What to render for a typewriter caption at absolute time `sec`. */
export function typewriterProgress(el: TypewriterCaption, sec: number): TypewriterProgress {
  const t = sec - el.start;
  const typing = Math.max(0, el.typingDur);
  const hold = Math.max(0, el.holdDur);
  const blinkOn = (sec * 1000) % CURSOR_BLINK_MS < CURSOR_BLINK_MS / 2;

  if (t < typing) {
    // Typing: cursor solid while characters appear.
    return {
      revealFrac: typing <= 0 ? 1 : t / typing,
      showText: true,
      cursor: true,
      cursorOn: true,
      selectAll: false,
    };
  }
  if (t < typing + hold) {
    // Hold: full text, blinking cursor.
    return { revealFrac: 1, showText: true, cursor: true, cursorOn: blinkOn, selectAll: false };
  }
  // Deletion (only reached when enabled — otherwise the element's range has ended).
  const dt = t - typing - hold;
  const dd = Math.max(0.001, el.deleteDur);
  if (el.deleteStyle === 'char') {
    return {
      revealFrac: Math.max(0, 1 - dt / dd),
      showText: true,
      cursor: true,
      cursorOn: true,
      selectAll: false,
    };
  }
  // select-all: flash highlighted, then the whole thing disappears at once.
  if (dt / dd < SELECT_FLASH_FRAC) {
    return { revealFrac: 1, showText: true, cursor: false, cursorOn: false, selectAll: true };
  }
  return { revealFrac: 0, showText: false, cursor: false, cursorOn: false, selectAll: false };
}

// ---- factories ----

function id(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function createCaption(overrides: Partial<Caption> = {}): Caption {
  return {
    kind: 'boil',
    id: id(),
    text: 'New caption',
    start: 0,
    end: 2,
    x: 0.5,
    y: 0.5,
    color: '#ffffff',
    sizeScale: 1,
    rotation: 0,
    align: 'center',
    legibility: 'outline',
    pool: 'default',
    settleFontIndex: 0,
    boil: 'intro',
    normalize: true,
    attachments: [],
    ...overrides,
  };
}

export function createTypewriter(overrides: Partial<TypewriterCaption> = {}): TypewriterCaption {
  return {
    kind: 'typewriter',
    id: id(),
    text: 'Typewriter',
    start: 0,
    x: 0.5,
    y: 0.72,
    color: '#ffffff',
    sizeScale: 1,
    rotation: 0,
    align: 'center',
    legibility: 'outline',
    fontKey: 'default:9', // Space Mono — reads typewriter-ish
    typingDur: 1.2,
    holdDur: 1.5,
    deleteEnabled: false,
    deleteStyle: 'char',
    deleteDur: 0.8,
    attachments: [],
    ...overrides,
  };
}

// ---- attachments: static window, words, timing ----

/** Words in reading order — the index space attachments select over. */
export function captionWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * The interval during which an element's words are fully static (so an
 * attachment may show): a typewriter's hold, an `off` boil's whole range, or an
 * `intro` boil after it settles. Returns null when there is no static window
 * (a `continuous` boil, or a window of zero length).
 */
export function staticWindowOf(el: CaptionEl): { start: number; end: number } | null {
  if (el.kind === 'typewriter') {
    const s = el.start + Math.max(0, el.typingDur);
    const e = s + Math.max(0, el.holdDur);
    return e > s ? { start: s, end: e } : null;
  }
  if (el.boil === 'continuous') return null;
  const s = el.boil === 'intro' ? el.start + INTRO_BURST_MS / 1000 : el.start;
  const e = el.end;
  return e > s ? { start: s, end: e } : null;
}

/** Smooth acceleration/deceleration for the sweep ends. */
export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Visible horizontal fraction [a, b] (0..1) of an attachment's word span at
 * progress `p` (0..1 across its duration). Entry grows from the left edge
 * (0→b); exit slides the left edge rightward (a→1) so it slips off the right.
 * Returns null outside [0, 1].
 */
export function attachmentReveal(
  att: Pick<Attachment, 'inFrac' | 'outFrac'>,
  p: number,
): { a: number; b: number } | null {
  if (p < 0 || p > 1) return null;
  const inEnd = Math.max(0, Math.min(1, att.inFrac));
  const outFrac = Math.max(0, Math.min(1 - Math.min(inEnd, 1), att.outFrac));
  const outStart = 1 - outFrac;
  if (inEnd > 0 && p < inEnd) {
    return { a: 0, b: easeInOutCubic(p / inEnd) };
  }
  if (p < outStart) return { a: 0, b: 1 };
  if (outFrac > 0) {
    return { a: easeInOutCubic((p - outStart) / outFrac), b: 1 };
  }
  return { a: 0, b: 1 };
}

let attId = 0;
export function createAttachment(overrides: Partial<Attachment> = {}): Attachment {
  attId += 1;
  const type = overrides.type ?? 'underline';
  return {
    id: `att-${Date.now().toString(36)}-${attId}`,
    type,
    wordStart: 0,
    wordEnd: 0,
    startInStatic: 0,
    duration: 1.2,
    inFrac: 0.1,
    outFrac: 0.1,
    color: type === 'highlight' ? '#ffe14d' : '#ff2d55',
    opacity: 0.4,
    ...overrides,
  };
}
