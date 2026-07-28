// ===== Base-clip timeline lane (boundaries + waveform, shared axis) =====
//
// Shows the base sequence as a row IN the timeline (not a disconnected strip), so
// clip boundaries sit in the same visual context as the overlay layers and line
// up by eye. Each clip segment spans its OUTPUT-time extent (already warped by the
// caller) and draws its cached audio waveform underneath — the visual companion
// to the volume-automation curve. Trimming/reordering still live in ClipStrip.
//
// Clips may overlap in time, so the lane PACKS them into sub-rows: anything that
// would collide moves down a row, top-most (highest z) first. A sequential
// project never collides and therefore stays exactly one row tall, as before.
//
// Dragging a segment sideways moves that clip along the base clock — the gesture
// that puts two clips over each other in the first place. Its start/end lock to
// the same temporal anchors every other timeline drag uses (other clips' edges,
// the playhead) through the shared snap engine.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ClipKind } from './clips';
import { clipGlyph } from './clips';
import type { Waveform } from './waveform';
import { getWaveform, waveformPolygon } from './waveform';
import type { GuideSettings, TimeSnapTarget } from '../transform/snapEngine';
import { snapTime } from '../transform/snapEngine';

export interface ClipExtent {
  id: string;
  srcId: string;
  name: string;
  kind: ClipKind;
  /** Trim in/out in SOURCE seconds (for slicing the waveform). */
  inSec: number;
  outSec: number;
  /** OUTPUT-time extent of the clip on the shared timeline. */
  start: number;
  end: number;
  /** Paint order where clips overlap (higher draws on top). */
  z: number;
}

const H = 44; // row height, px
const ROW_GAP = 2;
/** Pointer travel (px) before a press on a segment becomes a move rather than a click. */
const DRAG_SLOP = 3;

interface Props {
  extents: ClipExtent[];
  duration: number;
  currentSec: number;
  selectedClipId: string | null;
  guideSettings: GuideSettings;
  getClipBlob: (srcId: string) => Blob | undefined;
  onSelectClip: (id: string) => void;
  /** Move a clip so it starts at this OUTPUT second (streamed during the drag). */
  onMoveClip: (id: string, outputStart: number) => void;
}

const CLIP_COLORS = ['rgba(116,185,255,0.20)', 'rgba(139,233,199,0.20)', 'rgba(255,234,167,0.18)', 'rgba(255,159,243,0.18)'];

/**
 * Assign each clip a sub-row so no two overlapping clips share one. Highest z
 * first, so the clip that draws on top also sits on top here; each takes the
 * first row it fits in. Everything lands in row 0 when nothing overlaps.
 */
function packRows(extents: ClipExtent[]): Map<string, number> {
  const rows: { start: number; end: number }[][] = [];
  const at = new Map<string, number>();
  const order = extents.slice().sort((a, b) => b.z - a.z || a.start - b.start);
  for (const e of order) {
    let row = 0;
    while (rows[row]?.some((s) => e.start < s.end - 1e-4 && e.end > s.start + 1e-4)) row += 1;
    (rows[row] ??= []).push({ start: e.start, end: e.end });
    at.set(e.id, row);
  }
  return at;
}

