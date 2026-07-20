// ===== Highlighter model: a free, timed highlight box over the footage =====
//
// A standalone version of the caption highlight attachment: a coloured,
// translucent rectangle placed anywhere on the frame that sweeps in from the
// left, holds, then slips off to the right. Unlike the caption version, its
// size/position are free and the sweep in/out are absolute seconds.

export interface Highlighter {
  id: string;
  kind: 'highlighter';
  /** Start time (s). */
  start: number;
  /** Total on-screen lifetime (s) = sweepIn + hold + sweepOut. */
  duration: number;
  /** Sweep-in / sweep-out durations (s); hold = duration - the two. */
  sweepIn: number;
  sweepOut: number;
  /** Placement box, normalised to the output frame (top-left + size). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation about the box centre, in radians (clockwise). */
  rotation: number;
  color: string;
  /** Fill opacity (0..1). */
  opacity: number;
}

/** End time of a highlighter (start + duration). */
export function elementEnd(h: Highlighter): number {
  return h.start + Math.max(0, h.duration);
}

let hlId = 0;
export function createHighlighter(overrides: Partial<Highlighter> = {}): Highlighter {
  hlId += 1;
  return {
    kind: 'highlighter',
    id: `hl-${Date.now().toString(36)}-${hlId}`,
    start: 0,
    duration: 2,
    sweepIn: 0.3,
    sweepOut: 0.3,
    x: 0.25,
    y: 0.46,
    w: 0.5,
    h: 0.08,
    rotation: 0,
    color: '#ffe14d',
    opacity: 0.4,
    ...overrides,
  };
}
