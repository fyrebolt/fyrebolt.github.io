// ===== Squircle geometry =====
//
// Real continuous-corner curvature (an iOS "squircle"), not a plain
// border-radius. Each corner is a quarter of a superellipse
// (|x|^n + |y|^n = 1), sampled into an SVG path. With radius = half the
// shorter side this degenerates to the pure superellipse used for app icons;
// with a smaller radius it's a smooth rounded rectangle for cards and panels.
//
// The exponent controls how "square" the curve is: ~5 matches Apple's icon
// grid closely. Higher = boxier, lower = closer to a circle.

const DEFAULT_EXPONENT = 5;

/** One quarter-corner of the superellipse, from `steps` samples. */
function corner(
  cx: number,
  cy: number,
  r: number,
  sx: number,
  sy: number,
  reverse: boolean,
  n: number,
  steps: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    const u = Math.pow(Math.cos(t), 2 / n); // 1 -> 0
    const v = Math.pow(Math.sin(t), 2 / n); // 0 -> 1
    pts.push([cx + sx * r * u, cy + sy * r * v]);
  }
  return reverse ? pts.reverse() : pts;
}

/**
 * SVG path `d` for a squircle rounded rectangle of `w`×`h` with corner
 * `radius`. Coordinates are absolute pixels, so pair it with `clip-path`
 * updated on resize (see <Squircle>).
 */
export function squirclePath(
  w: number,
  h: number,
  radius: number,
  exponent = DEFAULT_EXPONENT,
  steps = 24,
): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return `M0 0 H${w} V${h} H0 Z`;

  // Corner centers, walking clockwise from the top-left.
  const tr = corner(w - r, r, r, 1, -1, true, exponent, steps); // top-right: right edge -> top edge
  const br = corner(w - r, h - r, r, 1, 1, false, exponent, steps); // bottom-right
  const bl = corner(r, h - r, r, -1, 1, true, exponent, steps); // bottom-left
  const tl = corner(r, r, r, -1, -1, false, exponent, steps); // top-left

  const seq: Array<[number, number]> = [
    [r, 0], // start on the top edge
    [w - r, 0],
    ...tr,
    [w, h - r],
    ...br,
    [r, h],
    ...bl,
    [0, r],
    ...tl,
  ];

  const [x0, y0] = seq[0];
  let d = `M${x0.toFixed(2)} ${y0.toFixed(2)}`;
  for (let i = 1; i < seq.length; i++) {
    d += ` L${seq[i][0].toFixed(2)} ${seq[i][1].toFixed(2)}`;
  }
  return d + ' Z';
}
