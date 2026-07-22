// ===== Shared free-form volume-automation curve lane =====
//
// Extracted from ClipPanel so the SAME editor drives both a clip's original-audio
// curve and a background-music track's fade curve — one VolumePoint mechanism, no
// second implementation. The lane is a free-form editor over {t, level} points
// (t in seconds along `length`; level = gain multiplier, 1 = 100%):
//   - click empty lane → add a point
//   - drag a point      → move it (x = time, y = volume)
//   - select + Delete / right-click → remove it
// Interpolation is linear and holds flat outside the point range, so NO points ==
// flat 100%. While `muted` the lane greys out but keeps every point (lossless).

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Field } from '../ui';
import type { VolumePoint } from '../clips';
import { clampLevel, sortedVolume, VOLUME_MAX } from '../clips';

const H = 150; // lane height, px
const PAD = 12; // inner inset so edge points stay grabbable, px
const POINT_R = 5;

interface Props {
  points: VolumePoint[];
  /** X-axis span in seconds (clip length, or a music track's placed duration). */
  length: number;
  muted: boolean;
  /** Replace the curve. `discrete` seals a one-shot action as its own undo entry. */
  onEdit: (points: VolumePoint[], discrete?: boolean) => void;
}

const pctOf = (level: number) => `${Math.round(level * 100)}%`;

export default function VolumeCurveEditor({ points, length, muted, onEdit }: Props) {
  const len = Math.max(0.001, length);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ i: number } | null>(null);
  const [W, setW] = useState(280);
  const [sel, setSel] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(120, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const innerW = W - 2 * PAD;
  const innerH = H - 2 * PAD;
  const px = useCallback((t: number) => PAD + (t / len) * innerW, [len, innerW]);
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

  const addPoint = useCallback(
    (e: ReactPointerEvent) => {
      if (muted) return;
      const p = toData(e.clientX, e.clientY);
      onEdit([...points, p], true);
      setSel(points.length);
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
      onEdit(points.map((q, j) => (j === d.i ? p : q)));
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
      onEdit(points.filter((_, j) => j !== i), true);
      setSel(null);
    },
    [points, onEdit],
  );
  const onLaneKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null && sel < points.length) {
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
      onEdit(points.map((q, j) => (j === sel ? { ...q, level: clampLevel(level) } : q)));
    },
    [sel, points, onEdit],
  );
  const clearCurve = useCallback(() => {
    onEdit([], true);
    setSel(null);
  }, [onEdit]);

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
            <text x={2} y={py(VOLUME_MAX) + 4} fontSize={9} fill="var(--color-text-muted)">200</text>
            <text x={2} y={py(1) + 3} fontSize={9} fill="var(--color-text-muted)">100</text>
            <text x={2} y={py(0)} fontSize={9} fill="var(--color-text-muted)">0</text>

            <polygon points={areaStr} fill="rgba(116,185,255,0.14)" />
            <polyline points={lineStr} fill="none" stroke="var(--color-primary-blue)" strokeWidth={2} />

            <rect
              x={PAD}
              y={PAD}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerDown={addPoint}
              style={{ cursor: muted ? 'default' : 'copy' }}
            />

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
    </>
  );
}
