// ===== Freeze-aware time mapping between OUTPUT time and SOURCE time =====
//
// The whole editor runs on ONE output clock (seconds). Overlays (banner, captions
// etc.) are authored in OUTPUT time; the SOURCE frame shown at a given output
// time depends on whether a banner freeze is active.
//
// A banner freezes the clip: at the freeze point F (source seconds) the clip
// pauses, the composite holds on that frame for `hold` seconds, then the clip
// resumes. So an extra `hold` seconds are inserted into the output timeline:
//
//   output:  0 ........ F |==== hold ====| ........ clipDur+hold
//   source:  0 ........ F  F  (frozen)  F  ........ clipDur
//
// With no banner the mapping is the identity and output duration = clip duration.

import type { BannerFrame } from '../types';
import { POSITION_ANCHORS } from '../types';
import { easeInCubic, easeOutBack } from '../render';
import type { BannerLayer } from './types';

const FLASH_SEC = 0.15; // white-flash decay at the lock

/** The freeze span in seconds, or null when there is no banner. */
export interface FreezeSpec {
  freeze: number;
  hold: number;
}

export function freezeSpecOf(banner: BannerLayer | null): FreezeSpec | null {
  if (!banner || banner.hold <= 0) return null;
  return { freeze: Math.max(0, banner.freeze), hold: Math.max(0, banner.hold) };
}

/** Source (clip) time for a given output time, accounting for the frozen hold. */
export function sourceTimeAt(outputT: number, spec: FreezeSpec | null): number {
  if (!spec) return outputT;
  const { freeze: f, hold: h } = spec;
  if (outputT <= f) return outputT;
  if (outputT < f + h) return f; // frozen
  return outputT - h;
}

/** Output time for a given source time (before the hold; used to place markers). */
export function sourceToOutput(sourceT: number, spec: FreezeSpec | null): number {
  if (!spec) return sourceT;
  return sourceT <= spec.freeze ? sourceT : sourceT + spec.hold;
}

/** Total OUTPUT duration for a video clip of `clipDur` seconds under `spec`. */
export function outputDurationFor(clipDur: number, spec: FreezeSpec | null): number {
  return clipDur + (spec ? spec.hold : 0);
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
