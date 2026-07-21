// ===== Shared guide-lock / snap engine (output-normalised 0..1 space) =====
//
// One engine drives every transformable layer. A `Box` is top-left + size in
// output-normalised coordinates (the preview canvas shows the full output frame,
// so these map straight to percentages). The global `GuideSettings` toggles —
// surfaced by the gear affordance — decide which snap lines are live while a
// layer is dragged or resized. This generalises Zoom's original centre + aspect
// guide precedent into one place shared by all kinds.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideSettings {
  /** Snap the box centre to the canvas vertical centre-line (x = 0.5). */
  centerH: boolean;
  /** Snap the box centre to the canvas horizontal centre-line (y = 0.5). */
  centerV: boolean;
  /** While resizing, snap the width to the full canvas width. */
  fitWidth: boolean;
  /** While resizing, snap the height to the full canvas height. */
  fitHeight: boolean;
  /** Snap box edges to the canvas borders (0 and 1). */
  border: boolean;
  /** Snap box edges/centres to other layers' edges/centres. */
  object: boolean;
  /** Snap the box centre to the pointer position. */
  cursor: boolean;
  // ---- temporal (timeline) snapping — the time-domain twin of the spatial locks ----
  /** Snap a dragged element's start/end to clip boundaries. */
  snapClips: boolean;
  /** Snap a dragged element's start/end to other elements' start/end. */
  snapElements: boolean;
  /** Snap a dragged element's start/end to the playhead. */
  snapPlayhead: boolean;
}

export const DEFAULT_GUIDES: GuideSettings = {
  centerH: true,
  centerV: true,
  fitWidth: false,
  fitHeight: false,
  border: true,
  object: true,
  cursor: false,
  snapClips: true,
  snapElements: true,
  snapPlayhead: true,
};

/** A single alignment line to draw while a snap is active. */
export interface Guide {
  axis: 'x' | 'y';
  /** Normalised position of the line (0..1). */
  at: number;
  kind: 'center' | 'border' | 'object' | 'fit' | 'cursor';
}

export interface SnapEnv {
  settings: GuideSettings;
  /** Other layers' boxes (output-normalised), excluding the one being edited. */
  others: Box[];
  /** Normalised pointer position, for snap-to-cursor. */
  cursor: { x: number; y: number } | null;
}

/** Snap threshold in normalised units (~1.8% of the frame). */
export const SNAP_T = 0.018;

interface Candidate {
  src: number; // a control point on the moving box (min / mid / max)
  tgt: number; // the snap line to land it on
  kind: Guide['kind'];
}

/** Alignment lines available on one axis for the given settings. */
function axisLines(env: SnapEnv, axis: 'x' | 'y'): { tgt: number; kind: Guide['kind'] }[] {
  const s = env.settings;
  const lines: { tgt: number; kind: Guide['kind'] }[] = [];
  const centerOn = axis === 'x' ? s.centerH : s.centerV;
  if (centerOn) lines.push({ tgt: 0.5, kind: 'center' });
  if (s.border) {
    lines.push({ tgt: 0, kind: 'border' });
    lines.push({ tgt: 1, kind: 'border' });
  }
  if (s.cursor && env.cursor) lines.push({ tgt: axis === 'x' ? env.cursor.x : env.cursor.y, kind: 'cursor' });
  if (s.object) {
    for (const o of env.others) {
      const min = axis === 'x' ? o.x : o.y;
      const size = axis === 'x' ? o.w : o.h;
      lines.push({ tgt: min, kind: 'object' });
      lines.push({ tgt: min + size / 2, kind: 'object' });
      lines.push({ tgt: min + size, kind: 'object' });
    }
  }
  return lines;
}

/** A control point on the moving box: an edge or its centre. */
interface Source {
  at: number;
  role: 'edge' | 'mid';
}

/** Best snap for a set of source control points against the axis' lines. */
function bestSnap(sources: Source[], env: SnapEnv, axis: 'x' | 'y'): Candidate | null {
  const lines = axisLines(env, axis);
  let best: Candidate | null = null;
  let bestD = SNAP_T;
  for (const src of sources) {
    for (const line of lines) {
      // Centre/cursor lines only accept the box centre; borders/objects accept any edge or centre.
      if ((line.kind === 'center' || line.kind === 'cursor') && src.role !== 'mid') continue;
      const d = Math.abs(src.at - line.tgt);
      if (d < bestD) {
        bestD = d;
        best = { src: src.at, tgt: line.tgt, kind: line.kind };
      }
    }
  }
  return best;
}

