import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Caption, CaptionEl, TypewriterCaption } from './types';
import { elementEnd } from './types';

const MIN_DURATION = 0.2; // seconds

const PHASE_COLORS = { typing: '#6ee7b7', hold: '#93c5fd', del: '#fca5a5' };

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(Math.max(min, max), v));
}

type DragMode = 'start' | 'end' | 'body' | 'div1' | 'div2';

interface DragState {
  mode: DragMode;
  startX: number;
  orig: CaptionEl;
}

type EditPatch = Partial<Caption> | Partial<TypewriterCaption>;

interface Props {
  duration: number;
  captions: CaptionEl[];
  currentSec: number;
  selectedId: string | null;
  rowColor: (index: number) => string;
  onSelect: (id: string) => void;
  onEdit: (id: string, patch: EditPatch) => void;
  onScrub: (sec: number) => void;
}

/**
 * Multi-track timeline: a scrub ruler plus one row per element. Boil captions
 * are a single draggable range; typewriter captions are a range subdivided into
 * typing / hold / (deletion) segments with two internal drag dividers.
 */
export default function MultiTrackTimeline({
  duration,
  captions,
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
    (e: ReactPointerEvent, cap: CaptionEl, mode: DragMode) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelect(cap.id);
      drag.current = { mode, startX: e.clientX, orig: cap };
    },
    [onSelect],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      const o = d.orig;

      if (o.kind === 'boil') {
        if (d.mode === 'start') onEdit(o.id, { start: clamp(0, o.end - MIN_DURATION, o.start + delta) });
        else if (d.mode === 'end') onEdit(o.id, { end: clamp(o.start + MIN_DURATION, dur, o.end + delta) });
        else {
          const len = o.end - o.start;
          const s = clamp(0, dur - len, o.start + delta);
          onEdit(o.id, { start: s, end: s + len });
        }
        return;
      }

      // typewriter
      const del = o.deleteEnabled ? o.deleteDur : 0;
      const total = o.typingDur + o.holdDur + del;
      if (d.mode === 'body' || d.mode === 'start') {
        onEdit(o.id, { start: clamp(0, dur - total, o.start + delta) });
      } else if (d.mode === 'end') {
        if (o.deleteEnabled) {
          const maxDel = dur - o.start - o.typingDur - o.holdDur;
          onEdit(o.id, { deleteDur: clamp(MIN_DURATION, maxDel, o.deleteDur + delta) });
        } else {
          const maxHold = dur - o.start - o.typingDur;
          onEdit(o.id, { holdDur: clamp(MIN_DURATION, maxHold, o.holdDur + delta) });
        }
      } else if (d.mode === 'div1') {
        const rest = o.holdDur + del;
        const maxT = dur - o.start - rest;
        onEdit(o.id, { typingDur: clamp(MIN_DURATION, maxT, o.typingDur + delta) });
      } else if (d.mode === 'div2') {
        const maxH = dur - o.start - o.typingDur - del;
        onEdit(o.id, { holdDur: clamp(MIN_DURATION, maxH, o.holdDur + delta) });
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
        <div className="absolute inset-y-0 left-0 rounded-l-md bg-[rgba(116,185,255,0.18)]" style={{ width: playLeft }} />
        <div className="absolute top-0 bottom-0 w-[2px] bg-[var(--color-primary-blue)]" style={{ left: playLeft }} />
      </div>

      {/* Element rows */}
      <div className="space-y-1.5">
        {captions.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] py-2 text-center">
            No elements yet — add a caption or a typewriter to place it on the timeline.
          </div>
        )}
        {captions.map((cap, i) => {
          const start = cap.start;
          const end = elementEnd(cap);
          const leftPct = (start / dur) * 100;
          const widthPct = ((end - start) / dur) * 100;
          const selected = cap.id === selectedId;
          const label = cap.text.split('\n')[0] || (cap.kind === 'typewriter' ? 'typewriter' : 'caption');
          const ringClass = selected ? 'ring-2 ring-[var(--color-primary-green)]' : '';

          // typewriter phase splits, as fractions of the element's own length
          const total = Math.max(0.001, end - start);
          const typingF = cap.kind === 'typewriter' ? cap.typingDur / total : 0;
          const holdF = cap.kind === 'typewriter' ? cap.holdDur / total : 0;
          const div1Left = `${typingF * 100}%`;
          const div2Left = `${(typingF + holdF) * 100}%`;

          return (
            <div key={cap.id} className="relative h-8 rounded-md bg-[var(--color-bg-elevated)]">
              {/* playhead across rows */}
              <div
                className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10"
                style={{ left: playLeft }}
              />
              <div
                onPointerDown={(e) => onDown(e, cap, 'body')}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className={`absolute top-0 bottom-0 rounded-md flex items-center px-2 cursor-grab active:cursor-grabbing touch-none overflow-hidden ${ringClass}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${Math.max(1.5, widthPct)}%`,
                  background: cap.kind === 'typewriter' ? 'transparent' : rowColor(i),
                }}
              >
                {cap.kind === 'typewriter' && (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 pointer-events-none"
                      style={{ width: div1Left, background: PHASE_COLORS.typing }}
                    />
                    <div
                      className="absolute inset-y-0 pointer-events-none"
                      style={{ left: div1Left, width: `${holdF * 100}%`, background: PHASE_COLORS.hold }}
                    />
                    {cap.deleteEnabled && (
                      <div
                        className="absolute inset-y-0 right-0 pointer-events-none"
                        style={{ left: div2Left, background: PHASE_COLORS.del }}
                      />
                    )}
                  </>
                )}

                <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">
                  {cap.kind === 'typewriter' ? `⌨ ${label}` : label}
                </span>

                {/* start / end handles */}
                <div
                  onPointerDown={(e) => onDown(e, cap, 'start')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute left-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-l-md touch-none z-20"
                />
                <div
                  onPointerDown={(e) => onDown(e, cap, 'end')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20"
                />

                {/* typewriter internal dividers */}
                {cap.kind === 'typewriter' && (
                  <>
                    <div
                      onPointerDown={(e) => onDown(e, cap, 'div1')}
                      onPointerMove={onMove}
                      onPointerUp={onUp}
                      className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-black/50 hover:bg-black/80 cursor-ew-resize touch-none z-20"
                      style={{ left: div1Left }}
                    />
                    {cap.deleteEnabled && (
                      <div
                        onPointerDown={(e) => onDown(e, cap, 'div2')}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-black/50 hover:bg-black/80 cursor-ew-resize touch-none z-20"
                        style={{ left: div2Left }}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