export default function ClipLane({
  extents,
  duration,
  currentSec,
  selectedClipId,
  guideSettings,
  getClipBlob,
  onSelectClip,
  onMoveClip,
}: Props) {
  const dur = Math.max(0.001, duration);
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / dur) * 100))}%`;
  const playLeft = pct(currentSec);
  const laneRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; startX: number; origStart: number; len: number; moved: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const rowOf = packRows(extents);
  const rowCount = Math.max(1, ...[...rowOf.values()].map((r) => r + 1));

  const onDown = useCallback(
    (e: ReactPointerEvent, c: ClipExtent) => {
      e.stopPropagation();
      onSelectClip(c.id);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* synthetic / already-released pointer — safe to ignore */
      }
      drag.current = { id: c.id, startX: e.clientX, origStart: c.start, len: c.end - c.start, moved: false };
    },
    [onSelectClip],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
      if (!d.moved) {
        d.moved = true;
        setDragId(d.id);
      }
      const width = laneRef.current?.getBoundingClientRect().width ?? 1;
      const perPx = dur / Math.max(1, width);
      let start = Math.max(0, d.origStart + dx * perPx);

      // Lock the moving clip's own start OR end to the usual temporal anchors.
      const targets: TimeSnapTarget[] = [];
      for (const o of extents) {
        if (o.id === d.id) continue;
        targets.push({ t: o.start, kind: 'clip' }, { t: o.end, kind: 'clip' });
      }
      targets.push({ t: 0, kind: 'clip' }, { t: currentSec, kind: 'playhead' });
      const threshold = 6 * perPx;
      const byStart = snapTime(start, targets, threshold, guideSettings);
      const byEnd = snapTime(start + d.len, targets, threshold, guideSettings);
      if (byStart.hit) start = byStart.t;
      else if (byEnd.hit) start = Math.max(0, byEnd.t - d.len);

      onMoveClip(d.id, start);
    },
    [dur, extents, currentSec, guideSettings, onMoveClip],
  );

  const onUp = useCallback((e: ReactPointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
    setDragId(null);
  }, []);

  // A pointer released outside the lane (or cancelled) must not leave a stuck drag.
  useEffect(() => {
    const clear = () => {
      drag.current = null;
      setDragId(null);
    };
    window.addEventListener('pointercancel', clear);
    return () => window.removeEventListener('pointercancel', clear);
  }, []);

  return (
    <div
      ref={laneRef}
      className="relative rounded-md bg-[var(--color-bg-elevated)] overflow-hidden"
      style={{ height: rowCount * H + (rowCount - 1) * ROW_GAP }}
    >
      {extents.map((c, i) => {
        const leftPct = (c.start / dur) * 100;
        const widthPct = Math.max(0.5, ((c.end - c.start) / dur) * 100);
        const selected = c.id === selectedClipId;
        const row = rowOf.get(c.id) ?? 0;
        return (
          <div
            key={c.id}
            onPointerDown={(e) => onDown(e, c)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            title={`${c.name} — click to select, drag sideways to move it in time`}
            className={`absolute overflow-hidden border-l border-r border-[var(--color-glass-border)] touch-none ${
              dragId === c.id ? 'cursor-grabbing' : 'cursor-grab'
            } ${selected ? 'ring-2 ring-inset ring-[var(--color-primary-green)] z-10' : ''}`}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              top: row * (H + ROW_GAP),
              height: H,
              background: CLIP_COLORS[i % CLIP_COLORS.length],
            }}
          >
            {c.kind === 'video' ? (
              <ClipWave clip={c} getClipBlob={getClipBlob} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[9px] text-[var(--color-text-muted)]">
                {clipGlyph(c.kind)}
              </div>
            )}
            <span className="absolute left-1 top-0.5 text-[9px] font-medium text-[var(--color-text-secondary)] truncate max-w-[92%] pointer-events-none">
              {clipGlyph(c.kind)} {c.name}
            </span>
          </div>
        );
      })}

      {/* playhead */}
      <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.7)] pointer-events-none z-20" style={{ left: playLeft }} />
    </div>
  );
}

/** Per-clip waveform: decode once (cached), draw as a mirrored polygon. */
function ClipWave({ clip, getClipBlob }: { clip: ClipExtent; getClipBlob: (srcId: string) => Blob | undefined }) {
  const [wf, setWf] = useState<Waveform | null>(null);

  useEffect(() => {
    let live = true;
    const blob = getClipBlob(clip.srcId);
    if (!blob) return;
    getWaveform(clip.srcId, blob).then((w) => {
      if (live) setWf(w);
    });
    return () => {
      live = false;
    };
  }, [clip.srcId, getClipBlob]);

  if (!wf || wf.duration <= 0) return null;
  const inFrac = clip.inSec / wf.duration;
  const outFrac = clip.outSec / wf.duration;
  const poly = waveformPolygon(wf, inFrac, outFrac, 100, H);
  if (!poly) return null;
  return (
    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" width="100%" height={H} className="absolute inset-0 block pointer-events-none">
      <polygon points={poly} fill="rgba(116,185,255,0.5)" />
    </svg>
  );
}
