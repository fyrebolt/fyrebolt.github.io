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

export type ClipKind = 'video' | 'image';

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
}

/** Smallest a clip may be trimmed to (seconds). */
export const MIN_CLIP_LEN = 0.1;
/** Soft length cap a fresh image clip can be stretched to on the trim handles. */
export const IMAGE_CLIP_MAX = 60;

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
