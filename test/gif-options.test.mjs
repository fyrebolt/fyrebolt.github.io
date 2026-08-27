// Tests for src/gif/options.ts and src/gif/files.ts — the parts of the GIF
// converter that decide what ffmpeg is asked to do.
//
// The filter graph is the whole product: a GIF has 256 colours, so "full
// quality" means a palette fitted to that clip and no resampling that wasn't
// asked for. Those are exactly the properties that are invisible in the UI and
// silently wrong if a filter string is malformed, so they're asserted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_OPTIONS,
  SOURCE,
  commonFilters,
  palettegenArgs,
  palettegenFilter,
  paletteuseArgs,
  paletteuseFilter,
} from '../src/gif/options.ts';
import { formatBytes, gifName, overallProgress, scratchName, PALETTE_SHARE } from '../src/gif/files.ts';

test('the default is genuinely full quality: no rate or size filter at all', () => {
  assert.equal(DEFAULT_OPTIONS.fps, SOURCE);
  assert.equal(DEFAULT_OPTIONS.width, SOURCE);
  assert.equal(commonFilters(DEFAULT_OPTIONS), '');
});

test('a source-rate, source-width pass has no stray leading comma', () => {
  // An empty common chain used to leave ",palettegen=..." — which ffmpeg
  // rejects outright, so every conversion at the default settings failed.
  const gen = palettegenFilter(DEFAULT_OPTIONS);
  assert.ok(!gen.startsWith(','), gen);
  assert.ok(gen.startsWith('palettegen='), gen);
  assert.equal(paletteuseFilter(DEFAULT_OPTIONS), '[0:v][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle');
});

test('fps is applied before scale, so lanczos runs on the fewest frames', () => {
  const f = commonFilters({ ...DEFAULT_OPTIONS, fps: 15, width: 480 });
  assert.ok(f.indexOf('fps=15') < f.indexOf('scale='), f);
});

test('width is a ceiling, never an upscale', () => {
  const f = commonFilters({ ...DEFAULT_OPTIONS, width: 720 });
  // min(iw, 720) leaves a 480-wide source at 480 rather than blowing it up.
  assert.match(f, /scale=w='min\(iw,720\)'/);
  assert.match(f, /h=-1/);
  assert.match(f, /flags=lanczos/);
});

test('an odd-sized result is nudged to an even one', () => {
  assert.match(commonFilters({ ...DEFAULT_OPTIONS, width: 320 }), /force_divisible_by=2/);
});

test('the palette is fitted per clip, and capped at what GIF can hold', () => {
  const gen = palettegenFilter({ ...DEFAULT_OPTIONS, fps: 24 });
  assert.match(gen, /max_colors=256/);
  assert.match(gen, /stats_mode=diff/);
});

test('the encode pass wires the palette in as the second input', () => {
  const f = paletteuseFilter({ ...DEFAULT_OPTIONS, fps: 12 });
  assert.equal(f, "[0:v]fps=12[v];[v][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle");
});

test('each dither choice reaches paletteuse verbatim', () => {
  for (const d of ['sierra2_4a', 'floyd_steinberg', 'bayer', 'none']) {
    assert.match(paletteuseFilter({ ...DEFAULT_OPTIONS, dither: d }), new RegExp(`dither=${d}:`));
  }
});

test('both passes read the same input and agree on the palette file', () => {
  const o = { ...DEFAULT_OPTIONS, fps: 15 };
  const gen = palettegenArgs('in-1.mp4', 'palette-1.png', o);
  const use = paletteuseArgs('in-1.mp4', 'palette-1.png', 'out-1.gif', o);

  assert.deepEqual(gen, ['-i', 'in-1.mp4', '-vf', palettegenFilter(o), '-y', 'palette-1.png']);
  // The palette written by pass one must be the second input of pass two.
  assert.equal(use[use.indexOf('-i', use.indexOf('-i') + 1) + 1], 'palette-1.png');
  assert.equal(use[use.indexOf('-i') + 1], 'in-1.mp4');
  assert.equal(use.at(-1), 'out-1.gif');
});

test('the output loops forever and carries no audio stream', () => {
  const use = paletteuseArgs('a.mp4', 'p.png', 'o.gif', DEFAULT_OPTIONS);
  assert.equal(use[use.indexOf('-loop') + 1], '0');
  assert.ok(use.includes('-an'));
});

test('both passes overwrite, so a retry never blocks on an existing file', () => {
  assert.ok(palettegenArgs('a', 'p', DEFAULT_OPTIONS).includes('-y'));
  assert.ok(paletteuseArgs('a', 'p', 'o', DEFAULT_OPTIONS).includes('-y'));
});

test('the download keeps the name and swaps only the extension', () => {
  assert.equal(gifName('holiday.MOV'), 'holiday.gif');
  assert.equal(gifName('a.long.name.webm'), 'a.long.name.gif');
  assert.equal(gifName('noextension'), 'noextension.gif');
  assert.equal(gifName('.hidden'), '.hidden.gif');
});

test('the scratch name strips anything that could break the argv', () => {
  // A real filename can carry quotes, spaces and slashes; none of them may
  // reach ffmpeg's in-memory filesystem.
  for (const name of ['my clip.mp4', "o'brien.mov", 'a/b/c.webm', 'x";rm -rf .mkv']) {
    const s = scratchName(name, 7);
    assert.match(s, /^in-7(\.[a-z0-9]+)?$/, `${name} -> ${s}`);
  }
  assert.equal(scratchName('clip.MP4', 3), 'in-3.mp4');
  assert.equal(scratchName('bare', 1), 'in-1');
});

test('progress runs forward across both passes and ends at exactly 1', () => {
  assert.equal(overallProgress('palette', 0), 0);
  assert.equal(overallProgress('palette', 1), PALETTE_SHARE);
  assert.equal(overallProgress('encode', 0), PALETTE_SHARE);
  assert.equal(overallProgress('encode', 1), 1);

  let last = -1;
  for (const [pass, p] of [['palette', 0], ['palette', 0.5], ['palette', 1], ['encode', 0.5], ['encode', 1]]) {
    const v = overallProgress(pass, p);
    assert.ok(v >= last, `${pass} ${p} went backwards`);
    last = v;
  }
});

test('progress from ffmpeg outside 0..1 is clamped, not shown raw', () => {
  // ffmpeg's own progress can overshoot slightly on the last packet.
  assert.equal(overallProgress('encode', 1.4), 1);
  assert.equal(overallProgress('palette', -3), 0);
});

test('sizes read the way a person would say them', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(15 * 1024), '15 KB');
  assert.equal(formatBytes(5.5 * 1024 * 1024), '5.5 MB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2.0 GB');
  assert.equal(formatBytes(NaN), '—');
});
