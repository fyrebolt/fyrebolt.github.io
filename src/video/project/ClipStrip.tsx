// ===== Clip strip: the base sequence as reorderable, trimmable cards =====
//
// One card per clip, in sequence order. Each card is a mini-trimmer: a track
// spanning the clip's source length with draggable in/out handles (image clips
// have no in-point, so only the out/length handle shows). A grip drags the card
// left/right to reorder; the final index is applied on release (one undo step).
// Trim drags stream continuous onTrim calls, which the history coalesces.

import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { VideoClip } from './clips';
import { clipLen, MIN_CLIP_LEN } from './clips';

const CARD_W = 150; // px, fixed
const CARD_GAP = 8; // px, must match the flex gap below
const TRACK_H = 26;

interface Props {
  clips: VideoClip[];
  selectedClipId: string | null;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onTrim: (id: string, patch: { in?: number; out?: number }) => void;
  onAddClip: () => void;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  return `${sec.toFixed(1)}s`;
}

/** Friendly track span for a clip: the video's full length, or a soft image range. */
function trackMax(c: VideoClip): number {
  return c.kind === 'image' ? Math.max(20, Math.ceil(c.out + 4)) : Math.max(MIN_CLIP_LEN, c.srcDuration);
}

type TrimEdge = 'in' | 'out';

export default function ClipStrip({
  clips,
  selectedClipId,
  onSelect,
  onReorder,
  onRemove,
  onTrim,
  onAddClip,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragDx, setDragDx] = useState(0);
  const drag = useRef<{ id: string; from: number; startX: number } | null>(null);
  const trim = useRef<{ id: string; edge: TrimEdge; startX: number; max: number; trackW: number; origIn: number; origOut: number } | null>(null);

  const total = useMemo(() => clips.reduce((s, c) => s + clipLen(c), 0), [clips]);

  // ---- reorder (grip drag) ----
  const onGripDown = useCallback(
    (e: ReactPointerEvent, clip: VideoClip, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { id: clip.id, from: index, startX: e.clientX };
      setDragId(clip.id);
      setDragDx(0);
    },
    [],
  );
  const onGripMove = useCallback((e: ReactPointerEvent) => {
    if (!drag.current) return;
    setDragDx(e.clientX - drag.current.startX);
  }, []);
  const onGripUp = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      drag.current = null;
      setDragId(null);
      setDragDx(0);
      if (!d) return;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      const stride = CARD_W + CARD_GAP;
      const delta = Math.round((e.clientX - d.startX) / stride);
      const to = Math.max(0, Math.min(clips.length - 1, d.from + delta));
      if (to !== d.from) onReorder(d.from, to);
    },
    [clips.length, onReorder],
  );

  // ---- trim (handle drag) ----
  const onTrimDown = useCallback(
    (e: ReactPointerEvent, clip: VideoClip, edge: TrimEdge, trackW: number) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      trim.current = {
        id: clip.id,
        edge,
        startX: e.clientX,
        max: trackMax(clip),
        trackW,
        origIn: clip.in,
        origOut: clip.out,
      };
    },
    [],
  );
  const onTrimMove = useCallback(
    (e: ReactPointerEvent) => {
      const t = trim.current;
      if (!t) return;
      const perPx = t.max / Math.max(1, t.trackW);
      const dSec = (e.clientX - t.startX) * perPx;
      if (t.edge === 'in') onTrim(t.id, { in: t.origIn + dSec });
      else onTrim(t.id, { out: t.origOut + dSec });
    },
    [onTrim],
  );
  const onTrimUp = useCallback((e: ReactPointerEvent) => {
    trim.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  if (clips.length === 0) return null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto py-1">
      {clips.map((clip, i) => {
        const max = trackMax(clip);
        const inFrac = Math.max(0, Math.min(1, clip.in / max));
        const outFrac = Math.max(0, Math.min(1, clip.out / max));
        const selected = clip.id === selectedClipId;
        const dragging = dragId === clip.id;
        return (
          <div
            key={clip.id}
            style={{
              width: CARD_W,
              transform: dragging ? `translateX(${dragDx}px)` : undefined,
              zIndex: dragging ? 10 : undefined,
            }}
            className={`relative shrink-0 rounded-md border ${
              selected ? 'border-[var(--color-primary-green)]' : 'border-[var(--color-border)]'
            } bg-[var(--color-bg-elevated)] px-2 py-1.5 ${dragging ? 'opacity-80 shadow-lg' : ''}`}
            onClick={() => onSelect(clip.id)}
          >
            <div className="flex items-center gap-1">
              <span
                onPointerDown={(e) => onGripDown(e, clip, i)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                title="Drag to reorder"
                className="cursor-grab select-none text-[var(--color-text-muted)] text-xs leading-none touch-none"
              >
                ⠿
              </span>
              <span className="flex-1 truncate text-[11px] font-medium text-[var(--color-text-secondary)]" title={clip.name}>
                {clip.kind === 'video' ? '🎬' : '🖼️'} {clip.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(clip.id);
                }}
                title="Remove clip"
                className="text-[var(--color-text-muted)] hover:text-[var(--color-primary-red,#ef4444)] text-xs leading-none"
              >
                ✕
              </button>
            </div>

            {/* mini-trimmer track (source length; highlighted = kept span) */}
            <TrimTrack
              clip={clip}
              inFrac={inFrac}
              outFrac={outFrac}
              onTrimDown={onTrimDown}
              onTrimMove={onTrimMove}
              onTrimUp={onTrimUp}
            />

            <div className="mt-1 flex justify-between text-[10px] text-[var(--color-text-muted)]">
              <span>#{i + 1}</span>
              <span>{fmt(clipLen(clip))}</span>
            </div>
          </div>
        );
      })}

      {/* add-clip tile */}
      <button
        onClick={onAddClip}
        style={{ width: 64 }}
        className="shrink-0 rounded-md border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary-green)] hover:text-[var(--color-primary-green)] flex flex-col items-center justify-center text-xs"
        title="Add another clip"
      >
        <span className="text-lg leading-none">＋</span>
        <span className="mt-0.5">Clip</span>
      </button>

      <div className="shrink-0 self-center pl-1 text-[10px] text-[var(--color-text-muted)]">
        {clips.length} clip{clips.length === 1 ? '' : 's'} · {fmt(total)}
      </div>
    </div>
  );
}

