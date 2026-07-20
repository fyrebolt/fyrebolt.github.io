// Pure placement-box measurement for the transform widget.
//
// The compositor measures text against its live canvas, but React render code
// can't read that ref. This mirrors the same font selection + measurement on a
// shared offscreen canvas so the selected layer's box can be derived purely.

import type { OutputSize } from '../types';
import type { Project, Layer } from '../project/types';
import { poolById, fontByKey } from '../captions/fonts';
import type { Caption } from '../captions/types';
import { boilFontIndex } from '../captions/types';
import { measureCaption, dramaticWordLayout } from '../render';
import type { Box } from './snapEngine';

let scratch: CanvasRenderingContext2D | null = null;
function scratchCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!scratch) scratch = document.createElement('canvas').getContext('2d');
  return scratch;
}

/** Placement box (output-normalised, top-left + size) of any placeable layer. */
export function measurePlaceableBox(layer: Layer, project: Project, out: OutputSize, timeSec: number): Box | null {
  if (layer.kind === 'sketch' || layer.kind === 'highlighter') {
    const el = layer.el;
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
  const ctx = scratchCtx();
  if (!ctx) return null;
  if (layer.kind === 'caption') {
    const el = layer.el;
    let font;
    if (el.kind === 'boil') {
      const pool = poolById(project.boilPool);
      const fi = boilFontIndex(el as Caption, (timeSec - el.start) * 1000, pool.fonts.length);
      font = pool.fonts[fi] ?? pool.fonts[0];
    } else {
      font = fontByKey(el.fontKey);
    }
    const L = measureCaption(ctx, out, el, font, el.kind === 'boil' && project.normalize);
    return { x: L.left / out.w, y: L.top / out.h, w: L.blockW / out.w, h: L.blockH / out.h };
  }
  if (layer.kind === 'dramatic') {
    const L = dramaticWordLayout(ctx, out, layer.el);
    return { x: L.left / out.w, y: L.top / out.h, w: L.blockW / out.w, h: L.blockH / out.h };
  }
  return null;
}
