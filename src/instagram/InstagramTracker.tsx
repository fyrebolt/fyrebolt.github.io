import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '../ios/AppShell';
import { Segmented } from '../ios';
import {
  groupByDay,
  loadTrackerData,
  loadLocalData,
  saveLocalData,
  clearLocalData,
  downloadHistoryJson,
  filterRange,
  searchFollowers,
  statsForRange,
  timeAgo,
  type DayBucket,
  type Follower,
  type Snapshot,
  type TrackerData,
} from './data';
import { parseExportZip, buildFromExport } from './importZip';
import './instagram.css';

interface ImportState {
  busy: boolean;
  error?: string;
  note?: string;
}

type Range = '7' | '30' | '0';

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '0', label: 'All' },
];

export default function InstagramTracker() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [range, setRange] = useState<Range>('30');
  const [importState, setImportState] = useState<ImportState>({ busy: false });

  const dataRef = useRef<TrackerData | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;
    // Prefer locally imported data (from a data-export ZIP) over the committed file.
    const local = loadLocalData();
    if (local) {
      setData(local);
      setStatus('ready');
      return;
    }
    loadTrackerData().then((d) => {
      if (cancelled) return;
      if (d) {
        setData(d);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setImportState({ busy: true });
    try {
      const imported = await parseExportZip(file);
      const next = buildFromExport(imported, dataRef.current);
      saveLocalData(next);
      setData(next);
      setStatus('ready');
      setImportState({
        busy: false,
        note: `Imported ${imported.length.toLocaleString()} followers.`,
      });
    } catch (e) {
      setImportState({ busy: false, error: e instanceof Error ? e.message : 'Import failed.' });
    }
  }, []);

  const handleClear = useCallback(() => {
    clearLocalData();
    setImportState({ busy: false });
    setStatus('loading');
    loadTrackerData().then((d) => {
      setData(d);
      setStatus(d ? 'ready' : 'error');
    });
  }, []);

  return (
    <AppShell
      title="Instagram Tracker"
      glyph="📸"
      maxWidth={880}
      right={
        data ? (
          <a
            className="ios-btn ios-btn-ghost ig-open"
            href={`https://instagram.com/${data.account}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{data.account}
          </a>
        ) : undefined
      }
    >
      <ImportPanel
        data={data}
        state={importState}
        onFile={handleFile}
        onDownload={() => data && downloadHistoryJson(data)}
        onClear={handleClear}
      />
      {status === 'loading' && <div className="ig-placeholder">Loading follower history…</div>}
      {status === 'error' && (
        <div className="ig-placeholder">Couldn’t load tracker data. Try again later.</div>
      )}
      {status === 'ready' && data && <TrackerBody data={data} range={range} setRange={setRange} />}
    </AppShell>
  );
}

function ImportPanel({
  data,
  state,
  onFile,
  onDownload,
  onClear,
}: {
  data: TrackerData | null;
  state: ImportState;
  onFile: (file: File) => void;
  onDownload: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const isLive = Boolean(data && !data.sample);

  const pick = () => inputRef.current?.click();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <section
      className={`ig-import ${dragging ? 'is-dragging' : ''} ${isLive ? 'is-live' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />

      {isLive ? (
        <div className="ig-import-live">
          <div className="ig-import-live-text">
            <strong>Live data</strong> · updated {timeAgo(data!.generatedAt)} · stored in this
            browser
          </div>
          <div className="ig-import-actions">
            <button className="ios-btn" onClick={pick} disabled={state.busy}>
              {state.busy ? 'Importing…' : 'Update with new export'}
            </button>
            <button className="ios-btn" onClick={onDownload}>
              Download history.json
            </button>
            <button className="ios-btn ig-btn-quiet" onClick={onClear}>
              Clear
            </button>
          </div>
        </div>
      ) : (
        <button className="ig-import-drop" onClick={pick} disabled={state.busy} type="button">
          <span className="ig-import-icon" aria-hidden>
            ⬆︎
          </span>
          <span className="ig-import-title">
            {state.busy ? 'Reading your export…' : 'Import your Instagram data export'}
          </span>
          <span className="ig-import-sub">
            Drag in the <code>.zip</code>, or click to choose. Export via Accounts Center → Download
            your information → <em>Followers and following</em> (JSON). Parsed entirely in your
            browser.
          </span>
        </button>
      )}

      {state.error && <p className="ig-import-msg err">{state.error}</p>}
      {state.note && !state.error && <p className="ig-import-msg ok">{state.note}</p>}
    </section>
  );
}

function TrackerBody({
  data,
  range,
  setRange,
}: {
  data: TrackerData;
  range: Range;
  setRange: (r: Range) => void;
}) {
  const days = Number(range);
  const rangeSnaps = useMemo(() => filterRange(data.snapshots, days), [data.snapshots, days]);
  const stats = useMemo(() => statsForRange(data.snapshots, days), [data.snapshots, days]);
  const buckets = useMemo(() => groupByDay(data.events), [data.events]);

  const [selectedDay, setSelectedDay] = useState<string>(() => buckets[0]?.key ?? '');
  const selected = buckets.find((b) => b.key === selectedDay) ?? buckets[0];

  const rangeLabel = days === 0 ? 'all time' : `last ${days} days`;
  const up = stats.delta >= 0;

  return (
    <div className="ig">
      {data.sample && (
        <div className="ig-banner" role="note">
          <span className="ig-banner-dot" aria-hidden />
          Showing sample data. Import your Instagram data export above to track{' '}
          <strong>@{data.account}</strong> for real.
        </div>
      )}

      <section className="ig-hero">
        <div className="ig-hero-main">
          <span className="ig-hero-label">Followers</span>
          <span className="ig-hero-count">{stats.current.toLocaleString()}</span>
          <span className={`ig-delta ${up ? 'up' : 'down'}`}>
            <Arrow up={up} /> {up ? '+' : ''}
            {stats.delta.toLocaleString()} <span className="ig-delta-sub">· {rangeLabel}</span>
          </span>
        </div>
        <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} className="ig-range" />
      </section>

      <section className="ig-card ig-chart-card">
        <FollowerChart snapshots={rangeSnaps} />
        <div className="ig-chart-foot">
          <Stat label="Peak" value={stats.peak.toLocaleString()} />
          <Stat label="Low" value={stats.low.toLocaleString()} />
          <Stat label="Updated" value={timeAgo(data.generatedAt)} />
        </div>
      </section>

      <section className="ig-activity">
        <h2 className="ig-section-title">Daily activity</h2>
        {buckets.length === 0 ? (
          <div className="ig-placeholder small">No follow/unfollow activity recorded yet.</div>
        ) : (
          <>
            <div className="ig-day-strip" role="tablist" aria-label="Days with activity">
              {buckets.slice(0, 30).map((b) => (
                <button
                  key={b.key}
                  role="tab"
                  aria-selected={b.key === selected?.key}
                  className={`ig-day-chip ${b.key === selected?.key ? 'is-active' : ''}`}
                  onClick={() => setSelectedDay(b.key)}
                >
                  <span className="ig-day-chip-date">{shortDate(b.key)}</span>
                  <span className="ig-day-chip-net">
                    <span className="pos">+{b.follows.length}</span>
                    <span className="neg">−{b.unfollows.length}</span>
                  </span>
                </button>
              ))}
            </div>

            {selected && <DayDetail bucket={selected} account={data.account} />}
          </>
        )}
      </section>

      <FollowersSection followers={data.followers ?? []} />
    </div>
  );
}

const FOLLOWERS_LIMIT = 100;

function FollowersSection({ followers }: { followers: Follower[] }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchFollowers(followers, query), [followers, query]);
  const shown = results.slice(0, FOLLOWERS_LIMIT);

  return (
    <section className="ig-followers">
      <div className="ig-followers-head">
        <h2 className="ig-section-title">Followers</h2>
        <span className="ig-followers-count">{followers.length.toLocaleString()} total</span>
      </div>

      {followers.length === 0 ? (
        <div className="ig-placeholder small">
          The follower list appears here once a live Instagram session is connected.
        </div>
      ) : (
        <>
          <div className="ig-search">
            <svg className="ig-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="ios-input ig-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or @username"
              aria-label="Search followers"
            />
          </div>

          {results.length === 0 ? (
            <p className="ig-empty">No followers match “{query}”.</p>
          ) : (
            <ul className="ig-follower-list">
              {shown.map((f) => (
                <FollowerRow key={f.username} follower={f} />
              ))}
            </ul>
          )}

          {results.length > FOLLOWERS_LIMIT && (
            <p className="ig-followers-more">
              Showing {FOLLOWERS_LIMIT} of {results.length.toLocaleString()} — refine your search to
              narrow it down.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function FollowerRow({ follower }: { follower: Follower }) {
  return (
    <li className="ig-follower-row">
      <span className="ig-avatar follow" aria-hidden>
        {follower.username.slice(0, 1).toUpperCase()}
      </span>
      <span className="ig-follower-text">
        {follower.name ? <span className="ig-follower-name">{follower.name}</span> : null}
        <a
          className="ig-follower-handle"
          href={`https://instagram.com/${follower.username}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          @{follower.username}
        </a>
      </span>
    </li>
  );
}

function DayDetail({ bucket, account }: { bucket: DayBucket; account: string }) {
  return (
    <div className="ig-day-detail">
      <div className="ig-col">
        <div className="ig-col-head">
          <span className="ig-col-title">Followed you</span>
          <span className="ig-col-badge pos">{bucket.follows.length}</span>
        </div>
        {bucket.follows.length ? (
          <ul className="ig-user-list">
            {bucket.follows.map((e) => (
              <UserRow key={`f-${e.username}`} username={e.username} kind="follow" />
            ))}
          </ul>
        ) : (
          <p className="ig-empty">No new followers this day.</p>
        )}
      </div>

      <div className="ig-col">
        <div className="ig-col-head">
          <span className="ig-col-title">Unfollowed you</span>
          <span className="ig-col-badge neg">{bucket.unfollows.length}</span>
        </div>
        {bucket.unfollows.length ? (
          <ul className="ig-user-list">
            {bucket.unfollows.map((e) => (
              <UserRow key={`u-${e.username}`} username={e.username} kind="unfollow" />
            ))}
          </ul>
        ) : (
          <p className="ig-empty">Nobody unfollowed this day. 🎉</p>
        )}
      </div>
      <span className="ig-day-detail-account" aria-hidden>
        @{account}
      </span>
    </div>
  );
}

function UserRow({ username, kind }: { username: string; kind: 'follow' | 'unfollow' }) {
  return (
    <li className="ig-user-row">
      <span className={`ig-avatar ${kind}`} aria-hidden>
        {username.slice(0, 1).toUpperCase()}
      </span>
      <a
        className="ig-user-name"
        href={`https://instagram.com/${username}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        @{username}
      </a>
      <span className={`ig-user-tag ${kind}`}>{kind === 'follow' ? 'Followed' : 'Unfollowed'}</span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ig-foot-stat">
      <span className="ig-foot-value">{value}</span>
      <span className="ig-foot-label">{label}</span>
    </div>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: 'inline-block' }}>
      <path
        d={up ? 'M6 2l4 5H2z' : 'M6 10L2 5h8z'}
        fill="currentColor"
      />
    </svg>
  );
}

/** Dependency-free area + line chart of follower count over time. */
function FollowerChart({ snapshots }: { snapshots: Snapshot[] }) {
  const W = 720;
  const H = 240;
  const padX = 8;
  const padY = 22;

  const geo = useMemo(() => {
    if (snapshots.length < 2) return null;
    const times = snapshots.map((s) => new Date(s.t).getTime());
    const vals = snapshots.map((s) => s.followers);
    const tMin = times[0];
    const tMax = times[times.length - 1];
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);
    const vPad = Math.max(1, (vMax - vMin) * 0.15);
    const lo = vMin - vPad;
    const hi = vMax + vPad;

    const x = (t: number) =>
      padX + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - padX * 2);
    const y = (v: number) => padY + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - padY * 2);

    const pts = snapshots.map((s, i) => `${x(times[i])},${y(s.followers)}`);
    const line = `M ${pts.join(' L ')}`;
    const area = `${line} L ${x(tMax)},${H - padY} L ${x(tMin)},${H - padY} Z`;
    const last = { x: x(tMax), y: y(vals[vals.length - 1]) };
    return { line, area, last, vMin, vMax };
  }, [snapshots]);

  if (!geo) {
    return <div className="ig-placeholder small">Not enough history yet to draw a graph.</div>;
  }

  return (
    <svg className="ig-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Follower count over time">
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
      <circle cx={geo.last.x} cy={geo.last.y} r="4.5" fill="#fff" stroke="#d62976" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
