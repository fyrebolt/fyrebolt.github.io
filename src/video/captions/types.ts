// ===== Caption element model + font-boil timing =====

export type BoilMode = 'off' | 'intro' | 'continuous';

export type TextAlign = 'left' | 'center' | 'right';

export type Legibility = 'outline' | 'shadow' | 'none';

export interface Caption {
  id: string;
  /** Raw text; may contain manual line breaks. */
  text: string;
  /** Time range in seconds. */
  start: number;
  end: number;
  /** Normalised centre position (0..1 of the output frame), so it scales across ratios. */
  x: number;
  y: number;
  // ---- style ----
  color: string;
  /** Multiplier on the base font size (which scales with frame height). */
  sizeScale: number;
  align: TextAlign;
  legibility: Legibility;
  /** Index into BOIL_FONTS — the font it settles on. */
  settleFontIndex: number;
  boil: BoilMode;
}

// Font-boil pacing.
const INTRO_BURST_MS = 900; // how long the intro roll lasts before settling
const INTRO_TICKS = 18; // number of font switches packed into the burst
const CONTINUOUS_INTERVAL_MS = 90; // steady switch interval for continuous mode

/**
 * Which pool font (index into a pool of `poolLen` fonts) to show for a caption
 * at `elapsedMs` since it appeared.
 * - off: always the settle font.
 * - continuous: steady cycle through the whole pool, no settle.
 * - intro: a slot-machine roll whose switch interval decelerates (via easeOut),
 *   landing on the settle font once the burst ends.
 */
export function boilFontIndex(cap: Caption, elapsedMs: number, poolLen: number): number {
  const n = Math.max(1, poolLen);
  const settle = Math.max(0, Math.min(n - 1, cap.settleFontIndex));
  if (cap.boil === 'off') return settle;
  if (cap.boil === 'continuous') {
    return Math.floor(Math.max(0, elapsedMs) / CONTINUOUS_INTERVAL_MS) % n;
  }
  // intro burst
  if (elapsedMs >= INTRO_BURST_MS) return settle;
  const p = Math.max(0, elapsedMs) / INTRO_BURST_MS; // 0..1
  const eased = 1 - Math.pow(1 - p, 2); // easeOutQuad: fast early, slow near the end
  const tick = Math.floor(eased * INTRO_TICKS);
  // Step through the pool by a stride so consecutive frames look clearly different.
  return (tick * 3 + 1) % n;
}

export function createCaption(overrides: Partial<Caption> = {}): Caption {
  return {
    id: Math.random().toString(36).slice(2, 9),
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
