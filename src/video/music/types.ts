// ===== Background music: an independent audio track on the output clock =====
//
// A music element brings in an uploaded audio file (mp3/wav/…) as its OWN track,
// independent of any clip's embedded audio, sfx, or sticker audio. Unlike the
// base clips it lives in OUTPUT time and is NOT subject to the time-warp (Time
// Machine / banner freeze) — speeding up or slowing down the video never speeds
// up or slows down the music, exactly how a real editor treats a separate audio
// track.
//
// The decoded HTMLAudioElement lives OUTSIDE this plain-data model in a media
// registry keyed by `srcId`, mirroring how clips + stickers keep their media
// out of the serialisable project (so undo/redo snapshots stay cheap).
//
// Trim (`in`/`out`) selects a segment of the source; `start`/`dur` place it on
// the OUTPUT timeline. If `dur` outlasts the trimmed segment and `loop` is set,
// the segment repeats to fill; otherwise the tail past the segment is silent.
// Fades reuse the exact VolumePoint curve + mute from clips.ts — the curve time
// `t` is PLACEMENT-LOCAL output seconds (0 .. dur), the natural analogue of the
// clip curve's clip-local basis.

import type { VolumePoint } from '../project/clips';
import { MIN_CLIP_LEN } from '../project/clips';

export interface MusicElement {
  id: string;
  /** Registry key for the decoded HTMLAudioElement (kept out of the project). */
  srcId: string;
  /** File name, shown on the track. */
  name: string;
  /** Natural source length in seconds. */
  srcDuration: number;
  /** Trim in/out within the SOURCE file (seconds). Segment length = out - in. */
  in: number;
  out: number;
  /** Placement start on the OUTPUT timeline (seconds). */
  start: number;
  /** How long the track occupies the OUTPUT timeline after `start` (seconds). */
  dur: number;
  /** Repeat the [in, out] segment to fill `dur` when dur > segment length. */
  loop: boolean;
  /** Volume-automation curve, PLACEMENT-LOCAL output seconds (0..dur). Reuses the
   *  clip VolumePoint system; absent/empty == flat 100%. */
  volume?: VolumePoint[];
  /** Silence the track entirely (curve preserved for a lossless un-mute). */
  muted?: boolean;
}

/** Trimmed source-segment length in seconds. */
export function segLen(el: MusicElement): number {
  return Math.max(MIN_CLIP_LEN, el.out - el.in);
}

/** End of the track on the OUTPUT timeline (start + dur). */
export function elementEnd(el: MusicElement): number {
  return el.start + Math.max(0, el.dur);
}

/**
 * SOURCE time to play at placement-local output time `local` (0 .. dur), or null
 * when nothing should sound there (past the segment with looping off). Looping
 * wraps within [in, out]; otherwise it clamps and then goes silent past the end.
 */
export function musicSourceAt(el: MusicElement, local: number): number | null {
  if (local < 0) return null;
  const len = segLen(el);
  if (el.loop) return el.in + (local % len);
  if (local >= len) return null; // one-shot finished — silent tail
  return el.in + local;
}

export interface MusicSeed {
  srcId: string;
  name: string;
  srcDuration: number;
}

let uid = 0;
function id(): string {
  uid += 1;
  return `mus-${Date.now().toString(36)}-${uid}`;
}

/** New music element: whole file, placed at `start`, no loop. */
export function createMusic(seed: MusicSeed, start = 0): MusicElement {
  const srcDuration = Math.max(MIN_CLIP_LEN, seed.srcDuration);
  return {
    id: id(),
    srcId: seed.srcId,
    name: seed.name,
    srcDuration,
    in: 0,
    out: srcDuration,
    start: Math.max(0, start),
    dur: srcDuration,
    loop: false,
    muted: false,
  };
}
