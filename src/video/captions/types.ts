// ===== Overlay element model: font-boil captions + typewriter captions =====

export type BoilMode = 'off' | 'intro' | 'continuous';

export type TextAlign = 'left' | 'center' | 'right';

export type Legibility = 'outline' | 'shadow' | 'none';

export type DeleteStyle = 'char' | 'selectAll';

/** Fields shared by every overlay element (also the input to the text renderer). */
export interface CaptionTextStyle {
  text: string;
  /** Normalised centre position (0..1 of the output frame), so it scales across ratios. */
  x: number;
  y: number;
  color: string;
  /** Multiplier on the base font size (which scales with frame height). */
  sizeScale: number;
  align: TextAlign;
  legibility: Legibility;
}

interface BaseElement extends CaptionTextStyle {
  id: string;
  /** Start time in seconds. */
  start: number;
}

/** Font-boil caption (the original element type). */
export interface Caption extends BaseElement {
  kind: 'boil';
  /** End time in seconds. */
  end: number;
  /** Index into the active pool — the font it settles on. */
  settleFontIndex: number;
  boil: BoilMode;
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
    align: 'center',
    legibility: 'outline',
    settleFontIndex: 0,
    boil: 'intro',
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
    align: 'center',
    legibility: 'outline',
    fontKey: 'default:9', // Space Mono — reads typewriter-ish
    typingDur: 1.2,
    holdDur: 1.5,
    deleteEnabled: false,
    deleteStyle: 'char',
    deleteDur: 0.8,
    ...overrides,
  };
}
