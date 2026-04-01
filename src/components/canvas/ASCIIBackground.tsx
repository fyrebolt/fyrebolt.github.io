import { useRef, useEffect, useCallback } from 'react';
import {
  createRippleState,
  addRipple,
  propagateWave,
  getCharForAmplitude,
  getColorForAmplitude,
} from '../../utils/asciiRipple';
import type { RippleState } from '../../utils/asciiRipple';
import { useDeviceOrientation } from '../../hooks/useDeviceOrientation';

const CELL_SIZE = 20;

// ===== Explicit ring-based ripple system =====
interface RippleEvent {
  cx: number; // grid column
  cy: number; // grid row
  time: number; // timestamp when created
}

// Rings tuned to be tighter and less spread out
const RING_SPEED = 5; // slower propagation → less aggressive spread
const RING_COUNT = 3; // fewer rings overall
const RING_SPACING = 3.0;
const RING_LIFETIME = 1.6;
const RING_CHARS = ['|', '\\', '/', '~', '-', '·'];

function getRingChar(angle: number, ring: number): string {
  const idx = (Math.floor(angle / (Math.PI / 3)) + ring) % RING_CHARS.length;
  return RING_CHARS[idx];
}

function getRingColor(ring: number, alpha: number): string {
  // Subtle concentric rings in translucent gray
  const base = 200 - ring * 10; // very small variation between rings
  const effectiveAlpha = alpha * 0.4; // overall much softer
  return `rgba(${base}, ${base}, ${base}, ${effectiveAlpha})`;
}

export default function ASCIIBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<RippleState | null>(null);
  const animFrameRef = useRef<number>(0);
  const mouseRef = useRef({ x: -1, y: -1 });
  const lastMouseCellRef = useRef({ x: -1, y: -1 });
  const timeRef = useRef(0);
  const rippleEventsRef = useRef<RippleEvent[]>([]);
  const orientation = useDeviceOrientation();

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    const cols = Math.ceil(width / CELL_SIZE);
    const rows = Math.ceil(height / CELL_SIZE);
    stateRef.current = createRippleState(cols, rows);
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const state = stateRef.current;
    if (!canvas || !state) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.style.width ? parseInt(canvas.style.width) : window.innerWidth;
    const height = canvas.style.height ? parseInt(canvas.style.height) : window.innerHeight;
    const now = performance.now() / 1000;

    // Clear: keep a clean, mostly blank background so the "physics"
    // visually fade away and don't overpower the content.
    ctx.fillStyle = 'rgba(10, 10, 15, 0.98)';
    ctx.fillRect(0, 0, width, height);

    // Add passive ripples for ambient motion (sparser + lower energy)
    timeRef.current += 0.016;
    if (Math.random() < 0.004) {
      const rx = Math.floor(Math.random() * state.cols);
      const ry = Math.floor(Math.random() * state.rows);
      addRipple(state, rx, ry, 1.5, 35);
    }

    // Store mouse ripple events when cursor moves to a new cell
    // NO longer inject into wave system — that was causing the hole
    if (mouseRef.current.x >= 0) {
      const mx = Math.floor(mouseRef.current.x / CELL_SIZE);
      const my = Math.floor(mouseRef.current.y / CELL_SIZE);
      if (mx !== lastMouseCellRef.current.x || my !== lastMouseCellRef.current.y) {
        // Only store explicit ring event — no wave injection to prevent holes
        rippleEventsRef.current.push({ cx: mx, cy: my, time: now });
        lastMouseCellRef.current = { x: mx, y: my };
      }
    }

    // Add orientation-based ripple (mobile) with reduced spread
    if (orientation.supported) {
      const ox = Math.floor(((orientation.gamma + 90) / 180) * state.cols);
      const oy = Math.floor(((orientation.beta + 180) / 360) * state.rows);
      addRipple(state, ox, oy, 2, 40);
    }

    // Propagate ambient wave with stronger damping so ripples fade quickly
    propagateWave(state, 0.98);

    // ---- Render base ASCII from wave state ----
    ctx.font = `${CELL_SIZE * 0.75}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = width / 2;
    const centerY = height / 2;
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const amplitude = state.current[y * state.cols + x];
        if (Math.abs(amplitude) > 1) {
          // Radial fade so the effect is soft and can visually "disappear"
          // toward the center, keeping the main content area cleaner.
          const px = x * CELL_SIZE + CELL_SIZE / 2;
          const py = y * CELL_SIZE + CELL_SIZE / 2;
          const dx = px - centerX;
          const dy = py - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const radialFade = Math.max(0, 1 - (dist / maxDist) * 1.2);
          if (radialFade <= 0.02) continue;

          const char = getCharForAmplitude(amplitude);
          const color = getColorForAmplitude(amplitude);
          ctx.fillStyle = color;
          ctx.globalAlpha = radialFade;
          ctx.fillText(
            char,
            x * CELL_SIZE + CELL_SIZE / 2,
            y * CELL_SIZE + CELL_SIZE / 2
          );
        }
      }
    }

    // ---- Render explicit concentric ripple rings ----
    rippleEventsRef.current = rippleEventsRef.current.filter(
      (ev) => now - ev.time < RING_LIFETIME
    );

    ctx.font = `bold ${CELL_SIZE * 0.8}px 'JetBrains Mono', monospace`;
    for (const ev of rippleEventsRef.current) {
      const age = now - ev.time;
      const ageFade = Math.max(0, 1 - age / RING_LIFETIME);

      for (let ring = 0; ring < RING_COUNT; ring++) {
        const radius = age * RING_SPEED - ring * RING_SPACING;
        if (radius < 0.5 || radius > 30) continue;

        const alpha = ageFade * (1 - ring * 0.15);
        if (alpha < 0.03) continue;

        const color = getRingColor(ring, alpha);
        ctx.fillStyle = color;
        ctx.globalAlpha = 1;

        const circumference = Math.max(12, Math.floor(2 * Math.PI * radius * 1.2));
        const step = (2 * Math.PI) / circumference;

        for (let i = 0; i < circumference; i++) {
          const angle = i * step;
          const gx = Math.round(ev.cx + Math.cos(angle) * radius);
          const gy = Math.round(ev.cy + Math.sin(angle) * radius);

          if (gx < 0 || gx >= state.cols || gy < 0 || gy >= state.rows) continue;

          const char = getRingChar(angle, ring);
          const px = gx * CELL_SIZE + CELL_SIZE / 2;
          const py = gy * CELL_SIZE + CELL_SIZE / 2;

          ctx.fillText(char, px, py);
        }
      }
    }
    ctx.globalAlpha = 1;

    animFrameRef.current = requestAnimationFrame(render);
  }, [orientation]);

  useEffect(() => {
    initCanvas();

    const handleResize = () => {
      initCanvas();
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -1, y: -1 };
      lastMouseCellRef.current = { x: -1, y: -1 };
    };

    // Mobile: create ripple on tap
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const mx = Math.floor(touch.clientX / CELL_SIZE);
        const my = Math.floor(touch.clientY / CELL_SIZE);
        const now = performance.now() / 1000;
        rippleEventsRef.current.push({ cx: mx, cy: my, time: now });
      }
    };

    // Mobile: create ripple trail on drag
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        mouseRef.current = { x: touch.clientX, y: touch.clientY };
      }
    };

    const handleTouchEnd = () => {
      mouseRef.current = { x: -1, y: -1 };
      lastMouseCellRef.current = { x: -1, y: -1 };
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [initCanvas, render]);

  return (
    <canvas
      ref={canvasRef}
      id="ascii-background"
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ willChange: 'transform' }}
      aria-hidden="true"
    />
  );
}
