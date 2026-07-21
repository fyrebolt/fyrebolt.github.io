// ===== Time Machine free-form speed curve =====
//
// A FREE-FORM playback-speed curve, modelled exactly on the clip volume-
// automation curve (src/video/project/clips.ts: VolumePoint / sampleVolume /
// applyOscillation). The track is an ordered list of {t, speed} control points:
//   - click the timeline lane      → add a point
//   - drag a point                 → move it (x = OUTPUT time, y = speed)
//   - select + Delete              → remove it
// Speed interpolates LINEARLY between adjacent points and holds flat outside the
// point range, so NO points == a flat 1× (normal speed, unchanged) and existing
// projects are never affected until someone edits a curve.
//
//   speed 1   = real time
//   speed 0.5 = slow-motion (a "replay")   speed 2 = fast-forward
//   speed 0   = a freeze (hold the current frame) — the generalisation of the
//               Entrance Banner's pause. Unlike the clip's `muted` flag (an all-
//               or-nothing OVERRIDE of a curve you want to preserve), a freeze is
//               a LOCAL span the curve expresses natively: a flat run of 0-speed
//               points. So there is no separate "freeze" toggle — the "+ Freeze"
//               preset just writes ordinary 0-speed points (draggable/deletable
//               afterward like any other), exactly as the tremolo generator does
//               for the volume curve.
//
// The curve is authored in OUTPUT seconds (like the old keyframe track and like
// every other timeline row). project/timeMap.ts integrates speed over output
// time into the output→source time-warp that drives preview + export.

/** Playback speed when no Time Machine effect is active. */
export const NORMAL_SPEED = 1;
/** Fastest fast-forward the UI allows. */
export const MAX_SPEED = 4;
/** At or below this the curve is treated as a freeze (video paused). */
export const FREEZE_EPS = 0.02;

/**
 * One control point of the speed curve. `t` is OUTPUT seconds; `speed` is the
 * playback multiplier (0 = freeze, 1 = real time, up to MAX_SPEED).
 */
export interface SpeedPoint {
  t: number;
  speed: number;
}

/** Clamp a raw speed into the editable range [0, MAX_SPEED]. */
export function clampSpeed(speed: number): number {
  if (!isFinite(speed)) return NORMAL_SPEED;
  return Math.max(0, Math.min(MAX_SPEED, speed));
}

/** Curve points sorted by time (stable copy — never mutates the input). */
export function sortedSpeeds(points: SpeedPoint[]): SpeedPoint[] {
  return points.slice().sort((a, b) => a.t - b.t);
}

/**
 * Playback speed at OUTPUT time `t`. No points → flat NORMAL_SPEED. Linear
 * interpolation between adjacent points; clamped to the first/last speed outside
 * the point range. Mirrors clips.sampleVolume.
 */
export function speedAt(t: number, points: SpeedPoint[] | undefined): number {
  if (!points || points.length === 0) return NORMAL_SPEED;
  if (points.length === 1) return clampSpeed(points[0].speed);
  const pts = sortedSpeeds(points);
  if (t <= pts[0].t) return clampSpeed(pts[0].speed);
  const last = pts[pts.length - 1];
  if (t >= last.t) return clampSpeed(last.speed);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const f = span <= 1e-6 ? 0 : (t - a.t) / span;
      return clampSpeed(a.speed + (b.speed - a.speed) * f);
    }
  }
  return clampSpeed(last.speed);
}

/**
 * The highest speed the curve still reaches at or after OUTPUT time `t` — the
 * current speed, every point at/after `t`, and the flat tail (held at the last
 * point). Used by the warp to tell a temporary freeze (a resume is coming) from
 * a permanent end-freeze. Mirrors the old maxSpeedFrom, curve-shaped.
 */
export function maxSpeedFrom(t: number, points: SpeedPoint[] | undefined): number {
  const s = points ? sortedSpeeds(points) : [];
  if (s.length === 0) return NORMAL_SPEED;
  let m = speedAt(t, s);
  for (const p of s) if (p.t + 1e-9 >= t) m = Math.max(m, clampSpeed(p.speed));
  // Beyond the last point the curve holds flat at its speed.
  m = Math.max(m, clampSpeed(s[s.length - 1].speed));
  return m;
}

export interface SpeedRegionOpts {
  /** Output time the region begins (its leading 1× boundary). */
  start: number;
  /** Held speed through the middle of the region (0 = freeze). */
  speed: number;
  /** Ramp time into and out of the held speed (seconds). */
  ramp: number;
  /** How long the held speed lasts (seconds). */
  hold: number;
}

/** Ramp/hold defaults for the panel presets (output seconds). */
export const REGION_RAMP = 0.25;
export const REGION_HOLD = 1.2;
/** Freeze snaps in quickly rather than easing, matching the old feel. */
export const FREEZE_RAMP = 0.12;

/**
 * Return a fresh curve with a LOCALISED speed region dropped at `start`: a 1×
 * boundary, a ramp to `speed`, a flat hold, then a ramp back to 1×. Points that
 * fall inside the region's span are replaced (like applyOscillation), so the
 * region cleanly overrides whatever was there. The emitted points are ordinary
 * curve points — draggable/deletable afterward. This is what the "+ Slow-mo /
 * + Speed up / + Freeze / + Back to 1×" presets write.
 */
export function applySpeedRegion(existing: SpeedPoint[] | undefined, opts: SpeedRegionOpts): SpeedPoint[] {
  const ramp = Math.max(0, opts.ramp);
  const hold = Math.max(0, opts.hold);
  const start = Math.max(0, opts.start);
  const speed = clampSpeed(opts.speed);
  const end = start + ramp + hold + ramp;
  const kept = (existing ?? []).filter((p) => p.t < start - 1e-4 || p.t > end + 1e-4);
  const gen: SpeedPoint[] = [
    { t: start, speed: NORMAL_SPEED },
    { t: start + ramp, speed },
    { t: start + ramp + hold, speed },
    { t: end, speed: NORMAL_SPEED },
  ];
  return sortedSpeeds([...kept, ...gen]);
}

// Speed threshold below which entering counts as a "replay" onset (fires the
// optional whoosh). Freeze (0) is a subset, so a freeze whooshes too.
export const SLOWMO_ENTER = 0.9;
