// ===== Interactive follower chart =====
//
// One SVG line over the visible window: drag across it to zoom, tap a point to
// pin that day's detail underneath.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildDayActivity,
  dayKey,
  exactDate,
  filterRange,
  timeAgo,
  trackingStartedAt,
  type DayActivity,
  type Snapshot,
  type TrackerData,
} from './data';
import Avatar from './Avatar';

const W = 720;
const H = 240;
const PAD_X = 10;
const PAD_Y = 24;
/** Horizontal pixels below which a pointer gesture is a click, not a zoom drag. */
const DRAG_THRESHOLD = 6;

interface Geo {
  line: string;
  area: string;
  times: number[];
  vals: number[];
  x: (t: number) => number;
  y: (v: number) => number;
  tAt: (svgX: number) => number;
}

function buildGeo(snapshots: Snapshot[]): Geo | null {
  if (snapshots.length < 2) return null;
  const times = snapshots.map((s) => new Date(s.t).getTime());
  const vals = snapshots.map((s) => s.followers);
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const span = Math.max(1, tMax - tMin);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const vPad = Math.max(1, (vMax - vMin) * 0.15);
  const lo = vMin - vPad;
  const hi = vMax + vPad;

  const x = (t: number) => PAD_X + ((t - tMin) / span) * (W - PAD_X * 2);
  const y = (v: number) => PAD_Y + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - PAD_Y * 2);
  const tAt = (svgX: number) => tMin + ((svgX - PAD_X) / (W - PAD_X * 2)) * span;

  const pts = snapshots.map((s, i) => `${x(times[i])},${y(s.followers)}`);
  const line = `M ${pts.join(' L ')}`;
  const area = `${line} L ${x(tMax)},${H - PAD_Y} L ${x(tMin)},${H - PAD_Y} Z`;
  return { line, area, times, vals, x, y, tAt };
}

