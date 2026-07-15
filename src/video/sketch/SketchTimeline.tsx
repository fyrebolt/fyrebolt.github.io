import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SketchElement } from './types';
import { elementEnd } from './types';

const MIN_FREEZE = 0.2; // seconds
const PHASE_COLORS = { animate: '#c4a7fb', freeze: '#93c5fd' };

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(Math.max(min, max), v));
}

type DragMode = 'start' | 'end' | 'body' | 'div1';

interface DragState {
  mode: DragMode;
  startX: number;
  orig: SketchElement;
}

interface Props {
  duration: number;
  elements: SketchElement[];
  currentSec: number;
  selectedId: string | null;
  rowColor: (index: number) => string;
  onSelect: (id: string) => void;
  onEdit: (id: string, patch: Partial<SketchElement>) => void;
  onScrub: (sec: number) => void;
}

/**
 * One row per sketch: a draggable range subdivided into an animation segment and
 * a freeze segment, with a single internal divider (animation ↔ freeze). Mirrors
 * the multi-track caption timeline's start/end/body/divider interaction model.
 */
export default function SketchTimeline({
  duration,
  elements,
  currentSec,
  selectedId,
  rowColor,
  onSelect,
  onEdit,
  onScrub,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const dur = Math.max(0.001, duration);

  const secFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * dur;
    },
    [dur],
  );

  const fracFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }, []);

  const onDown = useCallback(
    (e: ReactPointerEvent, el: SketchElement, mode: DragMode) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelect(el.id);
      drag.current = { mode, startX: e.clientX, orig: el };
    },
    [onSelect],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      const o = d.orig;
      const total = o.animationDur + o.freezeDur;

      if (d.mode === 'body' || d.mode === 'start') {
        onEdit(o.id, { start: clamp(0, dur - total, o.start + delta) });
      } else if (d.mode === 'end') {
        const maxFreeze = dur - o.start - o.animationDur;
        onEdit(o.id, { freezeDur: clamp(MIN_FREEZE, maxFreeze, o.freezeDur + delta) });
      } else if (d.mode === 'div1') {
        const maxAnim = dur - o.start - o.freezeDur;
        onEdit(o.id, { animationDur: clamp(0, maxAnim, o.animationDur + delta) });
      }
    },
    [dur, fracFromClientX, onEdit],
  );

  const onUp = useCallback((e: ReactPointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
  }, []);

  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / dur) * 100))}%`;
  const playLeft = pct(currentSec);

  return (
    <div className="mt-4 select-none">
      <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mb-1 font-mono">
        <span>0:00</span>
        <span>{fmt(currentSec)}</span>
        <span>{fmt(duration)}</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={(e) => onScrub(secFromClientX(e.clientX))}
        className="relative h-6 rounded-md bg-[var(--color-bg-elevated)] cursor-pointer touch-none mb-2"
      >
        <div className="absolute inset-y-0 left-0 rounded-l-md bg-[rgba(116,185,255,0.18)]" style={{ width: playLeft }} />
        <div className="absolute top-0 bottom-0 w-[2px] bg-[var(--color-primary-blue)]" style={{ left: playLeft }} />
      </div>

      <div className="space-y-1.5">
        {elements.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] py-2 text-center">
            No sketches yet — draw one and project it to place it on the timeline.
          </div>
        )}
        {elements.map((el, i) => {
          const start = el.start;
          const end = elementEnd(el);
          const leftPct = (start / dur) * 100;
          const widthPct = ((end - start) / dur) * 100;
          const selected = el.id === selectedId;
          const label = `sketch ${i + 1}`;
          const ringClass = selected ? 'ring-2 ring-[var(--color-primary-green)]' : '';

          const total = Math.max(0.001, end - start);
          const animF = el.animationDur / total;
          const div1Left = `${animF * 100}%`;

          return (
            <div key={el.id} className="relative h-8 rounded-md bg-[var(--color-bg-elevated)]">
              <div
                className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10"
                style={{ left: playLeft }}
              />
              <div
                onPointerDown={(e) => onDown(e, el, 'body')}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className={`absolute top-0 bottom-0 rounded-md flex items-center px-2 cursor-grab active:cursor-grabbing touch-none overflow-hidden ${ringClass}`}
                style={{ left: `${leftPct}%`, width: `${Math.max(1.5, widthPct)}%`, background: rowColor(i) }}
              >
                {/* animation segment */}
                <div
                  className="absolute inset-y-0 left-0 pointer-events-none"
                  style={{ width: div1Left, background: PHASE_COLORS.animate }}
                />
                {/* freeze segment */}
                <div
                  className="absolute inset-y-0 right-0 pointer-events-none"
                  style={{ left: div1Left, background: PHASE_COLORS.freeze }}
                />

                <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">
                  ✏ {label}
                </span>

                {/* start / end handles */}
                <div
                  onPointerDown={(e) => onDown(e, el, 'start')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute left-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-l-md touch-none z-20"
                />
                <div
                  onPointerDown={(e) => onDown(e, el, 'end')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20"
                />

                {/* animation ↔ freeze divider */}
                <div
                  onPointerDown={(e) => onDown(e, el, 'div1')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-black/50 hover:bg-black/80 cursor-ew-resize touch-none z-20"
                  style={{ left: div1Left }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