/**
 * Snap a MOVE (size fixed). Returns the snapped box plus the guide lines that
 * became active. Each axis snaps independently on the box's edges + centre.
 */
export function snapMove(box: Box, env: SnapEnv): { box: Box; guides: Guide[] } {
  const guides: Guide[] = [];
  const out: Box = { ...box };

  const sx = bestSnap(
    [
      { at: box.x, role: 'edge' },
      { at: box.x + box.w / 2, role: 'mid' },
      { at: box.x + box.w, role: 'edge' },
    ],
    env,
    'x',
  );
  if (sx) {
    out.x = box.x + (sx.tgt - sx.src);
    guides.push({ axis: 'x', at: sx.tgt, kind: sx.kind });
  }

  const sy = bestSnap(
    [
      { at: box.y, role: 'edge' },
      { at: box.y + box.h / 2, role: 'mid' },
      { at: box.y + box.h, role: 'edge' },
    ],
    env,
    'y',
  );
  if (sy) {
    out.y = box.y + (sy.tgt - sy.src);
    guides.push({ axis: 'y', at: sy.tgt, kind: sy.kind });
  }

  return { box: out, guides };
}

/**
 * Snap a bare centre point to centre-lines, the cursor, and other layers'
 * centres only (no edges). Used while moving a ROTATED box, whose axis-aligned
 * edges are not meaningful snap sources.
 */
export function snapCenter(cx: number, cy: number, env: SnapEnv): { x: number; y: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const s = env.settings;
  const pick = (val: number, axis: 'x' | 'y'): number => {
    const lines: { tgt: number; kind: Guide['kind'] }[] = [];
    if ((axis === 'x' ? s.centerH : s.centerV)) lines.push({ tgt: 0.5, kind: 'center' });
    if (s.cursor && env.cursor) lines.push({ tgt: axis === 'x' ? env.cursor.x : env.cursor.y, kind: 'cursor' });
    if (s.object) for (const o of env.others) lines.push({ tgt: (axis === 'x' ? o.x + o.w / 2 : o.y + o.h / 2), kind: 'object' });
    let best = val;
    let bestD = SNAP_T;
    for (const l of lines) {
      const d = Math.abs(val - l.tgt);
      if (d < bestD) {
        bestD = d;
        best = l.tgt;
        guides.push({ axis, at: l.tgt, kind: l.kind });
      }
    }
    return best;
  };
  return { x: pick(cx, 'x'), y: pick(cy, 'y'), guides };
}

/** Which edges a resize is dragging. */
export interface Edges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/**
 * Snap a free (non-aspect-locked) RESIZE. Only the moving edges snap, to borders,
 * other objects, the canvas centre-lines, and — when enabled — full width/height.
 */
export function snapResizeFree(box: Box, edges: Edges, env: SnapEnv): { box: Box; guides: Guide[] } {
  const guides: Guide[] = [];
  let left = box.x;
  let right = box.x + box.w;
  let top = box.y;
  let bottom = box.y + box.h;

  const snapValue = (val: number, axis: 'x' | 'y'): { v: number; g: Guide | null } => {
    const cand = bestSnap([{ at: val, role: 'edge' }], env, axis);
    if (!cand) return { v: val, g: null };
    return { v: cand.tgt, g: { axis, at: cand.tgt, kind: cand.kind } };
  };

  if (edges.left) {
    const r = snapValue(left, 'x');
    left = r.v;
    if (r.g) guides.push(r.g);
  }
  if (edges.right) {
    const r = snapValue(right, 'x');
    right = r.v;
    if (r.g) guides.push(r.g);
  }
  if (edges.top) {
    const r = snapValue(top, 'y');
    top = r.v;
    if (r.g) guides.push(r.g);
  }
  if (edges.bottom) {
    const r = snapValue(bottom, 'y');
    bottom = r.v;
    if (r.g) guides.push(r.g);
  }

  // Fit-to-width / fit-to-height: snap the full span when close to the frame.
  if (env.settings.fitWidth && (edges.left || edges.right) && Math.abs(right - left - 1) < SNAP_T) {
    left = 0;
    right = 1;
    guides.push({ axis: 'x', at: 0, kind: 'fit' }, { axis: 'x', at: 1, kind: 'fit' });
  }
  if (env.settings.fitHeight && (edges.top || edges.bottom) && Math.abs(bottom - top - 1) < SNAP_T) {
    top = 0;
    bottom = 1;
    guides.push({ axis: 'y', at: 0, kind: 'fit' }, { axis: 'y', at: 1, kind: 'fit' });
  }

  return { box: { x: left, y: top, w: right - left, h: bottom - top }, guides };
}

