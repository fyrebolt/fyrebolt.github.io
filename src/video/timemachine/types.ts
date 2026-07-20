// ===== Time Machine speed-keyframe model + interpolation =====
//
// Modelled on the Zoom keyframe track (src/video/zoom/types.ts): a SINGLE
// sequential track where only one playback speed is active at a time. Each
// keyframe animates from the current speed to its `speed` over a `duration`
// ramp (0 = an instant change), then HOLDS that speed until the next keyframe's
// start. Before the first keyframe (or with none) playback is NORMAL_SPEED.
//
//   speed 1   = real time
//   speed 0.5 = slow-motion (a "replay")   speed 2 = fast-forward
//   speed 0   = a freeze (hold the current frame) — the generalisation of the
//               Entrance Banner's pause. A freeze that "lasts N seconds" is just
//               a speed-0 keyframe followed by a resume keyframe N seconds later.
//
// The track is authored in OUTPUT seconds (like zoom). project/timeMap.ts
// integrates it into the output→source time-warp that drives preview + export.

import { smoothstep } from '../zoom/types';

/** Playback speed when no Time Machine effect is active. */
export const NORMAL_SPEED = 1;
/** Fastest fast-forward the UI allows. */
export const MAX_SPEED = 4;
/** At or below this the segment is treated as a freeze (video paused). */
export const FREEZE_EPS = 0.02;

export interface SpeedKeyframe {
  id: string;
  /** Time the ramp to this keyframe's speed begins (OUTPUT seconds). */
  start: number;
  /** Ramp duration (seconds). 0 = instant speed change. */
  duration: number;
  /** Target playback speed held until the next keyframe (0 = freeze). */
  speed: number;
  /** Play a whoosh when this transition starts (a "replay" cue). */
  whoosh: boolean;
}

export function sortedSpeeds(kfs: SpeedKeyframe[]): SpeedKeyframe[] {
  return [...kfs].sort((a, b) => a.start - b.start);
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

/**
 * The playback speed at OUTPUT time `t`. Handles a keyframe whose start
 * interrupts a still-running ramp by carrying the current interpolated speed
 * forward as the next keyframe's "from" state — identical structure to
 * zoom/types.ts `rectAt`, but for a scalar.
 */
export function speedAt(t: number, kfs: SpeedKeyframe[]): number {
  const s = sortedSpeeds(kfs);
  if (s.length === 0 || t < s[0].start) return NORMAL_SPEED;
  let from = NORMAL_SPEED;
  for (let i = 0; i < s.length; i++) {
    const kf = s[i];
    const end = kf.start + Math.max(0.0001, kf.duration);
    const nextStart = i + 1 < s.length ? s[i + 1].start : Infinity;
    if (t < nextStart) {
      if (t >= end) return kf.speed; // holding
      return lerp(from, kf.speed, smoothstep((t - kf.start) / (end - kf.start)));
    }
    from = nextStart >= end ? kf.speed : lerp(from, kf.speed, smoothstep((nextStart - kf.start) / (end - kf.start)));
  }
  return from;
}

/**
 * The highest speed the clip could still reach at or after OUTPUT time `t` — the
 * current speed plus the target of every keyframe not yet fully in the past (its
 * ramp still landing). Used to tell a temporary freeze (a resume is coming) from
 * a permanent end-freeze. A keyframe counts while `t` is before its ramp END, so
 * the speed ramping *up* out of a freeze is still seen once its start is behind.
 */
export function maxSpeedFrom(t: number, kfs: SpeedKeyframe[]): number {
  let m = speedAt(t, kfs);
  for (const kf of kfs) if (kf.start + Math.max(0.0001, kf.duration) >= t) m = Math.max(m, kf.speed);
  return m;
}

let counter = 0;
export function createSpeed(overrides: Partial<SpeedKeyframe> = {}): SpeedKeyframe {
  counter += 1;
  return {
    id: `tm${Date.now().toString(36)}${counter}`,
    start: 0,
    duration: 0.6,
    speed: 0.5,
    whoosh: false,
    ...overrides,
  };
}
