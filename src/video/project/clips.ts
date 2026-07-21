// ===== Multi-clip base sequence =====
//
// The editor's BASE timeline is an ordered list of clips. Their trimmed lengths
// concatenate into one continuous "base" clock (0 .. baseDuration). This base
// clock is exactly what the single-source editor used to call SOURCE time — so
// the whole time-warp (banner freeze + Time Machine, see project/timeMap.ts) and
// every overlay layer keep working unchanged: they operate in OUTPUT / base time
// and never learn that the base is now stitched from several clips.
//
//   outputT --(warp: freeze + time machine)--> baseT --(resolveBase)--> (clip, sourceT)
//
// A single un-trimmed clip makes baseT === sourceT, so a one-clip project behaves
// exactly as the old single-source editor did.
//
// The decoded <video>/<img> elements live in a registry outside the project
// (keyed by srcId), mirroring how stickers keep their media out of the plain
// project data. VideoClip therefore carries only serialisable fields.

import type { ColorGrade } from './grade';

export type ClipKind = 'video' | 'image';

/**
 * One control point of a clip's volume-automation curve. `t` is CLIP-LOCAL
 * seconds measured from the clip's in-point (0 .. clipLen), so the curve moves
 * with the clip when clips are reordered and is independent of the base clock.
 * `level` is a gain MULTIPLIER on the clip's original audio: 1 = 100% (original),
 * 0 = silent, up to VOLUME_MAX for a boost.
 */
export interface VolumePoint {
  t: number;
  level: number;
}

export interface VideoClip {
  id: string;
  /** Registry key for the decoded media element (kept out of the project). */
  srcId: string;
  kind: ClipKind;
  /** Human label (file name) shown on the clip strip. */
  name: string;
  /** Natural media length in seconds (video). For an image this is a soft cap
   *  that only bounds how far the trim handles can stretch the still. */
  srcDuration: number;
  /** Trim in-point in SOURCE seconds. Always 0 for images (a still has no start). */
  in: number;
  /** Trim out-point in SOURCE seconds. Effective length = out - in. */
  out: number;
  /** Native pixel dimensions — used for output sizing + aspect compositing. */
  w: number;
  h: number;
  /** Volume-automation curve, ordered by `t`. Absent/empty == flat 100% (the
   *  clip's original volume, unchanged), so existing clips/projects are never
   *  affected until someone edits a curve. */
  volume?: VolumePoint[];
  /** Silence this clip's ORIGINAL audio entirely, regardless of the curve. The
   *  curve is preserved so un-muting restores exactly what was there. */
  muted?: boolean;
  /** Per-clip colour grade (brightness/contrast/saturation), applied to this
   *  clip's base frame in both preview and export. Absent == neutral. */
  grade?: ColorGrade;
}

/** Smallest a clip may be trimmed to (seconds). */
export const MIN_CLIP_LEN = 0.1;
/** Soft length cap a fresh image clip can be stretched to on the trim handles. */
export const IMAGE_CLIP_MAX = 60;

/** Ceiling of the volume multiplier — allows boosting to 200% of original. */
export const VOLUME_MAX = 2;

/** Clamp a raw level into the editable range [0, VOLUME_MAX]. */
export function clampLevel(level: number): number {
  if (!isFinite(level)) return 1;
  return Math.max(0, Math.min(VOLUME_MAX, level));
}

/** Curve points sorted by time (stable copy — never mutates the input). */
export function sortedVolume(points: VolumePoint[]): VolumePoint[] {
  return points.slice().sort((a, b) => a.t - b.t);
}

/**
 * Volume MULTIPLIER at clip-local time `t` (seconds from the clip's in-point).
 * No points → flat 1.0 (original volume). Linear interpolation between adjacent
 * points; clamped to the first/last level outside the point range.
 */
export function sampleVolume(points: VolumePoint[] | undefined, t: number): number {
  if (!points || points.length === 0) return 1;
  if (points.length === 1) return clampLevel(points[0].level);
  const pts = sortedVolume(points);
  if (t <= pts[0].t) return clampLevel(pts[0].level);
  const last = pts[pts.length - 1];
  if (t >= last.t) return clampLevel(last.level);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const f = span <= 1e-6 ? 0 : (t - a.t) / span;
      return clampLevel(a.level + (b.level - a.level) * f);
    }
  }
  return clampLevel(last.level);
}

export interface OscillationOpts {
  /** Clip-local range to fill (seconds from the in-point). */
  start: number;
  end: number;
  /** Oscillations per second. */
  freq: number;
  /** How far the level swings above/below `center`. */
  depth: number;
  /** Level the wave oscillates around (e.g. 1 = original volume). */
  center: number;
}

/** Sample points generated per oscillation cycle (linear interp smooths these). */
const OSC_SAMPLES_PER_CYCLE = 12;
/** Hard cap on generated points so pathological freq × range can't explode. */
const OSC_MAX_POINTS = 480;

/**
 * Return a fresh curve where the range [start, end] is replaced by a sine/tremolo
 * wave (level = center + depth·sin) sampled densely enough that linear
 * interpolation reads as smooth. Points OUTSIDE the range are preserved, so a
 * partial-range generate only rewrites what it covers. The emitted points are
 * ordinary curve points — draggable/deletable afterward like any other.
 */
