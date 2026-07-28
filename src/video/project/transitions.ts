// ===== Clip-boundary transitions =====
//
// A transition is attached to the INCOMING clip (`VideoClip.transitionIn`), so it
// travels with that clip through reorders, duplicates and splits exactly like the
// clip's own trim / grade / volume curve. The first clip's `transitionIn` is
// ignored — there is no boundary before it.
//
// TIMING — the window STRADDLES the cut and never changes the timeline length.
// A transition of duration D at boundary base-time B occupies [B - D/2, B + D/2].
// baseDuration() is untouched, so every overlay (captions, banners, zoom, Time
// Machine) keeps its authored OUTPUT timing no matter what transitions are set.
// The consequence is that each side reaches BEYOND its own trim during the
// window:
//
//   outgoing sourceT = prev.in + (t - prevStart)   → runs past prev.out
//   incoming sourceT = next.in + (t - B)           → runs before next.in
//
// i.e. the transition consumes the frames the trim handles threw away. When a
// trim sits at the very edge of the media there is nothing left to consume, so
// that side clamps and holds a freeze-frame — which still reads correctly for
// every effect here.
//
// All eight kinds are pure canvas compositing (plus one half-resolution
// getImageData pass for `glitch`); no external image/video/audio assets.

import type { VideoClip } from './clips';
import { clipLen, clipStartAt, isPlainClip, layoutClips } from './clips';

export type TransitionKind =
  | 'cut'
  | 'crossfade'
  | 'wipe'
  | 'push'
  | 'iris'
  | 'zoom'
  | 'glitch'
  | 'flash';

/** Sweep direction for `wipe` / `push`. */
export type TransitionDir = 'left' | 'right' | 'up' | 'down';

export interface Transition {
  kind: TransitionKind;
  /** TOTAL window length in seconds (D/2 either side of the cut). */
  duration: number;
  /** wipe / push sweep direction. Absent == 'left'. */
  dir?: TransitionDir;
  /** iris: expanding circle ('in') or contracting one ('out'). Absent == 'in'. */
  iris?: 'in' | 'out';
  /** flash colour. Absent == 'white'. */
  flash?: 'white' | 'black';
  /** Fire the procedural whoosh / zap cue at the cut. Absent == off. */
  sfx?: boolean;
}

const DEFAULT_TRANSITION_DUR = 0.5;
export const MIN_TRANSITION_DUR = 0.1;
const MAX_TRANSITION_DUR = 2;

/** The default a boundary has until it is edited: today's hard cut. */
const CUT: Transition = { kind: 'cut', duration: 0 };

/** Kinds that show BOTH clips at once (need a real overlap + an audio crossfade). */
const OVERLAPPING: ReadonlySet<TransitionKind> = new Set<TransitionKind>([
  'crossfade',
  'wipe',
  'push',
  'iris',
  'zoom',
  'glitch',
]);

export function isOverlapping(kind: TransitionKind): boolean {
  return OVERLAPPING.has(kind);
}

/** Kinds that occupy a window at all (everything except the instant cut). */
function hasWindow(tr: Transition): boolean {
  return tr.kind !== 'cut' && tr.duration > 1e-3;
}

export interface TransitionOption {
  kind: TransitionKind;
  label: string;
  glyph: string;
  hint: string;
}

/** Pickable kinds, in UI order. */
export const TRANSITION_OPTIONS: TransitionOption[] = [
  { kind: 'cut', label: 'Cut', glyph: '│', hint: 'Instant, no overlap' },
  { kind: 'crossfade', label: 'Crossfade', glyph: '◑', hint: 'Alpha dissolve' },
  { kind: 'wipe', label: 'Wipe', glyph: '▤', hint: 'Hard-edged sweep' },
  { kind: 'push', label: 'Push', glyph: '⇥', hint: 'Both frames slide' },
  { kind: 'iris', label: 'Iris', glyph: '◎', hint: 'Circle reveal' },
  { kind: 'zoom', label: 'Zoom', glyph: '⤢', hint: 'Blur-through punch' },
  { kind: 'glitch', label: 'Glitch', glyph: '⌁', hint: 'RGB split + noise' },
  { kind: 'flash', label: 'Flash', glyph: '✦', hint: 'Blink to white' },
];

