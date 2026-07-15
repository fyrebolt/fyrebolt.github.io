// ===== Sketch model + replay-timing normalisation + stroke geometry =====
//
// A sketch is any number of freehand STROKES (pen-down → pen-up = one stroke),
// each capturing its own colour / width / smoothness. Points are stored
// normalised to the drawing pad (0..1 on each axis).
//
// Replay is timing-normalised: the ORIGINAL point timestamps are discarded and
// the whole drawing is redrawn at a constant arc-length velocity. Because each
// stroke's time slice is proportional to its arc length, the concatenated
// drawing advances at one steady speed — long strokes take proportionally
// longer, short strokes are quick, regardless of how jerkily it was drawn.

export interface SketchPoint {
  x: number;
  y: number;
}

export interface SketchStroke {
  color: string;
  /** Pen width as a fraction of the pad's shorter side. */
  width: number;
  /** 0 = fully pixelated (coarse grid, hard corners) … 1 = smooth (fine grid, curve-fit). */
  smoothness: number;
  /** Ordered points, normalised to the pad (0..1 on each axis). */
  points: SketchPoint[];
}

export interface SketchElement {
  id: string;
  kind: 'sketch';
  /** Start time in seconds. */
  start: number;
  /** Animation duration (seconds). 0 = show the completed drawing immediately (static). */
  animationDur: number;
  /** How long the completed drawing holds after the animation (seconds). */
  freezeDur: number;
  /** Baked strokes (immutable once projected). */
  strokes: SketchStroke[];
  /** Aspect ratio (w/h) of the pad the strokes were drawn in. */
  padAspect: number;
  /** Placement box on the output frame, normalised to out.w / out.h (top-left + size). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Draw the pencil-tip tracer during the animation phase. */
  tracer: boolean;
  /** Play the pencil-on-paper sound during the animation phase. */
  sound: boolean;
}

/** End time of a sketch element (start + animation + freeze). */
export function elementEnd(el: SketchElement): number {
  return el.start + Math.max(0, el.animationDur) + Math.max(0, el.freezeDur);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---- geometry: quantisation, curve-fitting, arc-length tables ----

/** Processed render polyline for a stroke, with an arc-length table (pad-px units). */
export interface StrokeGeometry {
  /** Render polyline, normalised pad coords. */
  pts: SketchPoint[];
  /** Cumulative arc length at each point (aspect-corrected pad units). */
  cum: number[];
  /** Total arc length. */
  total: number;
  /** Whether to draw with round (smooth) vs mitred (blocky) joins/caps. */
  smooth: boolean;
}

/** Snap points to a square grid of `n` cells across the pad width (aspect-corrected). */
function quantize(points: SketchPoint[], n: number, aspect: number): SketchPoint[] {
  const ny = Math.max(1, Math.round(n / aspect));
  const out: SketchPoint[] = [];
  for (const p of points) {
    const qx = Math.round(clamp01(p.x) * n) / n;
    const qy = Math.round(clamp01(p.y) * ny) / ny;
    const last = out[out.length - 1];
    if (!last || last.x !== qx || last.y !== qy) out.push({ x: qx, y: qy });
  }
  return out;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Sample a Catmull-Rom spline through `pts`, `sps` samples per segment. */
function catmullRom(pts: SketchPoint[], sps: number): SketchPoint[] {
  if (pts.length < 3) return pts.slice();
  const res: SketchPoint[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    for (let j = 1; j <= sps; j++) {
      const t = j / sps;
      res.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), y: catmull(p0.y, p1.y, p2.y, p3.y, t) });
    }
  }
  return res;
}

function buildArc(pts: SketchPoint[], aspect: number): { cum: number[]; total: number } {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i].x - pts[i - 1].x) * aspect;
    const dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { cum, total: cum[cum.length - 1] ?? 0 };
}

const geoCache = new WeakMap<SketchStroke, { aspect: number; geo: StrokeGeometry }>();

/** Process (and memoise) a stroke's render geometry for a given pad aspect. */
export function geometryFor(stroke: SketchStroke, aspect: number): StrokeGeometry {
  const cached = geoCache.get(stroke);
  if (cached && cached.aspect === aspect) return cached.geo;

  const s = clamp01(stroke.smoothness);
  const n = Math.round(6 + s * (200 - 6)); // 6 (coarse/blocky) … 200 (near-continuous)
  let q = quantize(stroke.points, n, aspect);
  if (q.length === 0) q = stroke.points.slice(0, 1);

  let pts: SketchPoint[];
  let smooth: boolean;
  if (s > 0.5 && q.length >= 3) {
    pts = catmullRom(q, Math.round(2 + s * 8));
    smooth = true;
  } else {
    pts = q;
    smooth = false;
  }

  const { cum, total } = buildArc(pts, aspect);
  const geo: StrokeGeometry = { pts, cum, total, smooth };
  geoCache.set(stroke, { aspect, geo });
  return geo;
}

/** Total arc length of a whole sketch (sum over strokes). */
export function totalArc(strokes: SketchStroke[], aspect: number): number {
  let t = 0;
  for (const s of strokes) t += geometryFor(s, aspect).total;
  return t;
}

export type SketchPhase = 'animate' | 'freeze';

export interface SketchProgress {
  phase: SketchPhase;
  /** Arc length drawn so far (only meaningful while animating; = total during freeze). */
  drawnArc: number;
}

/**
 * What to render for a sketch element at absolute time `sec`. During the
 * animation phase the whole drawing advances at constant velocity, so the drawn
 * arc length is simply the elapsed fraction of the total length.
 */
export function sketchProgress(el: SketchElement, sec: number, total: number): SketchProgress {
  const t = sec - el.start;
  const anim = Math.max(0, el.animationDur);
  if (anim <= 0 || t >= anim) return { phase: 'freeze', drawnArc: total };
  return { phase: 'animate', drawnArc: clamp01(t / anim) * total };
}

/** Point + tangent angle at a given arc length along a stroke geometry. */
export interface ArcSample {
  x: number;
  y: number;
  /** Tangent direction in aspect-corrected pad space (radians). */
  angle: number;
}

export function sampleAt(geo: StrokeGeometry, arc: number, aspect: number): ArcSample | null {
  const { pts, cum, total } = geo;
  if (pts.length === 0) return null;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, angle: 0 };
  const s = Math.max(0, Math.min(total, arc));
  let i = 1;
  while (i < cum.length && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i] ?? pts[i - 1];
  const seg = Math.max(1e-6, cum[i] - cum[i - 1]);
  const f = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: Math.atan2((b.y - a.y), (b.x - a.x) * aspect),
  };
}

// ---- factory ----

function id(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function createSketch(overrides: Partial<SketchElement> = {}): SketchElement {
  return {
    kind: 'sketch',
    id: id(),
    start: 0,
    animationDur: 2,
    freezeDur: 2,
    strokes: [],
    padAspect: 9 / 16,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    tracer: true,
    sound: true,
    ...overrides,
  };
}