export function applyOscillation(existing: VolumePoint[] | undefined, opts: OscillationOpts): VolumePoint[] {
  const start = Math.max(0, Math.min(opts.start, opts.end));
  const end = Math.max(opts.start, opts.end);
  const span = end - start;
  const freq = Math.max(0, opts.freq);
  const kept = (existing ?? []).filter((p) => p.t < start - 1e-4 || p.t > end + 1e-4);
  if (span <= 1e-4 || freq <= 0) return sortedVolume(kept);

  const cycles = span * freq;
  const n = Math.min(OSC_MAX_POINTS, Math.max(2, Math.ceil(cycles * OSC_SAMPLES_PER_CYCLE)));
  const gen: VolumePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (span * i) / n;
    const level = clampLevel(opts.center + opts.depth * Math.sin(2 * Math.PI * freq * (t - start)));
    gen.push({ t, level });
  }
  return sortedVolume([...kept, ...gen]);
}

/** Effective on-timeline length of a clip (trimmed), in seconds. */
export function clipLen(c: VideoClip): number {
  return Math.max(MIN_CLIP_LEN, c.out - c.in);
}

/** Total base-sequence duration = sum of every clip's trimmed length. */
export function baseDuration(clips: VideoClip[]): number {
  let s = 0;
  for (const c of clips) s += clipLen(c);
  return s;
}

/** Base time at which clip `index` starts (sum of preceding clip lengths). */
export function clipStartAt(clips: VideoClip[], index: number): number {
  let s = 0;
  for (let i = 0; i < index && i < clips.length; i++) s += clipLen(clips[i]);
  return s;
}

export interface BaseHit {
  index: number;
  clip: VideoClip;
  /** Base time where this clip starts. */
  clipStart: number;
  /** Time from the clip's start (0 .. clipLen). */
  local: number;
  /** SOURCE time inside the clip's media = clip.in + local. */
  sourceT: number;
}

/**
 * Resolve a base-sequence time to the clip showing at that instant and the
 * source time within its media. Clamps into the sequence; returns null only when
 * there are no clips. The final clip owns any overrun (base time >= total).
 */
export function resolveBase(clips: VideoClip[], baseT: number): BaseHit | null {
  if (clips.length === 0) return null;
  const t = Math.max(0, baseT);
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = clipLen(clips[i]);
    const last = i === clips.length - 1;
    if (t < acc + len || last) {
      const local = Math.max(0, Math.min(len, t - acc));
      return { index: i, clip: clips[i], clipStart: acc, local, sourceT: clips[i].in + local };
    }
    acc += len;
  }
  return null; // unreachable
}

/** Whether any clip in the sequence is a video (drives audio + playback steering). */
export function hasVideoClip(clips: VideoClip[]): boolean {
  return clips.some((c) => c.kind === 'video');
}

// ---- split (razor) ----

/**
 * Split a clip into two independent clips at CLIP-LOCAL time `local` (seconds
 * from the clip's in-point). The two halves share the same source media (srcId)
 * but own fresh ids, so they trim / delete / grade independently afterward.
 *
 * The volume curve is CLIP-LOCAL (see VolumePoint), so it is redistributed, not
 * discarded or duplicated: points before the split stay on the FIRST clip
 * unchanged; points at/after the split move to the SECOND clip with their time
 * rebased to the new clip's own in-point (t -= local). All other per-clip
 * properties (mute, colour grade, name, dims) carry to both halves.
 *
 * Returns null if the split point isn't at least MIN_CLIP_LEN from both ends
 * (splitting there would leave a sub-minimum clip).
 */
export function splitClip(c: VideoClip, local: number): [VideoClip, VideoClip] | null {
  const len = clipLen(c);
  if (local < MIN_CLIP_LEN || local > len - MIN_CLIP_LEN) return null;

  const points = c.volume ?? [];
  const firstVol = points.filter((p) => p.t < local);
  const secondVol = points.filter((p) => p.t >= local).map((p) => ({ ...p, t: p.t - local }));

  // Split source seconds: for a still (in === 0) the "in" stays 0 and the length
  // lives in `out`; for video the second clip picks up where the first left off.
  const cutSource = c.kind === 'image' ? local : c.in + local;

  uid += 1;
  const first: VideoClip = {
    ...c,
    id: `clip-${Date.now().toString(36)}-${uid}`,
    out: c.kind === 'image' ? local : cutSource,
    volume: firstVol.length ? firstVol : undefined,
  };
  uid += 1;
  const second: VideoClip = {
    ...c,
    id: `clip-${Date.now().toString(36)}-${uid}`,
    in: c.kind === 'image' ? 0 : cutSource,
    out: c.kind === 'image' ? len - local : c.out,
    volume: secondVol.length ? secondVol : undefined,
  };
  return [first, second];
}

// ---- factory ----

let uid = 0;
export function createClip(
  seed: { srcId: string; kind: ClipKind; name: string; srcDuration: number; w: number; h: number },
  overrides: Partial<VideoClip> = {},
): VideoClip {
  uid += 1;
  const srcDuration =
    seed.kind === 'image' ? IMAGE_CLIP_MAX : Math.max(MIN_CLIP_LEN, seed.srcDuration);
  const out = seed.kind === 'image' ? 6 : srcDuration;
  return {
    id: `clip-${Date.now().toString(36)}-${uid}`,
    srcId: seed.srcId,
    kind: seed.kind,
    name: seed.name,
    srcDuration,
    in: 0,
    out,
    w: seed.w,
    h: seed.h,
    ...overrides,
  };
}