export const DIR_OPTIONS: { key: TransitionDir; label: string }[] = [
  { key: 'left', label: '←' },
  { key: 'right', label: '→' },
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
];

/** The glyph shown on a boundary chip. */
export function glyphOf(kind: TransitionKind): string {
  return TRANSITION_OPTIONS.find((o) => o.kind === kind)?.glyph ?? '│';
}

export function labelOf(kind: TransitionKind): string {
  return TRANSITION_OPTIONS.find((o) => o.kind === kind)?.label ?? 'Cut';
}

/** The transition entering clip `index`, normalised (never null; boundary 0 is a cut). */
export function transitionAt(clips: VideoClip[], index: number): Transition {
  if (index <= 0 || index >= clips.length) return CUT;
  const tr = clips[index].transitionIn;
  if (!tr || tr.kind === 'cut') return CUT;
  return { ...tr, duration: clampDuration(clips, index, tr.duration) };
}

/**
 * Longest window boundary `index` can carry: it may never eat more than half of
 * either neighbouring clip, so a transition can't swallow a whole clip or reach
 * across into the boundary next door.
 */
export function maxDurationAt(clips: VideoClip[], index: number): number {
  if (index <= 0 || index >= clips.length) return 0;
  const room = Math.min(clipLen(clips[index - 1]), clipLen(clips[index]));
  return Math.max(MIN_TRANSITION_DUR, Math.min(MAX_TRANSITION_DUR, room));
}

export function clampDuration(clips: VideoClip[], index: number, dur: number): number {
  if (!isFinite(dur)) return DEFAULT_TRANSITION_DUR;
  return Math.max(MIN_TRANSITION_DUR, Math.min(maxDurationAt(clips, index), dur));
}

/** The base-time window of boundary `index`, or null when it is a plain cut. */
export interface TransitionWindow {
  index: number;
  tr: Transition;
  /** Base time of the cut itself. */
  cut: number;
  start: number;
  end: number;
}

/**
 * Whether boundary `index` is a real SEQUENCE EDGE — the only situation a
 * transition applies to. Two conditions, both required:
 *
 *   1. the two clips are butt-joined in base time (clip `index` starts exactly
 *      where clip `index - 1` ends), i.e. the overlap comes from the boundary's
 *      own transition window and not from clips deliberately given overlapping
 *      time ranges, and
 *   2. both are still PLAIN — full-frame and uncropped.
 *
 * Every other kind of overlap (a clip resized into a corner while another plays
 * behind it, two clips parked over each other) is ordinary z-ordered
 * compositing: each clip is simply drawn in its own rectangle, never blended.
 * Gating it here means one check governs the renderer, the audio graph, the SFX
 * cues and the timeline at once.
 */
export function isSequenceEdge(clips: VideoClip[], index: number): boolean {
  if (index <= 0 || index >= clips.length) return false;
  if (!isPlainClip(clips[index - 1]) || !isPlainClip(clips[index])) return false;
  const lay = layoutClips(clips);
  return Math.abs(lay[index].start - lay[index - 1].end) < 1e-3;
}

export function windowAt(clips: VideoClip[], index: number): TransitionWindow | null {
  const tr = transitionAt(clips, index);
  if (!hasWindow(tr)) return null;
  if (!isSequenceEdge(clips, index)) return null;
  const cut = clipStartAt(clips, index);
  const half = tr.duration / 2;
  return { index, tr, cut, start: cut - half, end: cut + half };
}

/** Every boundary window in the sequence (ordered). */
export function allWindows(clips: VideoClip[]): TransitionWindow[] {
  const out: TransitionWindow[] = [];
  for (let i = 1; i < clips.length; i++) {
    const w = windowAt(clips, i);
    if (w) out.push(w);
  }
  return out;
}

export interface ActiveTransition extends TransitionWindow {
  /** 0 at the window start (all outgoing) → 1 at the end (all incoming). */
  progress: number;
  outgoing: VideoClip;
  incoming: VideoClip;
  outgoingIndex: number;
  incomingIndex: number;
  /** SOURCE second to show for each side at this instant (already clamped). */
  outgoingSourceT: number;
  incomingSourceT: number;
  /** Both sides resolve to ONE media element — see Compositor's freeze-frame path. */
  sameSource: boolean;
}