function TrimTrack({
  clip,
  inFrac,
  outFrac,
  onTrimDown,
  onTrimMove,
  onTrimUp,
}: {
  clip: VideoClip;
  inFrac: number;
  outFrac: number;
  onTrimDown: (e: ReactPointerEvent, clip: VideoClip, edge: TrimEdge, trackW: number) => void;
  onTrimMove: (e: ReactPointerEvent) => void;
  onTrimUp: (e: ReactPointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const w = () => ref.current?.clientWidth ?? 1;
  const handle = (edge: TrimEdge) => (e: ReactPointerEvent) => onTrimDown(e, clip, edge, w());
  return (
    <div
      ref={ref}
      style={{ height: TRACK_H }}
      className="relative mt-1 rounded bg-[var(--color-bg-surface)] overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* kept span */}
      <div
        className="absolute inset-y-0 bg-[var(--color-primary-green)]/30 border-x-2 border-[var(--color-primary-green)]"
        style={{ left: `${inFrac * 100}%`, right: `${(1 - outFrac) * 100}%` }}
      />
      {/* in handle (video only — a still has no start point) */}
      {clip.kind === 'video' && (
        <div
          onPointerDown={handle('in')}
          onPointerMove={onTrimMove}
          onPointerUp={onTrimUp}
          title="Trim start"
          className="absolute inset-y-0 w-3 -ml-1.5 cursor-ew-resize touch-none"
          style={{ left: `${inFrac * 100}%` }}
        />
      )}
      {/* out / length handle */}
      <div
        onPointerDown={handle('out')}
        onPointerMove={onTrimMove}
        onPointerUp={onTrimUp}
        title={clip.kind === 'image' ? 'Set length' : 'Trim end'}
        className="absolute inset-y-0 w-3 -ml-1.5 cursor-ew-resize touch-none"
        style={{ left: `${outFrac * 100}%` }}
      />
    </div>
  );
}
