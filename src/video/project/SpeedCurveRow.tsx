// ===== Time Machine speed-curve timeline lane (free-form, draggable) =====
//
// The editable curve lives directly in the timeline, per the brief: click the
// lane to add a control point, drag a point to change speed (vertical) + time
// (horizontal), linear interpolation between points, a clear 1× reference line,
// no points == normal speed. It is the timeline-row twin of ClipPanel's volume
// lane and edits the same shared points array the side panel does.

import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SpeedPoint } from '../timemachine/types';
import { FREEZE_EPS, MAX_SPEED, sortedSpeeds } from '../timemachine/types';

const H = 64; // lane height, px (also the SVG viewBox height)
const VW = 1000; // viewBox width — stretches to the row via preserveAspectRatio=none
const PAD_Y = 9; // vertical inset so 0×/MAX× points stay grabbable
const POINT_R = 8; // hit radius in viewBox units

interface Props {
  points: SpeedPoint[];
  duration: number;
  currentSec: number;
  selected: boolean;
  selectedIdx: number | null;
  onSelectLayer: () => void;
  onAddPoint: (t: number, speed: number) => void;
  onMovePoint: (idx: number, t: number, speed: number) => void;
  onRemovePoint: (idx: number) => void;
  onSelectPoint: (idx: number) => void;
}

function speedColor(speed: number): string {
  if (speed <= FREEZE_EPS) return '#64748b'; // freeze — slate
  if (speed < 0.98) return '#22d3ee'; // slow-mo — cyan
  if (speed > 1.02) return '#fb923c'; // fast — orange
  return '#94a3b8'; // normal — grey
}

export default function SpeedCurveRow({
  points,
  duration,
  currentSec,
  selected,
  selectedIdx,
  onSelectLayer,
  onAddPoint,
  onMovePoint,
  onRemovePoint,
  onSelectPoint,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ idx: number } | null>(null);
  const dur = Math.max(0.001, duration);

  const innerTop = PAD_Y;
  const innerBot = H - PAD_Y;
  const x = useCallback((t: number) => (t / dur) * VW, [dur]);
  const y = useCallback((speed: number) => innerBot - (speed / MAX_SPEED) * (innerBot - innerTop), [innerBot, innerTop]);

  // Pointer → data using the SVG's real pixel rect (viewBox is resolution-free).
  const toData = useCallback(
    (clientX: number, clientY: number): { t: number; speed: number } => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { t: 0, speed: 1 };
      const fx = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      const topPx = rect.top + (PAD_Y / H) * rect.height;
      const botPx = rect.top + ((H - PAD_Y) / H) * rect.height;
      const fy = Math.max(0, Math.min(1, (clientY - topPx) / Math.max(1, botPx - topPx)));
      return { t: fx * dur, speed: (1 - fy) * MAX_SPEED };
    },
    [dur],
  );

  const onLaneDown = useCallback(
    (e: ReactPointerEvent) => {
      // Clicking empty lane adds a point (and selects the layer).
      onSelectLayer();
      const p = toData(e.clientX, e.clientY);
      onAddPoint(p.t, p.speed);
    },
    [toData, onAddPoint, onSelectLayer],
  );

  const onPointDown = useCallback(
    (e: ReactPointerEvent, idx: number) => {
      e.stopPropagation();
      onSelectLayer();
      onSelectPoint(idx);
      dragRef.current = { idx };
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [onSelectLayer, onSelectPoint],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = dragRef.current;
      if (!d || e.buttons === 0) return;
      const p = toData(e.clientX, e.clientY);
      onMovePoint(d.idx, p.t, p.speed);
    },
    [toData, onMovePoint],
  );

  const onUp = useCallback((e: ReactPointerEvent) => {
    dragRef.current = null;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // Curve polyline (sorted + held flat to the edges, matching speedAt).
  const sorted = sortedSpeeds(points);
  const line: Array<[number, number]> = [];
  if (sorted.length === 0) {
    line.push([0, y(1)], [VW, y(1)]);
  } else {
    if (sorted[0].t > 0) line.push([0, y(sorted[0].speed)]);
    for (const p of sorted) line.push([x(p.t), y(p.speed)]);
    const last = sorted[sorted.length - 1];
    if (last.t < dur) line.push([VW, y(last.speed)]);
  }
  const lineStr = line.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const playX = (Math.min(dur, Math.max(0, currentSec)) / dur) * VW;

  return (
    <div className={`relative rounded-md bg-[var(--color-bg-elevated)] overflow-hidden ${selected ? 'ring-2 ring-[var(--color-primary-green)]' : ''}`} style={{ height: H }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height={H}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="block touch-none"
      >
        {/* speed reference lines: 0× / 1× / MAX× */}
        {[0, 1, MAX_SPEED].map((s) => (
          <line
            key={s}
            x1={0}
            x2={VW}
            y1={y(s)}
            y2={y(s)}
            stroke={s === 1 ? 'rgba(139,233,199,0.55)' : 'var(--color-border)'}
            strokeDasharray={s === 1 ? '6 4' : undefined}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* click target for adding points (behind the point handles) */}
        <rect x={0} y={0} width={VW} height={H} fill="transparent" onPointerDown={onLaneDown} style={{ cursor: 'copy' }} />

        {/* curve */}
        <polyline points={lineStr} fill="none" stroke="var(--color-primary-blue)" strokeWidth={2} vectorEffect="non-scaling-stroke" />

        {/* playhead */}
        <line x1={playX} x2={playX} y1={0} y2={H} stroke="rgba(116,185,255,0.7)" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {/* draggable control points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(p.t)}
            cy={y(p.speed)}
            r={POINT_R}
            fill={i === selectedIdx ? 'var(--color-primary-green)' : speedColor(p.speed)}
            stroke="#0b0f1a"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(e) => onPointDown(e, i)}
            onContextMenu={(e) => {
              e.preventDefault();
              onRemovePoint(i);
            }}
            style={{ cursor: 'grab' }}
          />
        ))}
      </svg>

      {/* labels + empty hint */}
      <div className="pointer-events-none absolute left-1 top-0.5 text-[9px] font-mono text-[var(--color-text-muted)]">{MAX_SPEED}×</div>
      <div className="pointer-events-none absolute left-1 bottom-0.5 text-[9px] font-mono text-[var(--color-text-muted)]">0×</div>
      {points.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]">
          Time Machine — click to add a speed point
        </div>
      )}
    </div>
  );
}
