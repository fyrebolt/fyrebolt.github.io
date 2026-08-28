// ===== Multi-clip base sequence =====
//
// The editor's BASE timeline is a list of clips laid out on one continuous "base"
// clock (0 .. baseDuration). This base clock is exactly what the single-source
// editor used to call SOURCE time — so the whole time-warp (banner freeze + Time
// Machine, see project/timeMap.ts) and every overlay layer keep working
// unchanged: they operate in OUTPUT / base time and never learn that the base is
// now stitched from several clips.
//
//   outputT --(warp: freeze + time machine)--> baseT --(layout)--> (clip, sourceT)
//
// A single un-trimmed clip makes baseT === sourceT, so a one-clip project behaves
// exactly as the old single-source editor did.
//
// LAYOUT — clips are laid out left to right by `layoutClips`. A clip with no
// `baseStart` simply follows the previous one (the original purely-sequential
// behaviour, unchanged); a clip WITH one is pinned there and may therefore sit
// anywhere, including on top of its neighbours. Several clips can be live at the
// same instant, so a base time resolves to a STACK (`activeClipsAt`) rather than
// to one clip — see `z` below for the paint order.
//
// PLACEMENT — a clip also carries an optional `transform` (its rectangle on the
// output frame) and `crop` (which part of its own source shows inside that
// rectangle). Both absent == the original full-frame behaviour. This crop is a
// THIRD, independent mechanism, not to be confused with either:
//   - `Project.fillMode` — how a full-frame clip's aspect is reconciled with the
//     output frame (crop-to-fill / blur-pad / letterbox), and
//   - the Zoom layer's keyframed crop rect, a full-frame base effect on the
//     OUTPUT clock.
// It is the same idea as a Sticker's crop: which part of a source is visible
// inside its own transformed box.
//
// The decoded <video>/<img> elements live in a registry outside the project
// (keyed by srcId), mirroring how stickers keep their media out of the plain
// project data. VideoClip therefore carries only serialisable fields.

import type { ColorGrade } from './grade';
import type { Transition } from './transitions';
import type { Transform } from '../transform/TransformBox';
import type { CropRect } from '../sticker/types';

/**
 * `blank` is a clip with NO source: it paints an opaque black rectangle in its own
 * box, so a full-frame one is simply a blank screen for its length. It is the
 * timeline's gap / hold primitive — and, because it takes part in boundary
 * transitions like any other plain clip, a crossfade into one is a fade to black.
 * It behaves like an image everywhere else (no in-point, a freely set length, no
 * audio), which is why `isStill` covers both.
 */
export type ClipKind = 'video' | 'image' | 'blank';

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
  /** Registry key for the decoded media element (kept out of the project).
   *  Empty for a `blank` clip, which has no media at all. */
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
  /**
   * Where this clip is pinned on the BASE clock (seconds). Absent == "straight
   * after the previous clip", i.e. the original sequential layout — so existing
   * projects lay out bit-for-bit as before. Set it (by dragging the clip along
   * the timeline) to move a clip freely, including over its neighbours.
   */
  baseStart?: number;
  /**
   * Paint order where clips overlap in the SAME screen space at the SAME time
   * (higher = on top), mirroring every Layer's `z`. Absent == the clip's index,
   * so a sequential project — where nothing ever overlaps — is unaffected.
   */
  z?: number;
  /**
   * The clip's rectangle on the output frame (output-normalised box + rotation),
   * the same shape every other transformable layer stores. Absent == full-frame,
   * centred, unrotated: exactly today's behaviour. Once set, the clip is drawn
   * contained inside this box and whatever sits behind it shows through the rest
   * of the frame.
   */
  transform?: Transform;
  /**
   * Which part of the clip's OWN source is visible inside `transform`
   * (source-normalised). Absent == the whole source. See the header note: this is
   * neither `fillMode` nor the Zoom layer's rect.
   */
  crop?: CropRect;
  /** Volume-automation curve, ordered by `t`. Absent/empty == flat 100% (the
   *  clip's original volume, unchanged), so existing clips/projects are never
   *  affected until someone edits a curve. */
  volume?: VolumePoint[];
  /** Silence this clip's ORIGINAL audio entirely, regardless of the curve. The
   *  curve is preserved so un-muting restores exactly what was there. */
  muted?: boolean;
  /**
   * How fast this clip's own source plays: 1 = normal, 2 = double, 0.5 = half,
   * and **0 = freeze** (hold one frame — see `hold`). Absent == 1, so every
   * existing clip and project lays out bit-for-bit as before.
   *
   * This is a SEPARATE mechanism from the Time Machine layer. That layer warps
   * the OUTPUT clock onto the base clock (`outputT → baseT`) for the whole
   * timeline; this warps one clip's slice of the base clock onto its own source
   * (`baseT → sourceT`). They sit on either side of the base clock and compose
   * without either knowing about the other, which is why the Time Machine did
   * not have to change to make this work.
   *
   * Only meaningful for video: a still has no motion to re-rate, so `clipSpeed`
   * reports 1 for images and blanks whatever is stored here.
   */
  speed?: number;
  /**
   * Seconds a FROZEN clip (`speed === 0`) holds its frame for. Meaningless
   * otherwise. A freeze needs this because the usual arithmetic — source span
   * divided by rate — is infinite at rate zero: the length has to be stated
   * rather than derived. Absent == DEFAULT_HOLD.
   */
  hold?: number;
  /** Per-clip colour grade (brightness/contrast/saturation), applied to this
   *  clip's base frame in both preview and export. Absent == neutral. */
  grade?: ColorGrade;
  /** Transition INTO this clip, i.e. the boundary between it and the clip before
   *  it. Living on the incoming clip means it survives reorder/duplicate/split
   *  like every other per-clip property. Ignored on the first clip (no boundary
   *  before it); absent == a hard cut, so existing projects are unchanged.
   *  See project/transitions.ts — the window straddles the cut and never changes
   *  baseDuration(). */
  transitionIn?: Transition;
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

