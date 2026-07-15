// ===== ASCII Water Ripple Simulation =====
// Uses a 2D damped wave equation to simulate ripples
// ASCII characters are selected based on wave amplitude and direction

const ASCII_CHARS = ['|', '\\', '/', '_', '~', '-', '·', '.'];

export interface RippleConfig {
  cols: number;
  rows: number;
  damping: number;
  spread: number;
}

export interface RippleState {
  current: Float32Array;
  previous: Float32Array;
  cols: number;
  rows: number;
}

export function createRippleState(cols: number, rows: number): RippleState {
  return {
    current: new Float32Array(cols * rows),
    previous: new Float32Array(cols * rows),
    cols,
    rows,
  };
}

export function addRipple(
  state: RippleState,
  x: number,
  y: number,
  radius: number = 3,
  amplitude: number = 255
): void {
  const { cols, rows, current } = state;
  const cx = Math.floor(x);
  const cy = Math.floor(y);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          const falloff = 1 - dist / radius;
          current[ny * cols + nx] = amplitude * falloff;
        }
      }
    }
  }
}

export function propagateWave(state: RippleState, damping: number = 0.96): void {
  const { cols, rows, current, previous } = state;
  const next = new Float32Array(cols * rows);

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const idx = y * cols + x;
      next[idx] =
        (previous[idx - 1] +
          previous[idx + 1] +
          previous[(y - 1) * cols + x] +
          previous[(y + 1) * cols + x]) /
          2 -
        current[idx];
      next[idx] *= damping;
    }
  }

  state.previous.set(state.current);
  state.current.set(next);
}

export function getCharForAmplitude(amplitude: number): string {
  const absAmp = Math.abs(amplitude);
  if (absAmp <= 1) return '|'; // base character — always visible
  if (absAmp > 100) return ASCII_CHARS[0]; // |
  if (absAmp > 70) return amplitude > 0 ? ASCII_CHARS[1] : ASCII_CHARS[2]; // \ or /
  if (absAmp > 40) return ASCII_CHARS[3]; // _
  if (absAmp > 20) return ASCII_CHARS[4]; // ~
  if (absAmp > 10) return ASCII_CHARS[5]; // -
  if (absAmp > 4) return ASCII_CHARS[6]; // ·
  // Clamp index so it never exceeds the last valid character
  const index = Math.min(Math.floor(absAmp * ASCII_CHARS.length / 100), ASCII_CHARS.length - 1);
  return ASCII_CHARS[index] || '|'; // fallback to base character
}

export function getColorForAmplitude(amplitude: number): string {
  // Map amplitude to a soft, translucent neutral gray instead of neon colors.
  const absAmp = Math.min(Math.abs(amplitude) / 120, 1);

  // Higher amplitude = slightly brighter + more opaque gray
  const base = 180;
  const intensity = base + Math.floor(40 * absAmp); // 180 → 220
  const alpha = 0.08 + absAmp * 0.22; // very subtle overall (0.08 → 0.3)

  return `rgba(${intensity}, ${intensity}, ${intensity}, ${alpha})`;
}
