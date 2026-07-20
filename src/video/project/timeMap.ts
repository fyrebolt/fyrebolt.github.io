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
import type { BannerLayer, Project } from './types';
import { bannerLayer, timeMachineLayer } from './types';
import { FREEZE_EPS, maxSpeedFrom, speedAt as trackSpeedAt } from '../timemachine/types';

const FLASH_SEC = 0.15; // white-flash decay at the lock

/** The banner freeze span in seconds, or null when there is no banner. */
export interface FreezeSpec {
  freeze: number;
  hold: number;
}

export function freezeSpecOf(banner: BannerLayer | null): FreezeSpec | null {
  if (!banner || banner.hold <= 0) return null;
  return { freeze: Math.max(0, banner.freeze), hold: Math.max(0, banner.hold) };
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
export function compileWarp(project: Project, clipDur: number): TimeWarp {
  const tm = timeMachineLayer(project);
  const kfs = tm ? tm.keyframes : [];
  const spec = freezeSpecOf(bannerLayer(project));
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
  let bannerPending = !!spec;
  let guard = 0;

  while (src < dur - 1e-6 && o < MAX_OUT && guard < 4_000_000) {
    guard += 1;
    // Banner freeze: when the clip reaches the freeze source, insert its hold.
    if (bannerPending && spec && src >= spec.freeze - 1e-6) {
      o += spec.hold;
      push(o, src, 0);
      bannerPending = false;
      continue;
    }
    const s = trackSpeedAt(o, kfs);
    if (s <= FREEZE_EPS) {
      // Frozen. If nothing ahead ever resumes, this is a permanent end-freeze.
      if (maxSpeedFrom(o, kfs) <= FREEZE_EPS) break;
      o += DT;
      push(o, src, 0);
      continue;
    }
    // Advance one step, capping it to land exactly on the freeze / clip end.
    let step = DT;
    if (bannerPending && spec) step = Math.min(step, Math.max(1e-6, (spec.freeze - src) / s));
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
