// ===== MP4 transcode via ffmpeg.wasm (single-threaded core, no SharedArrayBuffer) =====
//
// GitHub Pages can't set the COOP/COEP headers that SharedArrayBuffer (and thus
// the multi-threaded ffmpeg core) requires, so we use the single-threaded UMD
// core. It's slower but works anywhere. The ~30 MB core is fetched once from a
// pinned CDN and cached as blob URLs by the browser.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// @ffmpeg/ffmpeg spawns its worker as `type: "module"`, so the core must be the
// ESM build (loaded via dynamic import), not UMD. Pin to the version the package
// itself references to avoid API drift.
const CORE_VERSION = '0.12.9';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

/** Load (and cache) the ffmpeg core. Fetching the wasm is the slow first-time step. */
export async function ensureFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (!loadPromise) {
    loadPromise = (async () => {
      const instance = new FFmpeg();
      await instance.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpeg = instance;
      return instance;
    })();
  }
  return loadPromise;
}

export function isFFmpegLoaded(): boolean {
  return ffmpeg !== null;
}

/**
 * Transcode a recorded WebM blob to an H.264/AAC MP4 that uploads cleanly to
 * Shorts / Reels / TikTok. `onProgress` reports 0..1 during encoding.
 */
export async function transcodeToMp4(webm: Blob, onProgress?: (p: number) => void): Promise<Blob> {
  const ff = await ensureFFmpeg();

  const handler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress)));
  };
  ff.on('progress', handler);

  try {
    await ff.writeFile('input.webm', await fetchFile(webm));
    await ff.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '192k',
      'output.mp4',
    ]);
    const data = await ff.readFile('output.mp4');
    // data is a Uint8Array; wrap its buffer in the MP4 blob.
    const bytes = data as Uint8Array;
    return new Blob([bytes.slice().buffer], { type: 'video/mp4' });
  } finally {
    ff.off('progress', handler);
    try {
      await ff.deleteFile('input.webm');
      await ff.deleteFile('output.mp4');
    } catch {
      /* files may not exist if exec failed — ignore */
    }
  }
}