// ---- per-clip speed ----

/** Slowest and fastest a clip may run. 0 is separate: it means freeze. */
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 4;
/** Seconds a freeze holds for until someone says otherwise. */
export const DEFAULT_HOLD = 2;
/** Longest a single held frame may be stretched to. */
export const HOLD_MAX = 60;

/** Fold a raw rate into the editable range. Anything at or below 0 is a freeze. */
export function clampSpeed(v: number): number {
  if (!isFinite(v) || v <= 0) return 0;
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, v));
}

export function clampHold(v: number): number {
  if (!isFinite(v)) return DEFAULT_HOLD;
  return Math.max(MIN_CLIP_LEN, Math.min(HOLD_MAX, v));
}

/**
 * This clip's playback rate. Stills always report 1: an image has no motion to
 * re-rate and is already, in effect, a held frame — so the whole notion of
 * speed (and of freezing) only applies to video.
 */
export function clipSpeed(c: VideoClip): number {
  if (isStill(c)) return 1;
  return c.speed === undefined ? 1 : clampSpeed(c.speed);
}

/** A clip holding a single frame rather than playing. */
export function isFrozen(c: VideoClip): boolean {
  return clipSpeed(c) === 0;
}

/** How long a frozen clip holds. Only meaningful when `isFrozen`. */
export function clipHold(c: VideoClip): number {
  return clampHold(c.hold ?? DEFAULT_HOLD);
}

/** How much of the clip's SOURCE it uses, in source seconds (out − in). */
export function clipSourceSpan(c: VideoClip): number {
  return Math.max(MIN_CLIP_LEN, c.out - c.in);
}

/**
 * How long the clip occupies the TIMELINE, in seconds.
 *
 * At 1× this is the source span, which is what it always used to be and why
 * every existing caller still means the right thing. Off 1× the two part
 * company: a 4-second clip at 2× is 2 seconds of timeline, and a frozen one is
 * however long its hold says, regardless of how much source it was trimmed to.
 */
export function clipLen(c: VideoClip): number {
  if (isFrozen(c)) return clipHold(c);
  return Math.max(MIN_CLIP_LEN, clipSourceSpan(c) / clipSpeed(c));
}

/**
 * The source second this clip shows `local` seconds into its slot on the
 * timeline. A freeze answers with its in-point forever — that is the whole of
 * what freezing is: the layout gives it `hold` seconds and every one of them
 * resolves to the same frame.
 */
export function clipSourceAt(c: VideoClip, local: number): number {
  if (isFrozen(c)) return c.in;
  const t = c.in + Math.max(0, local) * clipSpeed(c);
  return Math.min(c.out, t);
}

/**
 * A clip with no moving source — an image or a blank. Stills have no in-point
 * (nothing to trim INTO), their length is set freely rather than bounded by a
 * media duration, and they carry no audio.
 */
export function isStill(c: VideoClip): boolean {
  return c.kind !== 'video';
}

/** A clip with no media at all: it paints blank (opaque black) in its own box. */
export function isBlank(c: VideoClip): boolean {
  return c.kind === 'blank';
}

