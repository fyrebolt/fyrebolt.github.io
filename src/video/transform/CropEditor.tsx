import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CropRect } from '../sticker/types';

// ===== Shared crop-rectangle editor (stickers and clips) =====
//
// The Zoom tool's rect pattern (8 handles + body drag, source-normalised coords),
// but scoped to ONE object's OWN source: it chooses which part of that source
// shows inside the object's frame box. Both stickers and base clips use it — they
// differ only in how the owning object stores the box, which the caller patches.
//
// The full source is pinned on the canvas at a fixed "anchor" area, reconstructed
// from the frame box + current crop so that the crop region lands exactly on the
// frame box. Because that anchor is invariant under our own edits (the frame box
// is re-derived from the crop each change), the source stays put while the user
// drags the crop window over it. Every change rewrites BOTH the crop and the
// frame box, keeping the box aspect-locked to the crop (no distortion) — the same
// result the compositor draws.

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

const MIN = 0.05; // min crop size (source-normalised)

/** The frame box (output-normalised) plus the crop it currently shows. */
export interface CropTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  crop: CropRect;
}

interface Props {
  el: CropTarget;
  /** The object's decoded source, used to show context behind the crop window. */
  media: HTMLImageElement | HTMLVideoElement | undefined;
  /** Both the new crop and the frame box it implies — always patched together. */
  onChange: (patch: CropTarget) => void;
}

interface CropDrag {
  mode: Mode;
  orig: CropRect;
  startSrc: { x: number; y: number };
}

export default function CropEditor({ el, media, onChange }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<CropDrag | null>(null);
  const [active, setActive] = useState(false);

  // The sticker's full source area, in canvas fractions (0..1 of out). Invariant
  // under our edits, so the pinned source doesn't shift while cropping.
  const fullW = el.w / Math.max(1e-4, el.crop.w);
  const fullH = el.h / Math.max(1e-4, el.crop.h);
  const fullX = el.x - el.crop.x * fullW;
  const fullY = el.y - el.crop.y * fullH;

  const toSrc = useCallback(
    (clientX: number, clientY: number) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const cfx = (clientX - rect.left) / rect.width;
      const cfy = (clientY - rect.top) / rect.height;
      return { x: (cfx - fullX) / fullW, y: (cfy - fullY) / fullH };
    },
    [fullX, fullY, fullW, fullH],
  );

  /** Emit a crop rect (clamped to the source) plus the frame box it implies. */
  const commit = useCallback(
    (left: number, top: number, right: number, bottom: number) => {
      const x = Math.max(0, Math.min(1 - MIN, left));
      const y = Math.max(0, Math.min(1 - MIN, top));
      const w = Math.max(MIN, Math.min(1 - x, right - left));
      const h = Math.max(MIN, Math.min(1 - y, bottom - top));
      const crop = { x, y, w, h };
      onChange({
        crop,
        x: fullX + x * fullW,
        y: fullY + y * fullH,
        w: w * fullW,
        h: h * fullH,
      });
    },
    [onChange, fullX, fullY, fullW, fullH],
  );

  const begin = useCallback(
    (e: ReactPointerEvent, mode: Mode) => {
      e.stopPropagation();
      try {
        overlayRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag.current = { mode, orig: el.crop, startSrc: toSrc(e.clientX, e.clientY) };
      setActive(true);
    },
    [el.crop, toSrc],
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
        const w = right - left;
        const h = bottom - top;
        left = Math.max(0, Math.min(1 - w, d.orig.x + dx));
        top = Math.max(0, Math.min(1 - h, d.orig.y + dy));
        right = left + w;
        bottom = top + h;
      } else {
        if (d.mode.includes('w')) left = Math.min(right - MIN, d.orig.x + dx);
        if (d.mode.includes('e')) right = Math.max(left + MIN, d.orig.x + d.orig.w + dx);
        if (d.mode.includes('n')) top = Math.min(bottom - MIN, d.orig.y + dy);
        if (d.mode.includes('s')) bottom = Math.max(top + MIN, d.orig.y + d.orig.h + dy);
      }
      commit(left, top, right, bottom);
    },
    [toSrc, commit],
  );

  const end = useCallback((e: ReactPointerEvent) => {
    try {
      overlayRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
    setActive(false);
  }, []);

  // Anchor rect + crop box in canvas percentages.
  const srcLeft = fullX * 100;
  const srcTop = fullY * 100;
  const srcW = fullW * 100;
  const srcH = fullH * 100;
  const boxLeft = (fullX + el.crop.x * fullW) * 100;
  const boxTop = (fullY + el.crop.y * fullH) * 100;
  const boxW = el.crop.w * fullW * 100;
  const boxH = el.crop.h * fullH * 100;
  const srcUrl = media instanceof HTMLImageElement ? media.src : media?.currentSrc || (media as HTMLVideoElement | undefined)?.src;

  return (
    <div ref={overlayRef} onPointerMove={move} onPointerUp={end} className="absolute inset-0 z-30 touch-none overflow-hidden rounded-lg">
      {/* pinned full source (context outside the crop); outside is dimmed by the
          crop box's spotlight shadow below */}
      <div
        className="absolute overflow-hidden pointer-events-none rounded-sm ring-1 ring-white/20"
        style={{ left: `${srcLeft}%`, top: `${srcTop}%`, width: `${srcW}%`, height: `${srcH}%` }}
      >
        {srcUrl && media instanceof HTMLImageElement && (
          <img src={srcUrl} alt="" className="w-full h-full object-fill opacity-45" draggable={false} />
        )}
        {srcUrl && media instanceof HTMLVideoElement && (
          <video src={srcUrl} muted playsInline className="w-full h-full object-fill opacity-45" />
        )}
      </div>

      {/* the crop rectangle */}
      <div
        onPointerDown={(e) => begin(e, 'move')}
        className="absolute border-2 border-[var(--color-primary-green)] cursor-move"
        style={{
          left: `${boxLeft}%`,
          top: `${boxTop}%`,
          width: `${boxW}%`,
          height: `${boxH}%`,
          boxShadow: '0 0 0 100vmax rgba(0,0,0,0.35)',
        }}
      >
        {active && (
          <div className="absolute -top-5 left-0 text-[9px] px-1 rounded bg-[var(--color-primary-green)] text-black font-bold whitespace-nowrap pointer-events-none">
            crop
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