/** The transition covering base time `baseT`, or null. Windows never overlap. */
export function activeTransitionAt(clips: VideoClip[], baseT: number): ActiveTransition | null {
  for (let i = 1; i < clips.length; i++) {
    const w = windowAt(clips, i);
    if (!w) continue;
    if (baseT < w.start || baseT >= w.end) continue;
    const prev = clips[i - 1];
    const next = clips[i];
    const progress = Math.max(0, Math.min(1, (baseT - w.start) / (w.end - w.start)));
    // Each side reaches past its own trim into the frames the trim discarded,
    // clamping (freeze-frame) when the media runs out.
    const outLocal = baseT - clipStartAt(clips, i - 1);
    const outSrc = clamp(prev.in + outLocal, 0, Math.max(0, prev.srcDuration - 0.03));
    const inSrc = clamp(next.in + (baseT - w.cut), 0, Math.max(0, next.srcDuration - 0.03));
    return {
      ...w,
      progress,
      outgoing: prev,
      incoming: next,
      outgoingIndex: i - 1,
      incomingIndex: i,
      outgoingSourceT: outSrc,
      incomingSourceT: inSrc,
      sameSource: prev.srcId === next.srcId,
    };
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---- audio ----

/**
 * Equal-power gain pair for the two sides at `progress`. Constant perceived
 * loudness across the window (a linear pair dips audibly in the middle).
 */
export function crossfadeGains(progress: number): { out: number; in: number } {
  const p = Math.max(0, Math.min(1, progress));
  return { out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) };
}

/**
 * Gain envelope for a NON-overlapping boundary (cut / flash) and for the single
 * shared element of a same-source boundary: duck to silence at the cut and back
 * up, so the splice never clicks. Returns a multiplier for whichever side is
 * currently audible.
 */
export function duckGain(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return Math.abs(Math.cos(p * Math.PI)) ** 0.5;
}

// ---- randomise ----

const RANDOM_KINDS: TransitionKind[] = [
  'crossfade',
  'wipe',
  'push',
  'iris',
  'zoom',
  'glitch',
  'flash',
];
const RANDOM_DIRS: TransitionDir[] = ['left', 'right', 'up', 'down'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** A fresh random transition for boundary `index` (never a cut). */
function randomTransition(clips: VideoClip[], index: number): Transition {
  const kind = pick(RANDOM_KINDS);
  const dur = clampDuration(clips, index, 0.3 + Math.random() * 0.5);
  const tr: Transition = { kind, duration: dur };
  if (kind === 'wipe' || kind === 'push') tr.dir = pick(RANDOM_DIRS);
  if (kind === 'iris') tr.iris = Math.random() < 0.5 ? 'in' : 'out';
  if (kind === 'flash') tr.flash = Math.random() < 0.75 ? 'white' : 'black';
  if (kind === 'glitch' || kind === 'flash' || kind === 'push') tr.sfx = Math.random() < 0.6;
  return tr;
}

/** Every boundary re-rolled at once (clip 0 keeps no transition). */
export function randomizeAll(clips: VideoClip[]): VideoClip[] {
  return clips.map((c, i) => (i === 0 ? { ...c, transitionIn: undefined } : { ...c, transitionIn: randomTransition(clips, i) }));
}

/** A sensible starting transition when a boundary is switched off `cut`. */
export function defaultFor(kind: TransitionKind, clips: VideoClip[], index: number): Transition {
  const tr: Transition = { kind, duration: clampDuration(clips, index, DEFAULT_TRANSITION_DUR) };
  if (kind === 'wipe' || kind === 'push') tr.dir = 'left';
  if (kind === 'iris') tr.iris = 'in';
  if (kind === 'flash') {
    tr.flash = 'white';
    tr.duration = clampDuration(clips, index, 0.28); // a flash wants to be quick
  }
  if (kind === 'glitch') tr.duration = clampDuration(clips, index, 0.36);
  return tr;
}
