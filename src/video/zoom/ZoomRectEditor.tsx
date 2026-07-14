import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { OutputSize } from '../types';
import { containRect } from '../render';
import type { ZoomRect } from './types';

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

const MIN = 0.03; // min rect size (source-normalised)
const CENTER_SNAP = 0.02; // source-normalised
const ASPECT_SNAP = 0.05; // relative

interface Props {
  rect: ZoomRect;
  srcW: number;
  srcH: number;
  out: OutputSize;
  onChange: (rect: ZoomRect) => void;
}

/**
 * Rectangle editor drawn over the full-frame preview: 8 resize handles + body
 * drag, in source-normalised coords. Hard-snaps to the frame centre (H/V) and
 * to the output aspect ratio, with purple guide lines while snapped.
 */
export default function ZoomRectEditor({ rect, srcW, srcH, out, onChange }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; orig: ZoomRect; startSrc: { x: number; y: number } } | null>(null);
  const [guides, setGuides] = useState({ cx: false, cy: false, ar: false });

  const va = containRect(srcW, srcH, out); // full-source video area within the canvas
  const outAR = out.w / out.h;

  const toSrc = useCallback(
    (clientX: number, clientY: number) => {
      const el = overlayRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const cfx = (clientX - r.left) / r.width;
      const cfy = (clientY - r.top) / r.height;
      return { x: (cfx * out.w - va.dx) / va.dw, y: (cfy * out.h - va.dy) / va.dh };
    },
    [out.w, out.h, va.dx, va.dy, va.dw, va.dh],
  );

  const begin = useCallback(
    (e: ReactPointerEvent, mode: Mode) => {
      e.stopPropagation();
      try {
        overlayRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag.current = { mode, orig: rect, startSrc: toSrc(e.clientX, e.clientY) };
    },
    [rect, toSrc],
  );

  const move = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const cur = toSrc(e.clientX, e.clientY);
      const dx = cur.x - d.startSrc.x;
      const dy = cur.y - d.startSrc.y;
      let left = d.orig.x;
      let top = d.orig.y;
      let right = d.orig.x + d.orig.w;
      let bottom = d.orig.y + d.orig.h;

      if (d.mode === 'move') {
        left += dx;
        right += dx;
        top += dy;
        bottom += dy;
      } else {
        if (d.mode.includes('w')) left = Math.min(right - MIN, d.orig.x + dx);
        if (d.mode.includes('e')) right = Math.max(left + MIN, d.orig.x + d.orig.w + dx);
        if (d.mode.includes('n')) top = Math.min(bottom - MIN, d.orig.y + dy);
        if (d.mode.includes('s')) bottom = Math.max(top + MIN, d.orig.y + d.orig.h + dy);
      }

      const g = { cx: false, cy: false, ar: false };
      if (d.mode === 'move') {
        const w = right - left;
        const h = bottom - top;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        if (Math.abs(cx - 0.5) < CENTER_SNAP) {
          left = 0.5 - w / 2;
          right = 0.5 + w / 2;
          g.cx = true;
        }
        if (Math.abs(cy - 0.5) < CENTER_SNAP) {
          top = 0.5 - h / 2;
          bottom = 0.5 + h / 2;
          g.cy = true;
        }
      } else {
        const w = right - left;
        const h = bottom - top;
        const arPx = (w * srcW) / (h * srcH);
        if (h > 0 && Math.abs(arPx - outAR) / outAR < ASPECT_SNAP) {
          const newH = (w * srcW) / (outAR * srcH); // h that makes pixel-AR == output AR
          if (d.mode.includes('n')) top = bottom - newH;
          else bottom = top + newH;
          g.ar = true;
        }
      }

      setGuides(g);
      onChange({ x: left, y: top, w: right - left, h: bottom - top });
    },
    [onChange, outAR, srcH, srcW, toSrc],
  );

  const end = useCallback((e: ReactPointerEvent) => {
    try {
      overlayRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
    setGuides({ cx: false, cy: false, ar: false });
  }, []);

  // box position in canvas fractions
  const boxLeft = ((va.dx + rect.x * va.dw) / out.w) * 100;
  const boxTop = ((va.dy + rect.y * va.dh) / out.h) * 100;
  const boxW = ((rect.w * va.dw) / out.w) * 100;
  const boxH = ((rect.h * va.dh) / out.h) * 100;
  const centerXPct = ((va.dx + 0.5 * va.dw) / out.w) * 100;
  const centerYPct = ((va.dy + 0.5 * va.dh) / out.h) * 100;
  const vaLeft = (va.dx / out.w) * 100;
  const vaTop = (va.dy / out.h) * 100;
  const vaW = (va.dw / out.w) * 100;
  const vaH = (va.dh / out.h) * 100;

  return (
    <div
      ref={overlayRef}
      onPointerMove={move}
      onPointerUp={end}
      className="absolute inset-0 z-20 touch-none"
    >
      {/* source-frame bounds */}
      <div
        className="absolute border border-dashed border-white/25 pointer-events-none"
        style={{ left: `${vaLeft}%`, top: `${vaTop}%`, width: `${vaW}%`, height: `${vaH}%` }}
      />
      {/* centre guides */}
      {guides.cx && <div className="absolute top-0 bottom-0 w-px bg-[#b57cff] shadow-[0_0_6px_#b57cff] pointer-events-none" style={{ left: `${centerXPct}%` }} />}
      {guides.cy && <div className="absolute left-0 right-0 h-px bg-[#b57cff] shadow-[0_0_6px_#b57cff] pointer-events-none" style={{ top: `${centerYPct}%` }} />}

      {/* the crop rectangle */}
      <div
        onPointerDown={(e) => begin(e, 'move')}
        className="absolute border-2 border-[var(--color-primary-green)] bg-[rgba(139,233,199,0.08)] cursor-move"
        style={{ left: `${boxLeft}%`, top: `${boxTop}%`, width: `${boxW}%`, height: `${boxH}%` }}
      >
        {guides.ar && (
          <div className="absolute -top-5 left-0 text-[9px] px-1 rounded bg-[#b57cff] text-black font-bold whitespace-nowrap pointer-events-none">
            = output ratio
          </div>
        )}
        {HANDLES.map((h) => (
          <div
            key={h.mode}
            onPointerDown={(e) => begin(e, h.mode)}
            className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-white border border-[var(--color-primary-green)] rounded-sm"
            style={{ left: h.left, top: h.top, cursor: h.cursor }}
          />
        ))}
      </div>
    </div>
  );
}
