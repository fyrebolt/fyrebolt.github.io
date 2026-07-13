import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Caption } from './types';

const MIN_DURATION = 0.2; // seconds

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type DragMode = 'start' | 'end' | 'body';

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  origStart: number;
  origEnd: number;
}

interface Props {
  duration: number;
  captions: Caption[];
  currentSec: number;
  selectedId: string | null;
  rowColor: (index: number) => string;
  onSelect: (id: string) => void;
  onChangeRange: (id: string, start: number, end: number) => void;
  onScrub: (sec: number) => void;
}

/**
 * Multi-track timeline: a scrub ruler plus one row per caption. Each caption
 * segment has independently draggable start/end handles; dragging the body
 * moves the whole segment, preserving its duration.
 */
export default function MultiTrackTimeline({
  duration,
  captions,
  currentSec,
  selectedId,
  rowColor,
  onSelect,
  onChangeRange,
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

  const onSegmentPointerDown = useCallback(
    (e: ReactPointerEvent, cap: Caption, mode: DragMode) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      onSelect(cap.id);
      drag.current = { id: cap.id, mode, startX: e.clientX, origStart: cap.start, origEnd: cap.end };
    },
    [onSelect],
  );

  const onSegmentPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const deltaSec = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      let { origStart: start, origEnd: end } = d;
      if (d.mode === 'start') {
        start = Math.max(0, Math.min(d.origEnd - MIN_DURATION, d.origStart + deltaSec));
      } else if (d.mode === 'end') {
        end = Math.min(dur, Math.max(d.origStart + MIN_DURATION, d.origEnd + deltaSec));
      } else {
        const len = d.origEnd - d.origStart;
        start = Math.max(0, Math.min(dur - len, d.origStart + deltaSec));
        end = start + len;
      }
      onChangeRange(d.id, start, end);
    },
    [dur, fracFromClientX, onChangeRange],
  );

  const onSegmentPointerUp = useCallback((e: ReactPointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
  }, []);

  return (
    <div className="mt-4 select-none">
      {/* Scrub ruler */}
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
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-[rgba(116,185,255,0.18)]"
          style={{ width: `${Math.min(100, (currentSec / dur) * 100)}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-[var(--color-primary-blue)]"
          style={{ left: `${Math.min(100, (currentSec / dur) * 100)}%` }}
        />
      </div>

      {/* Caption rows */}
      <div className="space-y-1.5">
        {captions.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] py-2 text-center">
            No captions yet — add one to place it on the timeline.
          </div>
        )}
        {captions.map((cap, i) => {
          const leftPct = (cap.start / dur) * 100;
          const widthPct = ((cap.end - cap.start) / dur) * 100;
          const selected = cap.id === selectedId;
          const color = rowColor(i);
          return (
            <div key={cap.id} className="relative h-8 rounded-md bg-[var(--color-bg-elevated)]">
              {/* playhead across rows */}
              <div
                className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10"
                style={{ left: `${Math.min(100, (currentSec / dur) * 100)}%` }}
              />
              {/* segment */}
              <div
                onPointerDown={(e) => onSegmentPointerDown(e, cap, 'body')}
                onPointerMove={onSegmentPointerMove}
                onPointerUp={onSegmentPointerUp}
                className={`absolute top-0 bottom-0 rounded-md flex items-center px-2 cursor-grab active:cursor-grabbing touch-none overflow-hidden ${
                  selected ? 'ring-2 ring-[var(--color-primary-green)]' : ''
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${Math.max(1.5, widthPct)}%`,
                  background: color,
                }}
              >
                <span className="text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">
                  {cap.text.split('\n')[0] || 'caption'}
                </span>
                {/* start handle */}
                <div
                  onPointerDown={(e) => onSegmentPointerDown(e, cap, 'start')}
                  onPointerMove={onSegmentPointerMove}
                  onPointerUp={onSegmentPointerUp}
                  className="absolute left-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-l-md touch-none"
                />
                {/* end handle */}
                <div
                  onPointerDown={(e) => onSegmentPointerDown(e, cap, 'end')}
                  onPointerMove={onSegmentPointerMove}
                  onPointerUp={onSegmentPointerUp}
                  className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
