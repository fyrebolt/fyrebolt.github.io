// ===== Video -> GIF, entirely in the browser =====
//
// Two passes, which is the whole reason the output looks like the source:
// GIF has 256 colours, so the only question that matters is *which* 256. A
// one-pass conversion takes ffmpeg's fixed web palette and everything with a
// gradient in it bands badly. So pass one reads the clip and generates a
// palette fitted to that clip, and pass two re-reads it and maps onto that.
//
// The passes are run as two separate `exec`s rather than one `split` filter
// graph on purpose: `split` has to buffer every decoded frame until the
// palette exists, which on a long or large clip exhausts the wasm heap.
// Reading the input twice is slower and always finishes.

import { fetchFile } from '@ffmpeg/util';
import { ensureFFmpeg } from '../video/ffmpeg';
import { palettegenArgs, paletteuseArgs, type GifOptions } from './options';
import { overallProgress, scratchName } from './files';

export interface ConvertHandle {
  /** 0..1 across both passes. */
  onProgress?: (p: number) => void;
  /** Latest line of ffmpeg's log, for the "what is it doing" readout. */
  onLog?: (line: string) => void;
}

/**
 * Convert one file to a GIF. Rejects with a readable message if ffmpeg can't
 * decode the input — which is the expected outcome for, say, a PDF, and worth
 * saying plainly rather than surfacing an exit code.
 */
export async function convertToGif(
  file: File,
  options: GifOptions,
  id: number,
  handle: ConvertHandle = {},
): Promise<Blob> {
  const ff = await ensureFFmpeg();

  const input = scratchName(file.name, id);
  const palette = `palette-${id}.png`;
  const output = `out-${id}.gif`;

  let pass: 'palette' | 'encode' = 'palette';
  const onProgress = ({ progress }: { progress: number }) => {
    handle.onProgress?.(overallProgress(pass, progress));
  };
  const onLog = ({ message }: { message: string }) => handle.onLog?.(message);

  ff.on('progress', onProgress);
  ff.on('log', onLog);

  try {
    await ff.writeFile(input, await fetchFile(file));

    pass = 'palette';
    handle.onProgress?.(0);
    await run(ff, palettegenArgs(input, palette, options), file.name);

    pass = 'encode';
    handle.onProgress?.(overallProgress('encode', 0));
    await run(ff, paletteuseArgs(input, palette, output, options), file.name);

    const data = (await ff.readFile(output)) as Uint8Array;
    if (!data.length) throw new Error(`Nothing came out of “${file.name}”.`);
    handle.onProgress?.(1);
    // Copy out of the wasm heap: the underlying buffer is reused by the next
    // conversion, so a Blob over the live view would decode as garbage later.
    return new Blob([data.slice().buffer], { type: 'image/gif' });
  } finally {
    ff.off('progress', onProgress);
    ff.off('log', onLog);
    for (const name of [input, palette, output]) {
      try {
        await ff.deleteFile(name);
      } catch {
        /* a pass that failed leaves its output missing — nothing to clean up */
      }
    }
  }
}

/** Run one ffmpeg pass, turning a non-zero exit into a message worth reading. */
async function run(
  ff: Awaited<ReturnType<typeof ensureFFmpeg>>,
  args: string[],
  displayName: string,
): Promise<void> {
  const code = await ff.exec(args);
  if (code !== 0) {
    throw new Error(
      `Couldn’t read “${displayName}”. It may not be a video, or it may use a codec ffmpeg can’t decode.`,
    );
  }
}
