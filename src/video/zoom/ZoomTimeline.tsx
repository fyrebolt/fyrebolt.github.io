import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ZoomKeyframe } from './types';
import { sortedZooms } from './types';

const MIN_DURATION = 0.1; // seconds

const TRANSITION_COLOR = '#a78bfa'; // violet
const HOLDING_COLOR = 'rgba(167,139,250,0.28)';

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(Math.max(min, max), v));
}

type DragMode = 'start' | 'dur';

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  orig: ZoomKeyframe;
}

interface Props {
  duration: number;
  keyframes: ZoomKeyframe[];
  currentSec: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string, patch: Partial<ZoomKeyframe>) => void;
  onScrub: (sec: number) => void;
}

/**
 * Single Zoom track: each keyframe is a start marker + a transition segment
 * (draggable width = transition duration) + a derived "holding" segment that
 * fills to the next keyframe's start (or the end of the video).
 */
export default function ZoomTimeline({
  duration,
  keyframes,
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
    (e: ReactPointerEvent, kf: ZoomKeyframe, mode: DragMode) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelect(kf.id);
      drag.current = { id: kf.id, mode, startX: e.clientX, orig: kf };
    },
    [onSelect],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      if (d.mode === 'start') {
        onEdit(d.id, { start: clamp(0, dur - MIN_DURATION, d.orig.start + delta) });
      } else {
        onEdit(d.id, { duration: clamp(MIN_DURATION, dur - d.orig.start, d.orig.duration + delta) });
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
  const sorted = sortedZooms(keyframes);

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

      {/* Zoom row */}
      <div className="relative h-8 rounded-md bg-[var(--color-bg-elevated)] overflow-hidden">
        <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
        {sorted.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]">
            No zooms yet — add one to place it on the timeline.
          </div>
        )}
        {sorted.map((kf, i) => {
          const end = kf.start + kf.duration;
          const nextStart = i + 1 < sorted.length ? sorted[i + 1].start : dur;
          const holdEnd = Math.max(end, nextStart);
          const selected = kf.id === selectedId;
          const startPct = (kf.start / dur) * 100;
          const transW = (kf.duration / dur) * 100;
          const holdW = (Math.max(0, holdEnd - end) / dur) * 100;
          return (
            <div key={kf.id} className="absolute top-0 bottom-0" style={{ left: `${startPct}%` }}>
              {/* transition segment (drag body = move start) */}
              <div
                onPointerDown={(e) => onDown(e, kf, 'start')}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className={`absolute top-0 bottom-0 rounded-sm flex items-center justify-center cursor-grab active:cursor-grabbing touch-none ${
                  selected ? 'ring-2 ring-[var(--color-primary-green)] z-20' : 'z-10'
                }`}
                style={{ left: 0, width: `${Math.max(1.5, transW)}%`, background: TRANSITION_COLOR }}
                title="Drag to move · right edge sets transition time"
              >
                <span className="text-[9px] font-bold text-black/70 pointer-events-none">⤢ {i + 1}</span>
                {/* transition-end handle (drag = duration) */}
                <div
                  onPointerDown={(e) => onDown(e, kf, 'dur')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-sm touch-none"
                />
              </div>
              {/* holding segment (derived; click to select) */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(kf.id);
                }}
                className="absolute top-0 bottom-0"
                style={{ left: `${transW}%`, width: `${holdW}%`, background: HOLDING_COLOR }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
