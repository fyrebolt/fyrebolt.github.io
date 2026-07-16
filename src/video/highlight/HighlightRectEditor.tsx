import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: { mode: Mode; left: string; top: string; cursor: string }[] = [
  { mode: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { mode: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { mode: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { mode: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { mode: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { mode: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { mode: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { mode: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

const MIN = 0.02; // min box size (output-normalised)

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  rect: Rect;
  color: string;
  onChange: (rect: Rect) => void;
}

/**
 * Free rectangle editor over the preview: 8 resize handles + body drag, in
 * output-normalised coords (the canvas already shows the full output frame).
 * Length and height resize independently — no aspect lock.
 */
export default function HighlightRectEditor({ rect, color, onChange }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; orig: Rect; start: { x: number; y: number } } | null>(null);

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
      drag.current = { mode, orig: rect, start: toNorm(e.clientX, e.clientY) };
    },
    [rect, toNorm],
  );

  const move = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const cur = toNorm(e.clientX, e.clientY);
      const dx = cur.x - d.start.x;
      const dy = cur.y - d.start.y;
      let left = d.orig.x;
      let top = d.orig.y;
      let right = d.orig.x + d.orig.w;
      let bottom = d.orig.y + d.orig.h;

      if (d.mode === 'move') {
        const w = d.orig.w;
        const h = d.orig.h;
        left = Math.max(0, Math.min(1 - w, d.orig.x + dx));
        top = Math.max(0, Math.min(1 - h, d.orig.y + dy));
        right = left + w;
        bottom = top + h;
      } else {
        if (d.mode.includes('w')) left = Math.max(0, Math.min(right - MIN, d.orig.x + dx));
        if (d.mode.includes('e')) right = Math.min(1, Math.max(left + MIN, d.orig.x + d.orig.w + dx));
        if (d.mode.includes('n')) top = Math.max(0, Math.min(bottom - MIN, d.orig.y + dy));
        if (d.mode.includes('s')) bottom = Math.min(1, Math.max(top + MIN, d.orig.y + d.orig.h + dy));
      }

      onChange({ x: left, y: top, w: right - left, h: bottom - top });
    },
    [onChange, toNorm],
  );

  const end = useCallback((e: ReactPointerEvent) => {
    try {
      overlayRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
  }, []);

  return (
    <div ref={overlayRef} onPointerMove={move} onPointerUp={end} className="absolute inset-0 z-20 touch-none">
      <div
        onPointerDown={(e) => begin(e, 'move')}
        className="absolute border-2 cursor-move"
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
          borderColor: color,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
        }}
      >
        {HANDLES.map((h) => (
          <div
            key={h.mode}
            onPointerDown={(e) => begin(e, h.mode)}
            className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm"
            style={{ left: h.left, top: h.top, cursor: h.cursor, boxShadow: '0 0 0 1px rgba(0,0,0,0.5)' }}
          />
        ))}
      </div>
    </div>
  );
}
