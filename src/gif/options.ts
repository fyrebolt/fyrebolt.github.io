// ===== GIF conversion options and the ffmpeg filter graphs they produce =====
//
// This is the part of the converter worth testing on its own: everything about
// *what* ffmpeg is asked to do, with none of the wasm around it. The app hands
// these strings straight to ffmpeg.wasm, so a mistake here is a mistake in the
// output — and a filter graph is much easier to assert on than a GIF.

/** Keep the source's own value rather than forcing one. */
export const SOURCE = 'source';
export type Source = typeof SOURCE;

export interface GifOptions {
  /** Frame rate, or the source's own. */
  fps: number | Source;
  /** Cap on output width, or the source's own. Never upscales. */
  width: number | Source;
  /** Error-diffusion algorithm used to fit the frame to 256 colours. */
  dither: 'sierra2_4a' | 'floyd_steinberg' | 'bayer' | 'none';
}

/** Full quality: the source's own frame rate and size, best-looking dither. */
export const DEFAULT_OPTIONS: GifOptions = {
  fps: SOURCE,
  width: SOURCE,
  dither: 'sierra2_4a',
};

export const FPS_CHOICES: Array<{ value: number | Source; label: string }> = [
  { value: SOURCE, label: 'Original' },
  { value: 30, label: '30' },
  { value: 24, label: '24' },
  { value: 15, label: '15' },
  { value: 12, label: '12' },
];

export const WIDTH_CHOICES: Array<{ value: number | Source; label: string }> = [
  { value: SOURCE, label: 'Original' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 320, label: '320p' },
];

export const DITHER_CHOICES: Array<{ value: GifOptions['dither']; label: string }> = [
  { value: 'sierra2_4a', label: 'Best' },
  { value: 'floyd_steinberg', label: 'Smooth' },
  { value: 'bayer', label: 'Small' },
  { value: 'none', label: 'Flat' },
];

/**
 * The filters both passes share: rate, then size. Order matters — dropping
 * frames before scaling means the expensive lanczos resample runs on fewer
 * frames.
 *
 * The width is applied as `min(iw, W)` so a target wider than the source is a
 * no-op instead of an upscale: blowing a 480p clip up to 1080p would cost a
 * great deal of file size and add no detail at all. `-1` keeps the aspect
 * ratio, and `force_divisible_by=2` keeps that rounding from ever landing on
 * a zero-height frame for very wide, very short inputs.
 */
export function commonFilters(o: GifOptions): string {
  const parts: string[] = [];
  if (o.fps !== SOURCE) parts.push(`fps=${o.fps}`);
  if (o.width !== SOURCE) {
    parts.push(`scale=w='min(iw,${o.width})':h=-1:force_divisible_by=2:flags=lanczos`);
  }
  return parts.join(',');
}

/** Join a filter chain onto the shared filters, skipping the comma when empty. */
const chain = (common: string, tail: string) => (common ? `${common},${tail}` : tail);

/**
 * Pass one: look at the whole clip and pick the 256 colours that represent it
 * best. `stats_mode=diff` weights the palette toward the parts of the frame
 * that actually move, which is where banding is visible on a video.
 */
export function palettegenFilter(o: GifOptions): string {
  return chain(commonFilters(o), 'palettegen=max_colors=256:stats_mode=diff');
}

/**
 * Pass two: re-read the clip and map it onto that palette.
 * `diff_mode=rectangle` restricts each frame to the rectangle that changed,
 * which is what keeps a GIF of mostly-static footage from being enormous.
 */
export function paletteuseFilter(o: GifOptions): string {
  const use = `paletteuse=dither=${o.dither}:diff_mode=rectangle`;
  const common = commonFilters(o);
  return common ? `[0:v]${common}[v];[v][1:v]${use}` : `[0:v][1:v]${use}`;
}

/** Full argv for the palette pass. */
export function palettegenArgs(input: string, palette: string, o: GifOptions): string[] {
  return ['-i', input, '-vf', palettegenFilter(o), '-y', palette];
}

/** Full argv for the encode pass. `-loop 0` is GIF for "repeat forever". */
export function paletteuseArgs(
  input: string,
  palette: string,
  output: string,
  o: GifOptions,
): string[] {
  return [
    '-i', input,
    '-i', palette,
    '-filter_complex', paletteuseFilter(o),
    '-an',
    '-loop', '0',
    '-y', output,
  ];
}
