import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { OutputSize } from '../types';

type Mode = 'move' | 'ne' | 'nw' | 'se' | 'sw';

const CORNERS: { mode: Mode; left: string; top: string; cursor: string }[] = [
  { mode: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { mode: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { mode: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { mode: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
];

const MIN_W = 0.06; // min box width (output-normalised)
const CENTER_SNAP = 0.02;

export interface PlaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  rect: PlaceRect;
  /** Aspect ratio (w/h) of the sketch content, so the box stays undistorted. */
  padAspect: number;
  out: OutputSize;
  onChange: (rect: PlaceRect) => void;
}

/**
 * Placement editor for a projected sketch: body drag to move + four corner
 * handles, with the box aspect RATIO-LOCKED to the sketch's own ratio (no
 * free-form/distorting resize). Coordinates are normalised to the output frame,
 * so the overlay maps directly to percentages of the preview canvas.
 */
export default function SketchRectEditor({ rect, padAspect, out, onChange }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; orig: PlaceRect; startN: { x: number; y: number } } | null>(null);
  const [guides, setGuides] = useState({ cx: false, cy: false });

  // Normalised width/height ratio that keeps the pixel box == padAspect.
  const rN = padAspect * (out.h / out.w);

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
  }, []);

  const begin = useCallback(
    (e: ReactPointerEvent, mode: Mode) => {
      e.stopPropagation();
      try {
        overlayRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag.current = { mode, orig: rect, startN: toNorm(e.clientX, e.clientY) };
    },
    [rect, toNorm],
  );

  const move = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const cur = toNorm(e.clientX, e.clientY);
      const o = d.orig;
      const right = o.x + o.w;
      const bottom = o.y + o.h;

      if (d.mode === 'move') {
        let x = o.x + (cur.x - d.startN.x);
        let y = o.y + (cur.y - d.startN.y);
        const g = { cx: false, cy: false };
        if (Math.abs(x + o.w / 2 - 0.5) < CENTER_SNAP) {
          x = 0.5 - o.w / 2;
          g.cx = true;
        }
        if (Math.abs(y + o.h / 2 - 0.5) < CENTER_SNAP) {
          y = 0.5 - o.h / 2;
          g.cy = true;
        }
        setGuides(g);
        onChange({ x: Math.max(0, Math.min(1 - o.w, x)), y: Math.max(0, Math.min(1 - o.h, y)), w: o.w, h: o.h });
        return;
      }

      // Corner resize: keep the opposite corner fixed, drive width, derive height.
      let w: number;
      if (d.mode === 'se' || d.mode === 'ne') w = cur.x - o.x;
      else w = right - cur.x;
      w = Math.max(MIN_W, Math.min(1, w));
      let h = w / rN;
      if (h > 1) {
        h = 1;
        w = h * rN;
      }

      let x: number;
      let y: number;
      switch (d.mode) {
        case 'se':
          x = o.x;
          y = o.y;
          break;
        case 'ne':
          x = o.x;
          y = bottom - h;
          break;
        case 'sw':
          x = right - w;
          y = o.y;
          break;
        default: // nw
          x = right - w;
          y = bottom - h;
      }
      // Keep the box within the frame.
      x = Math.max(0, Math.min(1 - w, x));
      y = Math.max(0, Math.min(1 - h, y));
      setGuides({ cx: false, cy: false });
      onChange({ x, y, w, h });
    },
    [onChange, rN, toNorm],
  );

  const end = useCallback((e: ReactPointerEvent) => {
    try {
      overlayRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
    setGuides({ cx: false, cy: false });
  }, []);

  return (
    <div ref={overlayRef} onPointerMove={move} onPointerUp={end} className="absolute inset-0 z-20 touch-none">
      {guides.cx && (
        <div className="absolute top-0 bottom-0 w-px bg-[#b57cff] shadow-[0_0_6px_#b57cff] pointer-events-none" style={{ left: '50%' }} />
      )}
      {guides.cy && (
        <div className="absolute left-0 right-0 h-px bg-[#b57cff] shadow-[0_0_6px_#b57cff] pointer-events-none" style={{ top: '50%' }} />
      )}

      <div
        onPointerDown={(e) => begin(e, 'move')}
        className="absolute border-2 border-[var(--color-primary-green)] bg-[rgba(139,233,199,0.06)] cursor-move"
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
        }}
      >
        {CORNERS.map((c) => (
          <div
            key={c.mode}
            onPointerDown={(e) => begin(e, c.mode)}
            className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-white border border-[var(--color-primary-green)] rounded-sm"
            style={{ left: c.left, top: c.top, cursor: c.cursor }}
          />
        ))}
      </div>
    </div>
  );
}
