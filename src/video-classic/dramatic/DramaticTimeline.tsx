import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DramaticWord } from './types';
import { elementEnd } from './types';

const MIN_DURATION = 0.2;

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(Math.max(min, max), v));
}

type DragMode = 'move' | 'end';
interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  orig: DramaticWord;
  prevEnd: number;
  nextStart: number;
}

interface Props {
  duration: number;
  words: DramaticWord[];
  currentSec: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string, patch: Partial<DramaticWord>) => void;
  onScrub: (sec: number) => void;
}

/**
 * Single-track timeline: words are non-overlapping segments (only one effect is
 * ever active). Drag the body to move (clamped between neighbours), the right
 * edge to resize the hold; the fade-in / fade-out are shaded at each end.
 */
export default function DramaticTimeline({
  duration,
  words,
  currentSec,
  selectedId,
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
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur;
    },
    [dur],
  );
  const fracFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return (clientX - r.left) / r.width;
  }, []);

  const onDown = useCallback(
    (e: ReactPointerEvent, w: DramaticWord, mode: DragMode) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelect(w.id);
      const others = words.filter((o) => o.id !== w.id);
      let prevEnd = 0;
      let nextStart = dur;
      for (const o of others) {
        if (o.start <= w.start && elementEnd(o) <= elementEnd(w)) prevEnd = Math.max(prevEnd, elementEnd(o));
        if (o.start >= elementEnd(w) || o.start > w.start) nextStart = Math.min(nextStart, o.start);
      }
      drag.current = { id: w.id, mode, startX: e.clientX, orig: w, prevEnd, nextStart };
    },
    [words, dur, onSelect],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      if (d.mode === 'move') {
        const maxStart = Math.max(d.prevEnd, d.nextStart - d.orig.duration);
        onEdit(d.id, { start: clamp(d.prevEnd, maxStart, d.orig.start + delta) });
      } else {
        const maxDur = Math.max(MIN_DURATION, d.nextStart - d.orig.start);
        onEdit(d.id, { duration: clamp(MIN_DURATION, maxDur, d.orig.duration + delta) });
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

  const playLeft = `${Math.min(100, Math.max(0, (currentSec / dur) * 100))}%`;

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

      <div className="relative h-9 rounded-md bg-[var(--color-bg-elevated)] overflow-hidden">
        {words.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]">
            No words yet — add one to place it on the timeline.
          </div>
        )}
        {words.map((w) => {
          const leftPct = (w.start / dur) * 100;
          const widthPct = (w.duration / dur) * 100;
          const selected = w.id === selectedId;
          const inF = Math.max(0, Math.min(1, w.fadeIn / Math.max(0.001, w.duration)));
          const outF = Math.max(0, Math.min(1, w.fadeOut / Math.max(0.001, w.duration)));
          const bg = w.mode === 'inverse' ? '#6b7280' : '#a3bffa';
          const label = (w.text || 'word').toUpperCase();
          return (
            <div
              key={w.id}
              onPointerDown={(e) => onDown(e, w, 'move')}
              onPointerMove={onMove}
              onPointerUp={onUp}
              className={`absolute top-1 bottom-1 rounded-sm flex items-center px-2 overflow-hidden cursor-grab active:cursor-grabbing touch-none ${
                selected ? 'ring-2 ring-[var(--color-primary-green)] z-20' : 'z-10'
              }`}
              style={{ left: `${leftPct}%`, width: `${Math.max(2, widthPct)}%`, background: bg }}
              title={`${w.mode} · ${label}`}
            >
              <div className="absolute inset-y-0 left-0 pointer-events-none bg-white/40" style={{ width: `${inF * 100}%` }} />
              <div className="absolute inset-y-0 right-0 pointer-events-none bg-black/25" style={{ width: `${outF * 100}%` }} />
              <span className="relative text-[10px] font-bold text-black/75 whitespace-nowrap truncate pointer-events-none">
                {w.mode === 'inverse' ? '◱ ' : '▤ '}{label}
              </span>
              <div
                onPointerDown={(e) => onDown(e, w, 'end')}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className="absolute right-0 top-0 bottom-0 w-1.5 bg-black/40 hover:bg-black/70 cursor-ew-resize touch-none z-30"
              />
            </div>
          );
        })}
        <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.7)] pointer-events-none z-30" style={{ left: playLeft }} />
      </div>
    </div>
  );
}
