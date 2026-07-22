// ===== Library preview thumbnails + content hashing =====
//
// Small, self-contained previews for asset-library entries, generated once from
// an uploaded blob: a downscaled frame for images, a grabbed frame for videos,
// and a drawn waveform (falling back to a note icon) for audio. Everything is
// emitted as a compact JPEG data URL so it can live inside the IndexedDB entry
// next to the original bytes.
//
// `hashBlob` gives each upload a stable content fingerprint so re-uploading the
// same file in a later project doesn't pile up duplicate library entries.

import type { LibraryMedia } from './persist';

/** Longest edge of a generated thumbnail, in pixels. */
const THUMB_MAX = 200;
const JPEG_QUALITY = 0.72;

/** Fit (w,h) into a THUMB_MAX box, preserving aspect (never upscales past src). */
function thumbSize(w: number, h: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: THUMB_MAX, h: THUMB_MAX };
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** SHA-256 hex of a blob's bytes — a stable content fingerprint for dedupe. */
export async function hashBlob(blob: Blob): Promise<string> {
  try {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Subtle crypto unavailable (very old / insecure context) — fall back to a
    // cheap size+type key. Weaker, but only used to avoid obvious duplicates.
    return `sz-${blob.size}-${blob.type}`;
  }
}

function makeImageThumb(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const { w, h } = thumbSize(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch {
        resolve('');
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
}

function makeVideoThumb(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const finish = (data: string) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(data);
    };
    const grab = () => {
      try {
        const { w, h } = thumbSize(v.videoWidth, v.videoHeight);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(v, 0, 0, w, h);
        finish(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch {
        finish('');
      }
    };
    v.addEventListener('loadeddata', () => {
      // Seek a hair in so the very first (often black) frame isn't captured.
      const target = Math.min(0.1, (v.duration || 0) / 2);
      if (target > 0 && Number.isFinite(v.duration)) {
        v.addEventListener('seeked', grab, { once: true });
        try {
          v.currentTime = target;
        } catch {
          grab();
        }
      } else {
        grab();
      }
    });
    v.addEventListener('error', () => finish(''));
    // Safety net: don't hang forever on a codec the browser can decode but not seek.
    setTimeout(() => finish(''), 4000);
  });
}

/** Decode audio → normalised mono peaks, or null when it can't be decoded. */
async function audioPeaks(blob: Blob, buckets: number): Promise<Float32Array | null> {
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
    const peaks = new Float32Array(buckets);
    const per = Math.max(1, Math.floor(ch.length / buckets));
    let max = 1e-6;
    for (let i = 0; i < buckets; i++) {
      let m = 0;
      const s = i * per;
      const e = Math.min(ch.length, s + per);
      for (let j = s; j < e; j++) {
        const a = Math.abs(ch[j]);
        if (a > m) m = a;
      }
      peaks[i] = m;
      if (m > max) max = m;
    }
    for (let i = 0; i < buckets; i++) peaks[i] /= max;
    return peaks;
  } catch {
    return null;
  }
}

/** A note-glyph fallback used when audio can't be decoded to a waveform. */
function audioIconThumb(): string {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_MAX;
  canvas.height = Math.round(THUMB_MAX * 0.6);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1b2233';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#8be9c7';
    ctx.font = `${Math.round(canvas.height * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎵', canvas.width / 2, canvas.height / 2);
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

async function makeAudioThumb(blob: Blob): Promise<string> {
  const W = THUMB_MAX;
  const H = Math.round(THUMB_MAX * 0.6);
  const cols = 56;
  const peaks = await audioPeaks(blob, cols);
  if (!peaks) return audioIconThumb();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return audioIconThumb();
  ctx.fillStyle = '#1b2233';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#8be9c7';
  const mid = H / 2;
  const gap = 1;
  const bw = W / cols;
  for (let i = 0; i < cols; i++) {
    const amp = Math.max(0.03, peaks[i]) * (mid - 2);
    ctx.fillRect(i * bw + gap / 2, mid - amp, Math.max(1, bw - gap), amp * 2);
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** Build a preview data URL for a library blob of the given media kind. */
export async function makeThumb(media: LibraryMedia, blob: Blob): Promise<string> {
  if (media === 'image') return makeImageThumb(blob);
  if (media === 'video') return makeVideoThumb(blob);
  return makeAudioThumb(blob);
}
