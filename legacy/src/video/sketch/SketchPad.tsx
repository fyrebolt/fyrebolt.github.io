import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { drawSketchStrokes } from '../render';
import type { SketchPoint, SketchStroke } from './types';
import { totalArc } from './types';

const BASE = 640; // longer-side internal resolution of the pad

interface Props {
  strokes: SketchStroke[];
  padAspect: number;
  /** Draft mode: capture new strokes. Locked mode: display only. */
  editable: boolean;
  pen: { color: string; width: number; smoothness: number };
  onCommitStroke: (s: SketchStroke) => void;
  /** Animation duration used by the in-pad replay preview. */
  animationDur: number;
  tracer: boolean;
}

/**
 * Standalone freehand drawing pad. Captures each pen-down→pen-up as one stroke
 * (with the current pen's colour / width / smoothness), renders live, and can
 * replay the timing-normalised animation in isolation via the ▶ Replay button.
 */
export default function SketchPad({ strokes, padAspect, editable, pen, onCommitStroke, animationDur, tracer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef<SketchPoint[] | null>(null);
  const raf = useRef(0);
  const penRef = useRef(pen);
  useEffect(() => {
    penRef.current = pen;
  }, [pen]);

  const dims = padAspect >= 1 ? { w: BASE, h: Math.round(BASE / padAspect) } : { w: Math.round(BASE * padAspect), h: BASE };

  const paint = useCallback(
    (drawnArc?: number, showTracer = false) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fbfbf7'; // paper
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const live =
        current.current && current.current.length > 0
          ? [...strokes, { ...penRef.current, points: [...current.current] }]
          : strokes;
      drawSketchStrokes(ctx, { x: 0, y: 0, w: canvas.width, h: canvas.height }, live, padAspect, {
        drawnArc,
        tracer: showTracer,
      });
    },
    [strokes, padAspect],
  );

  // Redraw whenever the committed strokes or the pad shape change.
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    paint();
  }, [paint]);

  const norm = useCallback((clientX: number, clientY: number): SketchPoint => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)),
    };
  }, []);

  const onDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!editable) return;
      cancelAnimationFrame(raf.current);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      current.current = [norm(e.clientX, e.clientY)];
      paint();
    },
    [editable, norm, paint],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!editable || !current.current || e.buttons === 0) return;
      current.current.push(norm(e.clientX, e.clientY));
      paint();
    },
    [editable, norm, paint],
  );

  const onUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!editable) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const pts = current.current;
      current.current = null;
      if (pts && pts.length > 0) {
        onCommitStroke({ color: pen.color, width: pen.width, smoothness: pen.smoothness, points: pts });
      } else {
        paint();
      }
    },
    [editable, onCommitStroke, paint, pen],
  );

  const replay = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (strokes.length === 0) return;
    if (animationDur <= 0) {
      paint(undefined, false);
      return;
    }
    const total = totalArc(strokes, padAspect);
    const t0 = performance.now();
    const step = () => {
      const el = (performance.now() - t0) / 1000;
      const p = Math.min(1, el / animationDur);
      paint(p * total, tracer && p < 1);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    step();
  }, [animationDur, padAspect, paint, strokes, tracer]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div>
      <div className="relative mx-auto" style={{ maxWidth: padAspect >= 1 ? 360 : 360 * padAspect }}>
        <canvas
          ref={canvasRef}
          width={dims.w}
          height={dims.h}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          className={`w-full h-auto rounded-lg block touch-none border border-[var(--color-glass-border)] ${
            editable ? 'cursor-crosshair' : 'cursor-default'
          }`}
        />
        {strokes.length === 0 && !editable && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-xs">
            Empty sketch
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 mt-2">
        <button
          onClick={replay}
          disabled={strokes.length === 0}
          className="px-3 py-1.5 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-xs font-medium"
        >
          ▶ Replay
        </button>
      </div>
    </div>
  );
}