/**
 * Snap a scale factor for aspect-locked / uniform-scale resize. The box grows or
 * shrinks about a fixed anchor corner; we snap the *moving* corner to borders and
 * object lines, and to full width/height when fit toggles are on. Returns the
 * chosen uniform scale multiplier applied to the original box, plus guides.
 */
export function snapUniformScale(
  orig: Box,
  anchor: { x: number; y: number },
  scale: number,
  env: SnapEnv,
): { scale: number; guides: Guide[] } {
  const guides: Guide[] = [];
  // The moving corner is the one diagonally opposite the anchor.
  const movingX = anchor.x === orig.x ? orig.x + orig.w : orig.x;
  const movingY = anchor.y === orig.y ? orig.y + orig.h : orig.y;
  const dirX = movingX - anchor.x; // signed distance from anchor at scale=1
  const dirY = movingY - anchor.y;

  let best = scale;
  let bestD = SNAP_T;
  const consider = (targetVal: number, dir: number, base: number, axis: 'x' | 'y', kind: Guide['kind']) => {
    if (Math.abs(dir) < 1e-6) return;
    const s = (targetVal - base) / dir; // scale that lands the moving corner on targetVal
    if (s <= 0.05) return;
    const landed = base + dir * scale;
    const d = Math.abs(landed - targetVal);
    if (d < bestD) {
      bestD = d;
      best = s;
      guides.length = 0;
      guides.push({ axis, at: targetVal, kind });
    }
  };

  const lx = axisLines(env, 'x');
  for (const l of lx) if (l.kind !== 'center' && l.kind !== 'cursor') consider(l.tgt, dirX, anchor.x, 'x', l.kind);
  const ly = axisLines(env, 'y');
  for (const l of ly) if (l.kind !== 'center' && l.kind !== 'cursor') consider(l.tgt, dirY, anchor.y, 'y', l.kind);

  return { scale: best, guides };
}

// ===== Temporal (timeline) snapping — the time-domain twin of the spatial locks =====
//
// While an element's start/end/body is dragged on the timeline, its edge can lock
// to nearby anchors in TIME (seconds) the same way a box edge locks in space: clip
// boundaries, other elements' start/end, and the playhead. Which anchors are live
// is governed by the same GuideSettings surfaced in the gear popover.

export type TimeSnapKind = 'clip' | 'element' | 'playhead';

export interface TimeSnapTarget {
  /** Anchor time in OUTPUT seconds. */
  t: number;
  kind: TimeSnapKind;
}

/**
 * Snap time `t` to the nearest live target within `threshold` seconds. Returns the
 * (possibly unchanged) time plus the target it locked to (for drawing a guide),
 * or null when nothing was close enough. `settings` gates each target kind.
 */
export function snapTime(
  t: number,
  targets: TimeSnapTarget[],
  threshold: number,
  settings: Pick<GuideSettings, 'snapClips' | 'snapElements' | 'snapPlayhead'>,
): { t: number; hit: TimeSnapTarget | null } {
  let best: TimeSnapTarget | null = null;
  let bestD = threshold;
  for (const tg of targets) {
    if (tg.kind === 'clip' && !settings.snapClips) continue;
    if (tg.kind === 'element' && !settings.snapElements) continue;
    if (tg.kind === 'playhead' && !settings.snapPlayhead) continue;
    const d = Math.abs(t - tg.t);
    if (d < bestD) {
      bestD = d;
      best = tg;
    }
  }
  return best ? { t: best.t, hit: best } : { t, hit: null };
}
