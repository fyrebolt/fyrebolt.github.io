import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { OutputSize } from '../types';
import type { Box, GuideSettings, Guide, SnapEnv } from './snapEngine';
import { snapMove, snapCenter, snapResizeFree } from './snapEngine';

/** One transformable object's placement: output-normalised box + rotation (rad). */
export interface Transform {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Mode = 'move' | 'rotate' | Handle;

// hx/hy: which way each handle moves (−1 / 0 / +1) relative to the box centre.
const HDEF: Record<Handle, { hx: -1 | 0 | 1; hy: -1 | 0 | 1; left: string; top: string; cursor: string }> = {
  nw: { hx: -1, hy: -1, left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { hx: 0, hy: -1, left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { hx: 1, hy: -1, left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { hx: 1, hy: 0, left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { hx: 1, hy: 1, left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { hx: 0, hy: 1, left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { hx: -1, hy: 1, left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { hx: -1, hy: 0, left: '0%', top: '50%', cursor: 'ew-resize' },
};

const FREE_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];

interface Props {
  transform: Transform;
  /** 'free' = 8 handles, independent w/h. 'locked' = 4 corners, aspect fixed. */
  resize: 'free' | 'locked';
  /** For 'locked': the pixel aspect (w/h) the box must keep. */
  lockedAspectPx?: number;
  out: OutputSize;
  settings: GuideSettings;
  /** Other layers' boxes (output-normalised) for snap-to-object. */
  others: Box[];
  /** Minimum box size as a fraction of the frame's shorter side. */
  minSize?: number;
  color?: string;
  onChange: (t: Transform) => void;
  onGuides?: (g: Guide[]) => void;
  onGrab?: () => void;
}

function rot(vx: number, vy: number, a: number): { x: number; y: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: vx * c - vy * s, y: vx * s + vy * c };
}

/**
 * The one shared on-canvas transform widget: body drag (move), corner/edge
 * resize (free or aspect-locked), and a rotate handle above the box. All
 * geometry is done in OUTPUT PIXELS so rotation matches the compositor, then
 * converted back to the output-normalised {x,y,w,h,rotation} the layers store.
 * Snapping is driven by the shared guide engine.
 */
export default function TransformBox({
  transform,
  resize,
  lockedAspectPx,
  out,
  settings,
  others,
  minSize = 0.03,
  color = 'var(--color-primary-green)',
  onChange,
  onGuides,
  onGrab,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; orig: Transform; startN: { x: number; y: number }; startAngle: number } | null>(null);
  const [active, setActive] = useState(false);

  const minPx = minSize * Math.min(out.w, out.h);

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
  }, []);

  const emitGuides = useCallback((g: Guide[]) => onGuides?.(g), [onGuides]);

  const begin = useCallback(
    (e: ReactPointerEvent, mode: Mode) => {
      e.stopPropagation();
      onGrab?.();
      try {
        overlayRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const n = toNorm(e.clientX, e.clientY);
      const cx = (transform.x + transform.w / 2) * out.w;
      const cy = (transform.y + transform.h / 2) * out.h;
      const startAngle = Math.atan2(n.y * out.h - cy, n.x * out.w - cx);
      drag.current = { mode, orig: transform, startN: n, startAngle };
      setActive(true);
    },
    [transform, toNorm, out.w, out.h, onGrab],
  );

  const move = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const n = toNorm(e.clientX, e.clientY);
      const o = d.orig;
      const env: SnapEnv = { settings, others, cursor: n };

      if (d.mode === 'rotate') {
        const cx = (o.x + o.w / 2) * out.w;
        const cy = (o.y + o.h / 2) * out.h;
        const ang = Math.atan2(n.y * out.h - cy, n.x * out.w - cx);
        let next = o.rotation + (ang - d.startAngle);
        // Snap to 15° steps when close, and firmly to the 90° quadrants.
        const step = Math.PI / 12;
        const snapped = Math.round(next / step) * step;
        if (Math.abs(next - snapped) < (4 * Math.PI) / 180) next = snapped;
        onChange({ ...o, rotation: next });
        emitGuides([]);
        return;
      }

      if (d.mode === 'move') {
        const dx = n.x - d.startN.x;
        const dy = n.y - d.startN.y;
        let box: Box = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
        let guides: Guide[] = [];
        if (o.rotation === 0) {
          const r = snapMove(box, env);
          box = r.box;
          guides = r.guides;
        } else {
          const c = snapCenter(box.x + box.w / 2, box.y + box.h / 2, env);
          box = { ...box, x: c.x - box.w / 2, y: c.y - box.h / 2 };
          guides = c.guides;
        }
        emitGuides(guides);
        onChange({ ...o, x: box.x, y: box.y });
        return;
      }

      // ---- resize ----
      const hdef = HDEF[d.mode];
      const owPx = o.w * out.w;
      const ohPx = o.h * out.h;
      const cxPx = (o.x + o.w / 2) * out.w;
      const cyPx = (o.y + o.h / 2) * out.h;
      // World position of the fixed anchor (corner/edge opposite the handle).
      const anchorOff = rot((-hdef.hx * owPx) / 2, (-hdef.hy * ohPx) / 2, o.rotation);
      const anchorWx = cxPx + anchorOff.x;
      const anchorWy = cyPx + anchorOff.y;
      // Pointer in the box's local (unrotated) frame, relative to the anchor.
      const pv = rot(n.x * out.w - anchorWx, n.y * out.h - anchorWy, -o.rotation);

      let newW = hdef.hx !== 0 ? Math.max(minPx, hdef.hx * pv.x) : owPx;
      let newH = hdef.hy !== 0 ? Math.max(minPx, hdef.hy * pv.y) : ohPx;

      if (resize === 'locked' && lockedAspectPx && lockedAspectPx > 0) {
        // Corner drag: follow the larger of the two local deltas, keep aspect.
        const drive = Math.max(newW, newH * lockedAspectPx);
        newW = drive;
        newH = drive / lockedAspectPx;
      }

      const centerFromAnchor = rot((hdef.hx * newW) / 2, (hdef.hy * newH) / 2, o.rotation);
      const ncx = anchorWx + centerFromAnchor.x;
      const ncy = anchorWy + centerFromAnchor.y;

      let box: Box = {
        x: (ncx - newW / 2) / out.w,
        y: (ncy - newH / 2) / out.h,
        w: newW / out.w,
        h: newH / out.h,
      };
      let guides: Guide[] = [];

      // Edge/border/fit snapping only makes sense on an axis-aligned free box.
      if (resize === 'free' && o.rotation === 0) {
        const edges = {
          left: hdef.hx < 0,
          right: hdef.hx > 0,
          top: hdef.hy < 0,
          bottom: hdef.hy > 0,
        };
        const r = snapResizeFree(box, edges, env);
        box = r.box;
        guides = r.guides;
      }

      emitGuides(guides);
      onChange({ ...o, x: box.x, y: box.y, w: box.w, h: box.h });
    },
    [settings, others, out.w, out.h, minPx, resize, lockedAspectPx, onChange, emitGuides, toNorm],
  );

  const end = useCallback(
    (e: ReactPointerEvent) => {
      try {
        overlayRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag.current = null;
      setActive(false);
      emitGuides([]);
    },
    [emitGuides],
  );

  const handles = resize === 'free' ? FREE_HANDLES : CORNER_HANDLES;
  const degrees = (transform.rotation * 180) / Math.PI;

  return (
    <div ref={overlayRef} onPointerMove={move} onPointerUp={end} className="absolute inset-0 z-20 touch-none">
      <div
        onPointerDown={(e) => begin(e, 'move')}
        className="absolute cursor-move"
        style={{
          left: `${transform.x * 100}%`,
          top: `${transform.y * 100}%`,
          width: `${transform.w * 100}%`,
          height: `${transform.h * 100}%`,
          transform: `rotate(${degrees}deg)`,
          transformOrigin: 'center',
          border: `2px solid ${color}`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
        }}
      >
        {/* rotate handle + stem */}
        <div className="absolute left-1/2 -top-7 -translate-x-1/2 w-px h-7" style={{ background: color }} />
        <div
          onPointerDown={(e) => begin(e, 'rotate')}
          title="Rotate"
          className="absolute left-1/2 -top-7 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white cursor-grab"
          style={{ border: `1.5px solid ${color}` }}
        />
        {handles.map((mode) => {
          const h = HDEF[mode];
          return (
            <div
              key={mode}
              onPointerDown={(e) => begin(e, mode)}
              className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm"
              style={{ left: h.left, top: h.top, cursor: h.cursor, border: `1px solid ${color}` }}
            />
          );
        })}
        {active && drag.current?.mode === 'rotate' && (
          <div className="absolute left-1/2 -top-12 -translate-x-1/2 text-[9px] px-1 rounded bg-black/70 text-white whitespace-nowrap pointer-events-none">
            {Math.round(((degrees % 360) + 360) % 360)}°
          </div>
        )}
      </div>
    </div>
  );
}