/** Glyph for a clip's kind, shared by every place a clip is labelled. */
export function clipGlyph(kind: ClipKind): string {
  return kind === 'video' ? '🎬' : kind === 'blank' ? '⬛' : '🖼️';
}

/**
 * The clip whose native dimensions size the output frame — the first one that HAS
 * dimensions. A blank clip has none, so a project that opens on a blank still
 * sizes itself off the real footage that follows instead of collapsing to 0×0.
 */
export function sizingClip(clips: VideoClip[]): VideoClip | null {
  return clips.find((c) => c.w > 0 && c.h > 0) ?? null;
}

// ---- placement (transform + crop) ----

/** Full-frame, centred, unrotated — what a clip with no `transform` renders as. */
export const FULL_FRAME: Transform = { x: 0, y: 0, w: 1, h: 1, rotation: 0 };
/** The whole source — what a clip with no `crop` shows. */
export const FULL_CLIP_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export function clipTransform(c: VideoClip): Transform {
  return c.transform ?? FULL_FRAME;
}

export function clipCrop(c: VideoClip): CropRect {
  return c.crop ?? FULL_CLIP_CROP;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-4;
}

/** True when the clip still fills the frame unrotated (no explicit transform). */
export function isFullFrame(c: VideoClip): boolean {
  const t = clipTransform(c);
  return near(t.x, 0) && near(t.y, 0) && near(t.w, 1) && near(t.h, 1) && near(t.rotation, 0);
}

/** True when the clip shows its whole source (no crop applied). */
export function isFullCrop(c: VideoClip): boolean {
  const r = clipCrop(c);
  return near(r.x, 0) && near(r.y, 0) && near(r.w, 1) && near(r.h, 1);
}

/**
 * A "plain" clip is one nobody has placed yet: full-frame and uncropped. These
 * take the ORIGINAL render path (fill-mode aspect composite / zoom crop over the
 * whole canvas) so untouched projects are pixel-identical, and they are the only
 * clips eligible for a boundary transition (see project/transitions.ts).
 */
export function isPlainClip(c: VideoClip): boolean {
  return isFullFrame(c) && isFullCrop(c);
}

// ---- layout on the base clock ----

/** Paint order of a clip where clips overlap: explicit `z`, else its index. */
export function clipZ(c: VideoClip, index: number): number {
  return c.z ?? index;
}

/** One clip's resolved extent on the base clock. */
export interface ClipPlacement {
  index: number;
  clip: VideoClip;
  start: number;
  end: number;
}

/**
 * Lay every clip out on the base clock. A clip with `baseStart` is pinned there;
 * one without simply follows the clip before it — so a project where no clip has
 * ever been moved lays out as the original strict concatenation.
 */
export function layoutClips(clips: VideoClip[]): ClipPlacement[] {
  const out: ClipPlacement[] = [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const len = clipLen(c);
    const start = c.baseStart !== undefined && isFinite(c.baseStart) ? Math.max(0, c.baseStart) : cursor;
    out.push({ index: i, clip: c, start, end: start + len });
    cursor = start + len;
  }
  return out;
}

/**
 * Total base-sequence duration: the span from 0 to the LAST clip end. Clips may
 * overlap (or leave a gap), so this is a max over ends rather than a sum of
 * lengths — for a purely sequential layout the two are identical.
 */
export function baseDuration(clips: VideoClip[]): number {
  let end = 0;
  for (const p of layoutClips(clips)) end = Math.max(end, p.end);
  return end;
}

/** Base time at which clip `index` starts. */
export function clipStartAt(clips: VideoClip[], index: number): number {
  const lay = layoutClips(clips);
  return lay[index]?.start ?? 0;
}

export interface BaseHit {
  index: number;
  clip: VideoClip;
  /** Base time where this clip starts. */
  clipStart: number;
  /** Time from the clip's start on the TIMELINE (0 .. clipLen). */
  local: number;
  /** SOURCE time inside the clip's media. Equals `in + local` only at 1×; see
   *  `clipSourceAt` for what speed and freezing do to that. */
  sourceT: number;
}

function hitOf(p: ClipPlacement, baseT: number): BaseHit {
  const len = clipLen(p.clip);
  const local = Math.max(0, Math.min(len, baseT - p.start));
  return {
    index: p.index,
    clip: p.clip,
    clipStart: p.start,
    local,
    sourceT: clipSourceAt(p.clip, local),
  };
}

