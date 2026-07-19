// ===== Dramatic wording model =====
//
// Big, plain uppercase words over the footage — the "Instagram edit" look.
// Three modes:
//  - normal:     the word itself is translucent over the clear video.
//  - inverse:    a dim scrim covers everything EXCEPT the word, which stays a
//                clear window onto the video (up to a full black-out).
//  - reflection: the footage showing through the word's silhouette is
//                colour-inverted (an "electronic/negative" look), with opacity
//                acting as the inversion strength.
// Words never overlap in time (only one effect is active at a moment), which
// keeps the modes from colliding.

export type WordMode = 'normal' | 'inverse' | 'reflection';

export interface DramaticWord {
  id: string;
  text: string;
  /** Normalised centre position (0..1 of the output frame). */
  x: number;
  y: number;
  /** Multiplier on the base font size (which scales with frame height). */
  sizeScale: number;
  /** normal → word colour; inverse → scrim colour. */
  color: string;
  /** Translucency (0..1): normal = word opacity; inverse = scrim opacity. */
  opacity: number;
  mode: WordMode;
  /** Start time (s). */
  start: number;
  /** Hold duration (s), including the fades. */
  duration: number;
  /** Fade-in / fade-out durations (s); 0 = hard cut. */
  fadeIn: number;
  fadeOut: number;
}

export function elementEnd(w: DramaticWord): number {
  return w.start + Math.max(0, w.duration);
}

function smoothstep(p: number): number {
  p = Math.max(0, Math.min(1, p));
  return p * p * (3 - 2 * p);
}

/** Envelope 0..1 for a word at absolute time `sec` (fade-in → hold → fade-out). */
export function wordEnvelope(w: DramaticWord, sec: number): number {
  const t = sec - w.start;
  const dur = Math.max(0.0001, w.duration);
  if (t < 0 || t > dur) return 0;
  const rise = w.fadeIn > 0 ? smoothstep(t / w.fadeIn) : 1;
  const fall = w.fadeOut > 0 ? smoothstep((dur - t) / w.fadeOut) : 1;
  return Math.min(rise, fall);
}

let wid = 0;
export function createDramaticWord(overrides: Partial<DramaticWord> = {}): DramaticWord {
  wid += 1;
  const mode = overrides.mode ?? 'normal';
  const text = mode === 'inverse' ? 'FOCUS' : mode === 'reflection' ? 'INVERT' : 'DRAMATIC';
  return {
    id: `dw-${Date.now().toString(36)}-${wid}`,
    text,
    x: 0.5,
    y: 0.5,
    sizeScale: 1,
    // normal: light grey translucent word; inverse: black scrim; reflection:
    // colour is unused (the video is inverted) — keep a sensible placeholder.
    color: mode === 'inverse' ? '#000000' : '#dcdcdc',
    // reflection: opacity is the inversion strength — full-strength by default.
    opacity: mode === 'inverse' ? 0.72 : mode === 'reflection' ? 1 : 0.55,
    mode,
    start: 0,
    duration: 2,
    fadeIn: 0.25,
    fadeOut: 0.25,
    ...overrides,
  };
}
