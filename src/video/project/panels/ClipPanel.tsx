// ===== Clip audio panel: free-form volume-automation curve + tremolo + mute =====
//
// Shown when a VIDEO clip is selected. The curve is an ordered list of
// {t, level} points (clip-local seconds from the in-point; level = gain
// multiplier, 1 = original). The lane is a free-form editor:
//   - click empty lane      → add a point
//   - drag a point          → move it (x = time, y = volume)
//   - select + Delete/right-click → remove it
// Volume interpolates linearly between points and holds flat outside them, so
// NO points == flat 100% (unchanged). The oscillation generator is just a curve
// helper: it writes ordinary points you can then drag/delete like any other.
// Mute is a separate flag that silences the clip regardless of the curve; while
// muted the editor greys out but keeps every point for a lossless un-mute.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Field, Toggle } from '../ui';
import type { VideoClip, VolumePoint } from '../clips';
import { clampLevel, clipLen, sortedVolume, applyOscillation, VOLUME_MAX } from '../clips';

const H = 150; // lane height, px
const PAD = 12; // inner inset so edge points stay grabbable, px
const POINT_R = 5;

interface Props {
  clip: VideoClip;
  /** Patch the clip. `discrete` seals a one-shot action as its own undo entry. */
  onEdit: (patch: Partial<VideoClip>, discrete?: boolean) => void;
}

const pctOf = (level: number) => `${Math.round(level * 100)}%`;