/**
 * Every clip live at base time `baseT`, BOTTOM-FIRST in paint order (`clipZ`,
 * ties broken by sequence index). Usually one clip — the stack only grows when
 * clips have been given overlapping time ranges.
 *
 * Past the very end of the sequence the last-ending clip holds its final frame,
 * preserving the original "the final clip owns any overrun" contract. A genuine
 * GAP between clips returns nothing: the frame there is empty, by design.
 */
export function activeClipsAt(clips: VideoClip[], baseT: number): BaseHit[] {
  if (clips.length === 0) return [];
  const t = Math.max(0, baseT);
  const lay = layoutClips(clips);
  const live = lay.filter((p) => t >= p.start && t < p.end);
  if (live.length === 0) {
    const last = lay.reduce((a, b) => (b.end >= a.end ? b : a));
    return t >= last.end ? [hitOf(last, t)] : [];
  }
  live.sort((a, b) => clipZ(a.clip, a.index) - clipZ(b.clip, b.index) || a.index - b.index);
  return live.map((p) => hitOf(p, t));
}

/**
 * The TOP-MOST clip showing at base time `baseT` — the one a razor cut, a seek,
 * or the zoom base frame refers to. Returns null only when there are no clips at
 * all; in a gap between clips it falls back to the nearest preceding clip so the
 * transport still has something to steer.
 */
export function resolveBase(clips: VideoClip[], baseT: number): BaseHit | null {
  if (clips.length === 0) return null;
  const stack = activeClipsAt(clips, baseT);
  if (stack.length > 0) return stack[stack.length - 1];
  // Interior gap: the nearest clip that has already ended (else the first clip).
  const t = Math.max(0, baseT);
  const lay = layoutClips(clips);
  const before = lay.filter((p) => p.end <= t);
  const pick = before.length > 0 ? before.reduce((a, b) => (b.end >= a.end ? b : a)) : lay[0];
  return hitOf(pick, t);
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

  // Where the cut lands in SOURCE seconds. `local` is a position on the
  // timeline, so off 1× it is not the same number: half way along a 2× clip is
  // twice as far into its source. A freeze has no source position to split at
  // all — every instant of it is the same frame — so it splits its HOLD instead
  // and both halves go on showing that frame.
  const still = isStill(c);
  const frozen = isFrozen(c);
  const cutSource = still ? local : c.in + local * clipSpeed(c);

  uid += 1;
  const first: VideoClip = {
    ...c,
    id: `clip-${Date.now().toString(36)}-${uid}`,
    out: frozen ? c.out : still ? local : cutSource,
    hold: frozen ? local : c.hold,
    volume: firstVol.length ? firstVol : undefined,
    transform: c.transform ? { ...c.transform } : undefined,
    crop: c.crop ? { ...c.crop } : undefined,
  };
  uid += 1;
  const second: VideoClip = {
    ...c,
    id: `clip-${Date.now().toString(36)}-${uid}`,
    in: frozen ? c.in : still ? 0 : cutSource,
    out: frozen ? c.out : still ? len - local : c.out,
    hold: frozen ? len - local : c.hold,
    volume: secondVol.length ? secondVol : undefined,
    // Placement travels to both halves (independent copies), and an explicitly
    // pinned clip hands the second half the pin it now starts at — an implicitly
    // sequential one needs nothing, the layout keeps the halves back to back.
    transform: c.transform ? { ...c.transform } : undefined,
    crop: c.crop ? { ...c.crop } : undefined,
    baseStart: c.baseStart !== undefined ? c.baseStart + local : undefined,
    // The razor introduces a BRAND NEW boundary: it starts as a plain cut. (The
    // clip's incoming transition belongs to the boundary before it, which the
    // first half keeps.)
    transitionIn: undefined,
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
  const still = seed.kind !== 'video';
  const srcDuration = still ? IMAGE_CLIP_MAX : Math.max(MIN_CLIP_LEN, seed.srcDuration);
  const out = still ? 6 : srcDuration;
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

/** Default length of a freshly added blank clip (seconds). */
export const BLANK_CLIP_LEN = 2;

/**
 * A blank clip: no media, no dimensions, just a length. It has no srcId (there is
 * nothing to resolve) and no w/h, so it never sizes the output frame — see
 * `sizingClip`.
 */
export function createBlankClip(seconds = BLANK_CLIP_LEN, overrides: Partial<VideoClip> = {}): VideoClip {
  return createClip(
    { srcId: '', kind: 'blank', name: 'Blank', srcDuration: 0, w: 0, h: 0 },
    { out: Math.max(MIN_CLIP_LEN, seconds), ...overrides },
  );
}
