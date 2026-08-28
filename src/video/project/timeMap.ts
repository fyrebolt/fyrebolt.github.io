// ===== Unified time-warp between OUTPUT time and SOURCE (clip) time =====
//
// The whole editor runs on ONE output clock (seconds). Overlays (banner,
// captions, …) are authored in OUTPUT time; the SOURCE frame shown at a given
// output time depends on the project's time distortions. There are two, and
// they compose into ONE monotonic warp (see compileWarp):
//
//   1. Entrance Banner freeze — at the freeze source-second F the clip pauses
//      and the composite holds for `hold` output seconds, then resumes. This is
//      a speed-0 span inserted at F.
//   2. Time Machine speed track — a sequential speed-keyframe track (slow-mo
//      replays, fast-forward, and freezes). Speed s means the source advances s
//      seconds per output second. A freeze is just speed 0.
//
// dSource/dOutput = speed(output). Integrating speed over output time gives
// source(output); the clip ends (defines total output) when source reaches
// clipDur. With no distortions the warp is the identity and output = clip time.
//
// The SAME warp drives live preview AND export: because export is a real-time
// canvas re-capture, driving the <video> element's playbackRate / pause on this
// warp makes a slow-mo span genuinely occupy more wall-clock — and therefore
// more recorded frames — so the exported MP4 reflects the variable speed with
// no separate frame-timing pass. See project/Compositor.

import type { BannerFrame } from '../types';
import { POSITION_ANCHORS } from '../types';
import { easeInCubic, easeOutBack } from '../render';
import type { BannerLayer, Project, Span, TimeMachineLayer } from './types';
import { bannerLayers, timeMachineLayer } from './types';
import { FREEZE_EPS, NORMAL_SPEED, maxSpeedFrom, sortedSpeeds, speedAt as trackSpeedAt } from '../timemachine/types';

const FLASH_SEC = 0.15; // white-flash decay at the lock

/** The banner freeze span in seconds, or null when there is no banner. */
export interface FreezeSpec {
  freeze: number;
  hold: number;
}

function freezeSpecOf(banner: BannerLayer | null): FreezeSpec | null {
  if (!banner || banner.hold <= 0) return null;
  return { freeze: Math.max(0, banner.freeze), hold: Math.max(0, banner.hold) };
}

/** Every banner's freeze span, sorted by freeze source-second (holds skipped). */
function freezeSpecsOf(banners: BannerLayer[]): FreezeSpec[] {
  return banners
    .map((b) => freezeSpecOf(b))
    .filter((s): s is FreezeSpec => s !== null)
    .sort((a, b) => a.freeze - b.freeze);
}

// ---- compiled time-warp ----

/** A monotonic output→source mapping compiled from a project's distortions. */
export interface TimeWarp {
  /** Source clip length this warp was built for (seconds). */
  clipDur: number;
  /** Total OUTPUT duration: the output time at which source reaches clipDur. */
  totalOutput: number;
  /** SOURCE (clip) time shown at OUTPUT time `outputT`. */
  sourceAt(outputT: number): number;
  /** An OUTPUT time that shows SOURCE time `sourceT` (best-effort inverse). */
  outputAt(sourceT: number): number;
  /** Instantaneous playback speed at `outputT` (source seconds per output second). */
  speedAt(outputT: number): number;
  /** Whether the clip is frozen (paused) at `outputT`. */
  frozen(outputT: number): boolean;
}

/** Linear interpolation over a monotonic (xs, ys) breakpoint table. */
function interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  return span > 0 ? ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / span : ys[lo];
}

/**
 * Compile the project's banner freeze + Time Machine speed track into one
 * monotonic output→source warp. Sampled forward in output time and compacted so
 * constant-speed runs collapse to two breakpoints (ramps keep their curve).
 */