export default function ClipPanel({ clip, onEdit }: Props) {
  const len = clipLen(clip);
  const points = useMemo(() => clip.volume ?? [], [clip.volume]);
  const muted = clip.muted === true;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ i: number } | null>(null);
  const [W, setW] = useState(280);
  const [sel, setSel] = useState<number | null>(null);

  // Measure the lane width so points/circles stay undistorted at any panel size.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(120, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // (The panel is keyed by clip id in the editor, so it remounts per clip —
  //  transient selection + generator settings reset naturally on switch.)

  // ---- pixel <-> data mapping ----
  const innerW = W - 2 * PAD;
  const innerH = H - 2 * PAD;
  const px = useCallback((t: number) => PAD + (len <= 0 ? 0 : t / len) * innerW, [len, innerW]);
  const py = useCallback((level: number) => PAD + (1 - level / VOLUME_MAX) * innerH, [innerH]);
  const toData = useCallback(
    (clientX: number, clientY: number): VolumePoint => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { t: 0, level: 1 };
      const x = Math.max(PAD, Math.min(W - PAD, clientX - rect.left));
      const y = Math.max(PAD, Math.min(H - PAD, clientY - rect.top));
      const t = Math.max(0, Math.min(len, ((x - PAD) / Math.max(1, innerW)) * len));
      const level = clampLevel((1 - (y - PAD) / Math.max(1, innerH)) * VOLUME_MAX);
      return { t, level };
    },
    [W, len, innerW, innerH],
  );

  // ---- curve editing ----
  const addPoint = useCallback(
    (e: ReactPointerEvent) => {
      if (muted) return;
      const p = toData(e.clientX, e.clientY);
      onEdit({ volume: [...points, p] }, true);
      setSel(points.length); // the appended point
    },
    [muted, toData, points, onEdit],
  );

  const beginDrag = useCallback(
    (e: ReactPointerEvent, i: number) => {
      if (muted) return;
      e.stopPropagation();
      setSel(i);
      dragRef.current = { i };
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [muted],
  );
  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = dragRef.current;
      if (!d || e.buttons === 0) return;
      const p = toData(e.clientX, e.clientY);
      onEdit({ volume: points.map((q, j) => (j === d.i ? p : q)) });
    },
    [toData, points, onEdit],
  );
  const endDrag = useCallback((e: ReactPointerEvent) => {
    dragRef.current = null;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const removeAt = useCallback(
    (i: number) => {
      onEdit({ volume: points.filter((_, j) => j !== i) }, true);
      setSel(null);
    },
    [points, onEdit],
  );
  const onLaneKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null && sel < points.length) {
        // Stop the editor's global Delete (which removes the selected LAYER).
        e.preventDefault();
        e.stopPropagation();
        removeAt(sel);
      }
    },
    [sel, points.length, removeAt],
  );

  const setSelLevel = useCallback(
    (level: number) => {
      if (sel === null || sel >= points.length) return;
      onEdit({ volume: points.map((q, j) => (j === sel ? { ...q, level: clampLevel(level) } : q)) });
    },
    [sel, points, onEdit],
  );

  const clearCurve = useCallback(() => {
    onEdit({ volume: [] }, true);
    setSel(null);
  }, [onEdit]);

  // ---- oscillation generator ----
  const [whole, setWhole] = useState(true);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(len);
  const [freq, setFreq] = useState(4);
  const [depthPct, setDepthPct] = useState(40);
  const [centerPct, setCenterPct] = useState(100);

  const generate = useCallback(() => {
    const start = whole ? 0 : Math.max(0, Math.min(rangeStart, len));
    const end = whole ? len : Math.max(start, Math.min(rangeEnd, len));
    onEdit(
      {
        volume: applyOscillation(points, {
          start,
          end,
          freq: Math.max(0, freq),
          depth: depthPct / 100,
          center: centerPct / 100,
        }),
      },
      true,
    );
    setSel(null);
  }, [whole, rangeStart, rangeEnd, len, freq, depthPct, centerPct, points, onEdit]);

  // ---- curve polyline (sorted + held flat to the edges, matching sampleVolume) ----
  const sorted = sortedVolume(points);
  const linePts: Array<[number, number]> = [];
  if (sorted.length === 0) {
    linePts.push([px(0), py(1)], [px(len), py(1)]);
  } else {
    if (sorted[0].t > 0) linePts.push([px(0), py(sorted[0].level)]);
    for (const p of sorted) linePts.push([px(p.t), py(p.level)]);
    const last = sorted[sorted.length - 1];
    if (last.t < len) linePts.push([px(len), py(last.level)]);
  }
  const lineStr = linePts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaStr = `${PAD},${H - PAD} ${lineStr} ${(W - PAD).toFixed(1)},${H - PAD}`;

  const selPoint = sel !== null && sel < points.length ? points[sel] : null;

  return (
    <>
      <Toggle
        label="Mute this clip"
        hint="Silences the original audio entirely. The curve below is kept for un-muting."
        checked={muted}
        onChange={(v) => onEdit({ muted: v }, true)}
      />

      <Field label="Volume automation">
        <div ref={wrapRef} className={muted ? 'opacity-40 pointer-events-none' : ''}>
          <svg
            ref={svgRef}
            width={W}
            height={H}
            tabIndex={0}
            onKeyDown={onLaneKeyDown}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            className="block rounded-md bg-[var(--color-bg-surface)] outline-none touch-none select-none"
            data-testid="volume-curve"
          >
            {/* 0% / 100% / 200% guide lines */}
            {[0, 1, VOLUME_MAX].map((lv) => (
              <line
                key={lv}
                x1={PAD}
                x2={W - PAD}
                y1={py(lv)}
                y2={py(lv)}
                stroke={lv === 1 ? 'rgba(139,233,199,0.55)' : 'var(--color-border)'}
                strokeDasharray={lv === 1 ? '4 3' : undefined}
                strokeWidth={1}
              />
            ))}
            {/* playhead-agnostic labels */}
            <text x={2} y={py(VOLUME_MAX) + 4} fontSize={9} fill="var(--color-text-muted)">200</text>
            <text x={2} y={py(1) + 3} fontSize={9} fill="var(--color-text-muted)">100</text>
            <text x={2} y={py(0)} fontSize={9} fill="var(--color-text-muted)">0</text>

            {/* filled area + curve */}
            <polygon points={areaStr} fill="rgba(116,185,255,0.14)" />
            <polyline points={lineStr} fill="none" stroke="var(--color-primary-blue)" strokeWidth={2} />

            {/* click target for adding points (behind the point handles) */}
            <rect
              x={PAD}
              y={PAD}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerDown={addPoint}
              style={{ cursor: muted ? 'default' : 'copy' }}
            />

            {/* draggable control points */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={px(p.t)}
                cy={py(p.level)}
                r={POINT_R}
                fill={i === sel ? 'var(--color-primary-green)' : 'var(--color-primary-blue)'}
                stroke="#0b0f1a"
                strokeWidth={1}
                onPointerDown={(e) => beginDrag(e, i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  removeAt(i);
                }}
                style={{ cursor: muted ? 'default' : 'grab' }}
              />
            ))}
          </svg>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
          <span>Click to add · drag to move · right-click / Delete to remove</span>
          {points.length > 0 && (
            <button onClick={clearCurve} disabled={muted} className="hover:text-[var(--color-text-primary)] disabled:opacity-40">
              Clear
            </button>
          )}
        </div>
      </Field>

      {selPoint && !muted && (
        <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)]">
          <span className="whitespace-nowrap">Point @ {selPoint.t.toFixed(2)}s</span>
          <input
            type="range"
            min={0}
            max={VOLUME_MAX}
            step={0.01}
            value={selPoint.level}
            onChange={(e) => setSelLevel(Number(e.target.value))}
            className="flex-1 accent-[var(--color-primary-green)]"
          />
          <span className="w-10 text-right font-mono">{pctOf(selPoint.level)}</span>
          <button onClick={() => sel !== null && removeAt(sel)} title="Remove point" className="text-[var(--color-text-muted)] hover:text-[rgba(255,120,120,0.9)]">✕</button>
        </div>
      )}

      {/* ---- tremolo / sine generator ---- */}
      <div className={`rounded-md border border-[var(--color-glass-border)] p-2.5 space-y-2 ${muted ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">Oscillation (tremolo)</div>
        <Toggle label="Whole clip" checked={whole} onChange={setWhole} />
        {!whole && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Start — ${rangeStart.toFixed(2)}s`}>
              <input type="number" min={0} max={len} step={0.05} value={Number(rangeStart.toFixed(2))} onChange={(e) => setRangeStart(Math.max(0, Math.min(len, Number(e.target.value) || 0)))} className="input" />
            </Field>
            <Field label={`End — ${rangeEnd.toFixed(2)}s`}>
              <input type="number" min={0} max={len} step={0.05} value={Number(rangeEnd.toFixed(2))} onChange={(e) => setRangeEnd(Math.max(0, Math.min(len, Number(e.target.value) || 0)))} className="input" />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label={`Freq — ${freq}/s`}>
            <input type="number" min={0.1} max={20} step={0.1} value={freq} onChange={(e) => setFreq(Math.max(0.1, Math.min(20, Number(e.target.value) || 0.1)))} className="input" />
          </Field>
          <Field label={`Depth — ${depthPct}%`}>
            <input type="number" min={0} max={100} step={5} value={depthPct} onChange={(e) => setDepthPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="input" />
          </Field>
          <Field label={`Center — ${centerPct}%`}>
            <input type="number" min={0} max={200} step={5} value={centerPct} onChange={(e) => setCenterPct(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} className="input" />
          </Field>
        </div>
        <button
          onClick={generate}
          className="w-full px-3 py-2 rounded-md border border-[var(--color-primary-green)] text-[var(--color-primary-green)] text-xs font-medium hover:bg-[var(--color-glass-hover)]"
        >
          Generate wave
        </button>
        <div className="text-[10px] text-[var(--color-text-muted)]">
          Writes regular curve points — drag or delete them afterward like any other.
        </div>
      </div>
    </>
  );
}
