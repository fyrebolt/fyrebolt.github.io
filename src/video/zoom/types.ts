// ===== Zoom keyframe model + interpolation =====
//
// Zoom keyframes are SEQUENTIAL (only one zoom state is active at a time). Each
// keyframe animates from the current state to its target crop rectangle over a
// transition duration, then holds that rectangle until the next keyframe's
// start. Before the first keyframe (or with none) the frame is at FULL_RECT.
//
// The crop rectangle is normalised to the ORIGINAL source frame (0..1). It is
// non-destructive: values may fall outside 0..1 (dragging out past the full
// frame just adds letterboxing), and editing always references the full source.

export interface ZoomRect {
  /** Top-left + size, normalised to the source frame (0..1). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_RECT: ZoomRect = { x: 0, y: 0, w: 1, h: 1 };

export interface ZoomKeyframe {
  id: string;
  /** Time the transition to this keyframe's rectangle begins (seconds). */
  start: number;
  /** Transition duration (seconds). */
  duration: number;
  /** Target crop rectangle (source-normalised). */
  rect: ZoomRect;
  /** Play a whoosh when this transition starts. */
  whoosh: boolean;
}

function clamp01(p: number): number {
  return Math.max(0, Math.min(1, p));
}

/** Smooth ease-in-out for the zoom motion. */
export function smoothstep(p: number): number {
  p = clamp01(p);
  return p * p * (3 - 2 * p);
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

function lerpRect(a: ZoomRect, b: ZoomRect, p: number): ZoomRect {
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) };
}

export function sortedZooms(kfs: ZoomKeyframe[]): ZoomKeyframe[] {
  return [...kfs].sort((a, b) => a.start - b.start);
}

/**
 * The interpolated crop rectangle at time `t`. Handles a keyframe whose start
 * interrupts a still-running transition by carrying the current interpolated
 * rect forward as the next keyframe's "from" state.
 */
export function rectAt(t: number, kfs: ZoomKeyframe[]): ZoomRect {
  const s = sortedZooms(kfs);
  if (s.length === 0 || t < s[0].start) return FULL_RECT;
  let from = FULL_RECT;
  for (let i = 0; i < s.length; i++) {
    const kf = s[i];
    const end = kf.start + Math.max(0.0001, kf.duration);
    const nextStart = i + 1 < s.length ? s[i + 1].start : Infinity;
    if (t < nextStart) {
      if (t >= end) return kf.rect; // holding
      return lerpRect(from, kf.rect, smoothstep((t - kf.start) / (end - kf.start)));
    }
    // Advance: compute the state entering the next keyframe's start.
    from = nextStart >= end ? kf.rect : lerpRect(from, kf.rect, smoothstep((nextStart - kf.start) / (end - kf.start)));
  }
  return from;
}

let counter = 0;
export function createZoom(overrides: Partial<ZoomKeyframe> = {}): ZoomKeyframe {
  counter += 1;
  return {
    id: `z${Date.now().toString(36)}${counter}`,
    start: 0,
    duration: 1,
    rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
    whoosh: false,
    ...overrides,
  };
}