export function compileWarp(project: Project, clipDur: number, videoBase = true): TimeWarp {
  // Time Machine + banner freeze are video-only distortions: over a pure-image
  // base sequence the clock is the plain identity (base time === output time), so
  // an image sequence's total output is just its concatenated length. This keeps
  // a single-image project's output length unchanged (a banner never stretches it).
  const tm = videoBase ? timeMachineLayer(project) : null;
  const pts = tm ? tm.points : [];
  const specs = videoBase ? freezeSpecsOf(bannerLayers(project)) : [];
  const dur = Math.max(0, clipDur);

  const outs: number[] = [0];
  const srcs: number[] = [0];
  let lastSlope = Number.NaN;
  const push = (o: number, src: number, slope: number): void => {
    if (slope === lastSlope) {
      outs[outs.length - 1] = o;
      srcs[srcs.length - 1] = src;
    } else {
      outs.push(o);
      srcs.push(src);
      lastSlope = slope;
    }
  };

  const DT = 1 / 240;
  const MAX_OUT = 3600; // 1h hard cap (guards a trailing freeze with no resume)
  let o = 0;
  let src = 0;
  let bi = 0; // index of the next pending banner freeze (specs is sorted by freeze)
  let guard = 0;

  while (src < dur - 1e-6 && o < MAX_OUT && guard < 4_000_000) {
    guard += 1;
    // Banner freeze: when the clip reaches the next freeze source, insert its hold.
    if (bi < specs.length && src >= specs[bi].freeze - 1e-6) {
      o += specs[bi].hold;
      push(o, src, 0);
      bi += 1;
      continue;
    }
    let s = trackSpeedAt(o, pts);
    if (s <= FREEZE_EPS) {
      if (maxSpeedFrom(o, pts) > FREEZE_EPS) {
        // An ordinary freeze: hold here, something ahead resumes.
        o += DT;
        push(o, src, 0);
        continue;
      }
      // Nothing ahead ever resumes. The curve holds flat past its last point,
      // so a trailing 0 asks the clip to freeze for the rest of time — which
      // cannot be represented, and which this loop used to answer by stopping
      // dead. That silently TRUNCATED the timeline: a 30-second recording with
      // a stray 0 at 5s became a 4.9-second one, the remaining footage became
      // unreachable at any output time, and — because the preview loop restarts
      // when it reaches the end — the transport appeared to freeze and replay
      // the same fragment forever.
      //
      // A speed curve is an effect over the footage; it must never be able to
      // swallow it. So a freeze with no resume is not honoured as a freeze: the
      // remainder plays at normal speed, which keeps the one invariant that
      // matters — every source second has some output time that shows it.
      s = NORMAL_SPEED;
    }
    // Advance one step, capping it to land exactly on the freeze / clip end.
    let step = DT;
    if (bi < specs.length) step = Math.min(step, Math.max(1e-6, (specs[bi].freeze - src) / s));
    step = Math.min(step, Math.max(1e-6, (dur - src) / s));
    src += s * step;
    o += step;
    push(o, src, s);
  }

  const n = outs.length;
  if (n) srcs[n - 1] = Math.min(dur, srcs[n - 1]);
  const totalOutput = outs[n - 1] ?? 0;

  const slopeAt = (ot: number): number => {
    const m = outs.length;
    if (m < 2) return 1;
    if (ot >= outs[m - 1]) return 0;
    let lo = 0;
    let hi = m - 1;
    if (ot > outs[0]) {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (outs[mid] <= ot) lo = mid;
        else hi = mid;
      }
    } else {
      hi = 1;
    }
    const dout = outs[hi] - outs[lo];
    return dout > 0 ? (srcs[hi] - srcs[lo]) / dout : 0;
  };

  return {
    clipDur: dur,
    totalOutput,
    sourceAt: (ot) => interp(outs, srcs, ot),
    outputAt: (st) => interp(srcs, outs, st),
    speedAt: slopeAt,
    frozen: (ot) => slopeAt(ot) <= FREEZE_EPS,
  };
}

// ---- banner animation as a pure function of output time ----
//
// Kept pure so scrubbing and export are deterministic (the video-element pause
// that actually holds the frame is handled separately in the compositor clock).

/**
 * The BannerFrame (slide / alpha / flash / anchor) at output time `outputT`.
 * Sequence: off → slide-in (ease-out-back) → lock (flash) → hold → fling out
 * (ease-in) → off. Mirrors the classic BannerPlayer, but as a closed form.
 */
export function bannerFrameAt(banner: BannerLayer, outputT: number, t = 0): BannerFrame {
  const anchor = POSITION_ANCHORS[banner.position];
  const f = Math.max(0, banner.freeze);
  const slideIn = Math.max(0.001, banner.slideIn);
  const hold = Math.max(0, banner.hold);
  const fadeOut = Math.max(0.001, banner.fadeOut);
  const slideStart = f - slideIn;
  const lockEnd = f + hold;
  const outEnd = lockEnd + fadeOut;

  if (outputT < slideStart || outputT >= outEnd) {
    return { slide: outputT < slideStart ? 0 : 2, alpha: 0, flash: 0, anchor, t };
  }
  if (outputT < f) {
    // slide-in
    const p = (outputT - slideStart) / slideIn;
    return { slide: easeOutBack(Math.min(1, p)), alpha: 1, flash: 0, anchor, t };
  }
  if (outputT < lockEnd) {
    // hold (with a brief flash right at the lock)
    const flash = Math.max(0, 1 - (outputT - f) / FLASH_SEC);
    return { slide: 1, alpha: 1, flash, anchor, t };
  }
  // fling out
  const p = Math.min(1, (outputT - lockEnd) / fadeOut);
  return { slide: 1 + easeInCubic(p), alpha: 1, flash: 0, anchor, t };
}

/** Whether the lock instant (freeze) falls in [prevT, curT) — for firing the entrance SFX once. */
export function crossedLock(banner: BannerLayer, prevT: number, curT: number): boolean {
  return prevT < banner.freeze && curT >= banner.freeze;
}

// ---- banner ↔ banner ↔ Time Machine overlap guard ----
//
// A banner's freeze+hold and a non-1× Time Machine segment each PAUSE/WARP the
// one shared base clock. Two of them overlapping in time is undefined, so the
// editor keeps these windows disjoint: when a banner is placed/dragged/resized
// it is clamped against every OTHER banner's window and every Time Machine warp.

