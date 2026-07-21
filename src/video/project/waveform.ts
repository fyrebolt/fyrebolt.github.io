// ===== Clip audio waveform (decoded once, cached per source) =====
//
// Pairs with the clip volume-automation curve: drawing a volume curve is much
// easier over the actual audio. We decode each clip's ORIGINAL source blob to
// mono peaks ONCE (keyed by srcId) and cache the promise, so reselecting or
// re-rendering never re-decodes. Peaks span the FULL source (0..srcDuration);
// callers reslice them for a clip's trimmed [in, out] window.

export interface Waveform {
  /** Max-magnitude peak per bucket over the whole source, in [0, 1]. */
  peaks: Float32Array;
  /** Decoded source duration (seconds). */
  duration: number;
}

/** Bucket count — enough detail for a timeline lane without huge arrays. */
const BUCKETS = 1200;

const cache = new Map<string, Promise<Waveform | null>>();

async function decode(blob: Blob): Promise<Waveform | null> {
  try {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const buf = await blob.arrayBuffer();
    const ctx = new AC();
    let audio: AudioBuffer;
    try {
      audio = await ctx.decodeAudioData(buf.slice(0));
    } finally {
      ctx.close().catch(() => {});
    }
    const ch = audio.getChannelData(0);
    const peaks = new Float32Array(BUCKETS);
    const per = Math.max(1, Math.floor(ch.length / BUCKETS));
    let max = 1e-6;
    for (let i = 0; i < BUCKETS; i++) {
      let m = 0;
      const s = i * per;
      const e = Math.min(ch.length, s + per);
      for (let j = s; j < e; j++) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
      peaks[i] = m;
      if (m > max) max = m;
    }
    // Normalise so quiet clips still show a readable shape.
    for (let i = 0; i < BUCKETS; i++) peaks[i] /= max;
    return { peaks, duration: audio.duration };
  } catch {
    // No audio track, unsupported codec, or decode failure — no waveform.
    return null;
  }
}

/** Decode + cache the waveform for a clip source. Safe to call repeatedly. */
export function getWaveform(srcId: string, blob: Blob): Promise<Waveform | null> {
  const hit = cache.get(srcId);
  if (hit) return hit;
  const p = decode(blob);
  cache.set(srcId, p);
  return p;
}

/** Drop a cached waveform (e.g. when its clip is removed). */
export function forgetWaveform(srcId: string): void {
  cache.delete(srcId);
}

/**
 * Build an SVG polygon `points` string for the waveform over a clip's trimmed
 * window [inFrac, outFrac] of the source, mapped into a box of `width`×`height`
 * (mirrored about the vertical centre). Returns '' when there is nothing to draw.
 */
export function waveformPolygon(
  wf: Waveform,
  inFrac: number,
  outFrac: number,
  width: number,
  height: number,
): string {
  const n = wf.peaks.length;
  if (n === 0 || width <= 0 || height <= 0) return '';
  const a = Math.max(0, Math.min(1, inFrac));
  const b = Math.max(a, Math.min(1, outFrac));
  const mid = height / 2;
  const cols = Math.max(2, Math.min(Math.round(width), 400));
  const top: string[] = [];
  const bot: string[] = [];
  for (let c = 0; c < cols; c++) {
    const f = c / (cols - 1);
    const srcFrac = a + (b - a) * f;
    const idx = Math.max(0, Math.min(n - 1, Math.round(srcFrac * (n - 1))));
    const amp = wf.peaks[idx] * mid;
    const px = (f * width).toFixed(1);
    top.push(`${px},${(mid - amp).toFixed(1)}`);
    bot.push(`${px},${(mid + amp).toFixed(1)}`);
  }
  return [...top, ...bot.reverse()].join(' ');
}
