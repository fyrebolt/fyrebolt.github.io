// ===== Shared option lists + small helpers for the editor's controls =====

import type { FillMode, RatioKey } from '../types';

/** Round to 2dp — the editor's standard precision for seconds shown in a field. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Format seconds as the transport's `m:ss`.
 *
 * The millisecond rounding is not cosmetic fussiness. The time-warp integrates
 * the output clock in 1/240 steps (see project/timeMap.ts), so a timeline that
 * is exactly N seconds long arrives here as N − 1e-13. Flooring that reports a
 * two-second hold as `0:01` and an eight-second clip as `0:07` — the error is
 * invisible everywhere except the one place it is displayed. Landing on the
 * nearest millisecond first costs nothing and is right in both directions: a
 * genuine 3.99s still reads `0:03`.
 */
export function clockTime(sec: number): string {
  const t = isFinite(sec) && sec > 0 ? Math.round(sec * 1000) / 1000 : 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Editing/timeline frame rate — the granularity of keyboard frame-stepping
 * (Left/Right arrow moves the playhead by 1/TIMELINE_FPS seconds). This is the
 * authoring cadence, distinct from the compositor's 60 fps CAPTURE rate: it
 * matches typical source footage so a single step lands on a source frame.
 */
const TIMELINE_FPS = 30;
/** One editing frame, in seconds. */
export const FRAME_SEC = 1 / TIMELINE_FPS;

export const RATIO_LABELS: { key: RatioKey; label: string; hint: string }[] = [
  { key: '9:16', label: '9:16', hint: 'Shorts / Reels' },
  { key: '1:1', label: '1:1', hint: 'Square' },
  { key: '4:5', label: '4:5', hint: 'Portrait' },
  { key: 'original', label: 'Original', hint: 'No convert' },
];

export const FILL_MODES: FillMode[] = ['crop', 'fit', 'blur'];