/** How far a speed may drift from 1× before a segment counts as a warp. */
const SPEED_OFF = 1e-3;

/** Merge a set of spans into sorted, non-overlapping intervals. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start + 1e-9).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.start <= prev.end + 1e-9) prev.end = Math.max(prev.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Output-second spans where the Time Machine speed curve is not ~1× (a warp). */
function timeMachineWarpSpans(tm: TimeMachineLayer | null): Span[] {
  if (!tm || tm.points.length === 0) return [];
  const pts = sortedSpeeds(tm.points);
  const off = (s: number): boolean => Math.abs(s - NORMAL_SPEED) > SPEED_OFF;
  // A lone control point holds flat across the WHOLE timeline.
  if (pts.length === 1) return off(pts[0].speed) ? [{ start: 0, end: Number.POSITIVE_INFINITY }] : [];
  const spans: Span[] = [];
  if (off(pts[0].speed)) spans.push({ start: 0, end: pts[0].t }); // head flat
  for (let i = 0; i < pts.length - 1; i++) {
    if (off(pts[i].speed) || off(pts[i + 1].speed)) spans.push({ start: pts[i].t, end: pts[i + 1].t });
  }
  const last = pts[pts.length - 1];
  if (off(last.speed)) spans.push({ start: last.t, end: Number.POSITIVE_INFINITY }); // tail flat
  return mergeSpans(spans);
}

/** The freeze+hold window [freeze, freeze+hold] of a banner, in timeline seconds. */
function bannerWindow(b: BannerLayer): Span {
  const freeze = Math.max(0, b.freeze);
  return { start: freeze, end: freeze + Math.max(0, b.hold) };
}

/**
 * Every timeline window a banner must stay clear of: each OTHER banner's
 * freeze+hold window plus each non-1× Time Machine segment. Merged + sorted.
 */
export function bannerBlockedSpans(project: Project, exceptBannerId?: string): Span[] {
  const windows = bannerLayers(project)
    .filter((b) => b.id !== exceptBannerId && b.hold > 0)
    .map(bannerWindow);
  const warps = timeMachineWarpSpans(timeMachineLayer(project));
  return mergeSpans([...windows, ...warps]);
}

export interface FreezeFit {
  freeze: number;
  /** True when the desired freeze had to move to avoid a conflict. */
  blocked: boolean;
}

/**
 * Clamp a banner freeze so its [freeze, freeze+hold] window stays clear of every
 * `blocked` span, keeping `hold` intact. Keeps the desired freeze when it is
 * already clear, else snaps to the nearest clear position.
 */
export function fitBannerFreeze(desiredFreeze: number, hold: number, blocked: Span[], maxFreeze: number): FreezeFit {
  const cap = Math.max(0, maxFreeze);
  const want = Math.min(Math.max(0, desiredFreeze), cap);
  const h = Math.max(0, hold);
  const merged = mergeSpans(blocked);
  // Freeze intervals where [f, f+h] is fully clear of every blocked span.
  const cands: Span[] = [];
  let cursor = 0;
  for (const b of merged) {
    const hi = Math.min(b.start - h, cap); // window must END by the blocker start
    if (hi >= cursor - 1e-9) cands.push({ start: cursor, end: hi });
    cursor = Math.max(cursor, b.end);
  }
  cands.push({ start: cursor, end: Math.max(cursor, cap) }); // tail — no blocker to the right
  const valid = cands.filter((c) => c.end >= c.start - 1e-9);
  if (valid.length === 0) return { freeze: want, blocked: false };
  for (const c of valid) if (want >= c.start - 1e-9 && want <= c.end + 1e-9) return { freeze: want, blocked: false };
  let best = valid[0].start;
  let bestD = Infinity;
  for (const c of valid) {
    const f = Math.min(Math.max(want, c.start), c.end);
    const d = Math.abs(f - want);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return { freeze: best, blocked: true };
}

export interface HoldFit {
  hold: number;
  /** True when the desired hold had to shrink to avoid a conflict. */
  blocked: boolean;
}

/**
 * Trim a banner hold so [freeze, freeze+hold] stays clear of `blocked`, keeping
 * the freeze fixed.
 */
export function fitBannerHold(freeze: number, desiredHold: number, blocked: Span[]): HoldFit {
  const f = Math.max(0, freeze);
  const want = Math.max(0, desiredHold);
  const merged = mergeSpans(blocked);
  let limit = Number.POSITIVE_INFINITY;
  for (const b of merged) {
    if (b.end <= f + 1e-9) continue; // entirely at/before the freeze
    if (b.start >= f - 1e-9) {
      limit = b.start - f; // next blocker to the right bounds the hold
      break;
    }
    limit = 0; // freeze sits inside a blocked span (shouldn't happen once placed)
    break;
  }
  const hold = Math.min(want, Math.max(0, limit));
  return { hold, blocked: hold < want - 1e-6 };
}