export default function FollowerChart({
  data,
  days,
  domain,
  setDomain,
  selected,
  setSelected,
  onOpen,
}: {
  data: TrackerData;
  /** The preset window, in days. 0 means all of it. */
  days: number;
  domain: [number, number] | null;
  setDomain: (d: [number, number] | null) => void;
  selected: string | null;
  setSelected: (k: string | null) => void;
  onOpen: (username: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const activity = useMemo(
    () => buildDayActivity(data.followers ?? [], data.events),
    [data.followers, data.events],
  );
  const trackStart = useMemo(() => trackingStartedAt(data.snapshots), [data.snapshots]);

  const visible = useMemo(() => {
    if (!domain) return filterRange(data.snapshots, days);
    const inside = data.snapshots.filter((s) => {
      const t = new Date(s.t).getTime();
      return t >= domain[0] && t <= domain[1];
    });
    return inside.length >= 2 ? inside : data.snapshots.slice(-2);
  }, [data.snapshots, days, domain]);

  const geo = useMemo(() => buildGeo(visible), [visible]);

  const toSvgX = useCallback((clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 0;
    return ((clientX - rect.left) / rect.width) * W;
  }, []);

  const nearestIndex = useCallback(
    (svgX: number) => {
      if (!geo) return 0;
      const t = geo.tAt(svgX);
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < geo.times.length; i++) {
        const d = Math.abs(geo.times[i] - t);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    },
    [geo],
  );

  if (!geo) {
    return (
      <section className="ig-card ig-chart-card">
        <div className="ig-placeholder small">Not enough history yet to draw a graph.</div>
      </section>
    );
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const x = toSvgX(e.clientX);
    setDrag({ from: x, to: x });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const x = toSvgX(e.clientX);
    setHover(nearestIndex(x));
    if (drag) setDrag({ ...drag, to: x });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const x = toSvgX(e.clientX);
    if (drag && Math.abs(x - drag.from) > DRAG_THRESHOLD) {
      // A drag zooms to the swept range.
      const a = geo.tAt(Math.min(drag.from, x));
      const b = geo.tAt(Math.max(drag.from, x));
      setDomain([a, b]);
      setSelected(null);
    } else {
      // A tap picks a day.
      const key = dayKey(visible[nearestIndex(x)].t);
      setSelected(selected === key ? null : key);
    }
    setDrag(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const activeIdx = hover ?? (selected ? visible.findIndex((s) => dayKey(s.t) === selected) : -1);
  const active = activeIdx >= 0 ? visible[activeIdx] : null;
  const activeKey = active ? dayKey(active.t) : null;
  const activeDay = activeKey ? activity.get(activeKey) : undefined;

  const detailKey = selected ?? activeKey;
  const detail = detailKey ? activity.get(detailKey) : undefined;

  const dragRect = drag && Math.abs(drag.to - drag.from) > DRAG_THRESHOLD
    ? { x: Math.min(drag.from, drag.to), w: Math.abs(drag.to - drag.from) }
    : null;

  return (
    <section className="ig-card ig-chart-card">
      <div className="ig-chart-head">
        <span className="ig-chart-span">
          {exactDate(visible[0].t)} — {exactDate(visible[visible.length - 1].t)}
          <span className="ig-chart-count"> · {visible.length} points</span>
        </span>
        {domain && (
          <button className="ios-btn ig-chart-reset" onClick={() => setDomain(null)}>
            Reset zoom
          </button>
        )}
      </div>

      <div className="ig-chart-wrap">
        <svg
          ref={svgRef}
          className="ig-chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Follower count over time. Drag to zoom, tap a point for that day's detail."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            setHover(null);
            setDrag(null);
          }}
        >
          <defs>
            <linearGradient id="igLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#feda75" />
              <stop offset="35%" stopColor="#fa7e1e" />
              <stop offset="65%" stopColor="#d62976" />
              <stop offset="100%" stopColor="#4f5bd5" />
            </linearGradient>
            <linearGradient id="igArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d62976" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#d62976" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={geo.area} fill="url(#igArea)" />
          <path
            d={geo.line}
            fill="none"
            stroke="url(#igLine)"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {dragRect && (
            <rect
              x={dragRect.x}
              y={PAD_Y}
              width={dragRect.w}
              height={H - PAD_Y * 2}
              className="ig-chart-brush"
            />
          )}

          {active && (
            <g>
              <line
                x1={geo.x(new Date(active.t).getTime())}
                y1={PAD_Y}
                x2={geo.x(new Date(active.t).getTime())}
                y2={H - PAD_Y}
                className="ig-chart-crosshair"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={geo.x(new Date(active.t).getTime())}
                cy={geo.y(active.followers)}
                r="5"
                fill="#fff"
                stroke="#d62976"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>

        {active && (
          <div
            className="ig-tip"
            // Centred on the point, except near the ends — a centred tooltip
            // hangs off the card there, badly so on a narrow screen.
            style={tipPosition((geo.x(new Date(active.t).getTime()) / W) * 100)}
          >
            <span className="ig-tip-date">{exactDate(active.t)}</span>
            <span className="ig-tip-count">{active.followers.toLocaleString()} followers</span>
            {activeDay &&
              (activeDay.follows.length > 0 ||
                activeDay.unfollows.length > 0 ||
                activeDay.outbound.length > 0) && (
              <span className="ig-tip-delta">
                {activeDay.follows.length > 0 && (
                  <span className="pos">+{activeDay.follows.length}</span>
                )}
                {activeDay.unfollows.length > 0 && (
                  <span className="neg">−{activeDay.unfollows.length}</span>
                )}
                {activeDay.outbound.length > 0 && (
                  <span className="out">{activeDay.outbound.length} by you</span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stats follow the visible window, so they re-scope as you zoom. */}
      <div className="ig-chart-foot">
        <Stat label="Peak" value={Math.max(...geo.vals).toLocaleString()} />
        <Stat label="Low" value={Math.min(...geo.vals).toLocaleString()} />
        <Stat
          label="Change"
          value={`${geo.vals[geo.vals.length - 1] - geo.vals[0] >= 0 ? '+' : ''}${(
            geo.vals[geo.vals.length - 1] - geo.vals[0]
          ).toLocaleString()}`}
        />
        <Stat label="Updated" value={timeAgo(data.generatedAt)} />
      </div>

      <p className="ig-chart-hint">
        Drag across the chart to zoom · tap a point to see that day
        {selected && (
          <button className="ig-chart-clear" onClick={() => setSelected(null)}>
            clear selection
          </button>
        )}
      </p>

      {detail && (
        <DayBreakdown
          day={detail}
          trackStart={trackStart}
          pinned={Boolean(selected)}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}

const DETAIL_LIMIT = 24;

/** Who followed / unfollowed on the selected day. */
function DayBreakdown({
  day,
  trackStart,
  pinned,
  onOpen,
}: {
  day: DayActivity;
  trackStart: string | null;
  pinned: boolean;
  onOpen: (username: string) => void;
}) {
  const beforeTracking = trackStart ? new Date(day.key) < new Date(dayKey(trackStart)) : true;

  if (day.follows.length === 0 && day.unfollows.length === 0 && day.outbound.length === 0)
    return null;

  return (
    <div className={`ig-breakdown ${pinned ? 'is-pinned' : ''}`}>
      <div className="ig-breakdown-head">
        <span className="ig-breakdown-date">{exactDate(day.key)}</span>
        <span className="ig-breakdown-tally">
          {day.follows.length > 0 && <span className="pos">+{day.follows.length} followed</span>}
          {day.unfollows.length > 0 && (
            <span className="neg">−{day.unfollows.length} unfollowed</span>
          )}
          {day.outbound.length > 0 && (
            <span className="out">{day.outbound.length} by you</span>
          )}
        </span>
      </div>

      {day.follows.length > 0 && (
        <ul className="ig-breakdown-list">
          {day.follows.slice(0, DETAIL_LIMIT).map((p) => (
            <li key={`f-${p.username}`} className="ig-breakdown-row">
              <Avatar username={p.username} />
              <button className="ig-breakdown-handle" onClick={() => onOpen(p.username)}>
                {p.name || `@${p.username}`}
              </button>
              <span className="ig-breakdown-tag pos">followed</span>
            </li>
          ))}
          {day.follows.length > DETAIL_LIMIT && (
            <li className="ig-breakdown-more">
              + {day.follows.length - DETAIL_LIMIT} more
            </li>
          )}
        </ul>
      )}

      {day.outbound.length > 0 && (
        <ul className="ig-breakdown-list">
          {day.outbound.map((e) => (
            <li key={`o-${e.kind}-${e.username}`} className="ig-breakdown-row">
              <Avatar username={e.username} />
              <button className="ig-breakdown-handle" onClick={() => onOpen(e.username)}>
                {e.name || `@${e.username}`}
              </button>
              <span className="ig-breakdown-tag out">
                you {e.kind === 'follow' ? 'followed' : 'unfollowed'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {day.unfollows.length > 0 && (
        <ul className="ig-breakdown-list">
          {day.unfollows.map((e) => (
            <li key={`u-${e.username}`} className="ig-breakdown-row">
              <Avatar username={e.username} />
              <button className="ig-breakdown-handle" onClick={() => onOpen(e.username)}>
                {e.name || `@${e.username}`}
              </button>
              <span className="ig-breakdown-tag neg">unfollowed</span>
            </li>
          ))}
        </ul>
      )}

      <p className="ig-breakdown-note">
        {beforeTracking
          ? 'Follows are reconstructed from your export, so this lists only people who still follow you. Unfollows weren’t recorded before daily tracking began.'
          : 'Recorded by the daily check.'}
      </p>
    </div>
  );
}

/** Keep the readout inside the card: centre it, but flush it at either end. */
function tipPosition(pct: number): React.CSSProperties {
  if (pct < 22) return { left: 0, transform: 'none' };
  if (pct > 78) return { left: '100%', transform: 'translateX(-100%)' };
  return { left: `${pct}%`, transform: 'translateX(-50%)' };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ig-foot-stat">
      <span className="ig-foot-value">{value}</span>
      <span className="ig-foot-label">{label}</span>
    </div>
  );
}
