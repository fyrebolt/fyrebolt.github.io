import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Highlighter } from './types';
import { elementEnd } from './types';

const MIN_DURATION = 0.2; // seconds

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(Math.max(min, max), v));
}

type DragMode = 'body' | 'start' | 'end';

interface Props {
  duration: number;
  elements: Highlighter[];
  currentSec: number;
  selectedId: string | null;
  rowColor: (index: number) => string;
  onSelect: (id: string) => void;
  onEdit: (id: string, patch: Partial<Highlighter>) => void;
  onScrub: (sec: number) => void;
}

/**
 * Multi-track timeline for highlighter boxes: a scrub ruler plus one draggable
 * row each, split into sweep-in / hold / sweep-out segments for feedback. Drag
 * the body to move, the edges to resize the duration.
 */
export default function HighlightTimeline({
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
  const drag = useRef<{ mode: DragMode; startX: number; orig: Highlighter } | null>(null);
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
    (e: ReactPointerEvent, hl: Highlighter, mode: DragMode) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelect(hl.id);
      drag.current = { mode, startX: e.clientX, orig: hl };
    },
    [onSelect],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      const o = d.orig;
      const end = o.start + o.duration;
      if (d.mode === 'body') {
        onEdit(o.id, { start: clamp(0, dur - o.duration, o.start + delta) });
      } else if (d.mode === 'start') {
        const newStart = clamp(0, end - MIN_DURATION, o.start + delta);
        onEdit(o.id, { start: newStart, duration: end - newStart });
      } else {
        const newEnd = clamp(o.start + MIN_DURATION, dur, end + delta);
        onEdit(o.id, { duration: newEnd - o.start });
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
            No highlighters yet — add one to place it on the timeline.
          </div>
        )}
        {elements.map((hl, i) => {
          const start = hl.start;
          const end = elementEnd(hl);
          const leftPct = (start / dur) * 100;
          const widthPct = ((end - start) / dur) * 100;
          const selected = hl.id === selectedId;
          const ringClass = selected ? 'ring-2 ring-[var(--color-primary-green)]' : '';
          const total = Math.max(0.001, hl.duration);
          const inF = Math.max(0, Math.min(1, hl.sweepIn / total));
          const outF = Math.max(0, Math.min(1 - inF, hl.sweepOut / total));

          return (
            <div key={hl.id} className="relative h-8 rounded-md bg-[var(--color-bg-elevated)]">
              <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
              <div
                onPointerDown={(e) => onDown(e, hl, 'body')}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className={`absolute top-0 bottom-0 rounded-md flex items-center px-2 cursor-grab active:cursor-grabbing touch-none overflow-hidden ${ringClass}`}
                style={{ left: `${leftPct}%`, width: `${Math.max(1.5, widthPct)}%`, background: rowColor(i) }}
              >
                {/* sweep-in / sweep-out shading */}
                <div className="absolute inset-y-0 left-0 pointer-events-none bg-white/35" style={{ width: `${inF * 100}%` }} />
                <div className="absolute inset-y-0 right-0 pointer-events-none bg-black/25" style={{ width: `${outF * 100}%` }} />
                <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">
                  🖍️ highlighter
                </span>
                <div
                  onPointerDown={(e) => onDown(e, hl, 'start')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute left-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-l-md touch-none z-20"
                />
                <div
                  onPointerDown={(e) => onDown(e, hl, 'end')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
