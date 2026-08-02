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
  staleness,
  statsForRange,
  type DayBucket,
  type FollowEvent,
  type TrackerData,
} from './data';
import { parseExport, buildFromExport } from './importZip';
import ImportPanel, { type ImportState } from './ImportPanel';
import FollowerChart from './FollowerChart';
import PeopleSection from './PeopleSection';
import ProfileSheet from './ProfileSheet';
import './instagram.css';

type Range = '7' | '30' | '90' | '365' | '0';

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '365', label: '1Y' },
  { value: '0', label: 'All' },
];

export default function InstagramTracker() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [range, setRange] = useState<Range>('30');
  const [importState, setImportState] = useState<ImportState>({ busy: false });

  // Mirrored into a ref so handleFile can diff against the current data without
  // being re-created (and re-passed) on every update. Written after commit.
  const dataRef = useRef<TrackerData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    // Prefer locally imported data (from a data-export ZIP) over the committed
    // file, unless the committed one is newer — the daily job writes that.
    const local = loadLocalData();
    loadTrackerData().then((remote) => {
      if (cancelled) return;
      const best = pickFresher(local, remote);
      setData(best);
      setStatus(best ? 'ready' : 'error');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    setImportState({ busy: true });
    try {
      const imported = await parseExport(files);
      const next = buildFromExport(imported, dataRef.current);
      saveLocalData(next);
      setData(next);
      setStatus('ready');
      setImportState({
        busy: false,
        note:
          `Imported ${imported.followers.length.toLocaleString()} followers and ` +
          `${imported.following.length.toLocaleString()} following.`,
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

  /**
   * A local "Update now" run just finished. Its output comes straight from the
   * agent rather than the network, because the deployed copy of history.json is
   * a GitHub Pages redeploy behind.
   */
  const handlePulled = useCallback((fresh: TrackerData) => {
    saveLocalData(fresh);
    setData(fresh);
    setStatus('ready');
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
        onFiles={handleFiles}
        onDownload={() => data && downloadHistoryJson(data)}
        onClear={handleClear}
        onPulled={handlePulled}
      />
      {status === 'loading' && <div className="ig-placeholder">Loading follower history…</div>}
      {status === 'error' && (
        <div className="ig-placeholder">Couldn’t load tracker data. Try again later.</div>
      )}
      {status === 'ready' && data && <TrackerBody data={data} range={range} setRange={setRange} />}
    </AppShell>
  );
}

/** Whichever source has the more recent successful check wins. */
function pickFresher(a: TrackerData | null, b: TrackerData | null): TrackerData | null {
  if (!a) return b;
  if (!b) return a;
  const ta = new Date(a.generatedAt).getTime() || 0;
  const tb = new Date(b.generatedAt).getTime() || 0;
  return tb > ta ? b : a;
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
  const stats = useMemo(() => statsForRange(data.snapshots, days), [data.snapshots, days]);
  const buckets = useMemo(() => groupByDay(data.events), [data.events]);

  // Chart zoom + pinned day. Held here so picking a preset can clear the zoom.
  const [domain, setDomain] = useState<[number, number] | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [openProfile, setOpenProfile] = useState<string | null>(null);

  const [selectedDay, setSelectedDay] = useState<string>(() => buckets[0]?.key ?? '');
  const selected = buckets.find((b) => b.key === selectedDay) ?? buckets[0];

  const rangeLabel = days === 0 ? 'all time' : `last ${days} days`;
  const up = stats.delta >= 0;

  return (
    <div className="ig">
      {data.sample ? (
        <div className="ig-banner" role="note">
          <span className="ig-banner-dot" aria-hidden />
          Showing sample data. Run the daily pull (or import your export above) to track{' '}
          <strong>@{data.account}</strong> for real.
        </div>
      ) : (
        <StaleBanner generatedAt={data.generatedAt} />
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
        <Segmented
          options={RANGE_OPTIONS}
          value={range}
          onChange={(r) => {
            setRange(r);
            setDomain(null);
          }}
          className="ig-range"
        />
      </section>

      <FollowerChart
        data={data}
        days={days}
        domain={domain}
        setDomain={setDomain}
        selected={pickedDay}
        setSelected={setPickedDay}
        onOpen={setOpenProfile}
      />

      <section className="ig-activity">
        <h2 className="ig-section-title">Daily activity</h2>
        {buckets.length === 0 ? (
          <div className="ig-placeholder small">
            No follow/unfollow activity recorded yet — the first daily run sets the baseline.
          </div>
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
                    {b.outbound.length > 0 && <span className="out">⇢{b.outbound.length}</span>}
                  </span>
                </button>
              ))}
            </div>

            {selected && (
              <DayDetail bucket={selected} account={data.account} onOpen={setOpenProfile} />
            )}
          </>
        )}
      </section>

      <PeopleSection
        followers={data.followers ?? []}
        following={data.following ?? []}
        onOpen={setOpenProfile}
      />

      {openProfile && (
        <ProfileSheet
          key={openProfile}
          username={openProfile}
          data={data}
          onClose={() => setOpenProfile(null)}
        />
      )}
    </div>
  );
}

/**
 * Warns when the daily pull has clearly stopped. The site can't reach the job,
 * so the age of the data is the only signal available to it — and a tracker that
 * has silently stalled is worse than one that says so.
 */
function StaleBanner({ generatedAt }: { generatedAt: string }) {
  const { hours, level } = staleness(generatedAt);
  if (level === 'ok') return null;

  const days = Math.floor(hours / 24);
  const age = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.round(hours)} hours`;

  return (
    <div className={`ig-banner is-stale ${level}`} role="alert">
      <span className="ig-banner-dot" aria-hidden />
      <span>
        <strong>Tracking may have stopped</strong> — last successful pull was {age} ago. The most
        likely cause is an expired Instagram session cookie. Check with{' '}
        <code>./scripts/instagram-schedule.sh status</code>.
      </span>
    </div>
  );
}

function DayDetail({
  bucket,
  account,
  onOpen,
}: {
  bucket: DayBucket;
  account: string;
  onOpen: (username: string) => void;
}) {
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
              <UserRow key={`f-${e.username}`} event={e} onOpen={onOpen} />
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
              <UserRow key={`u-${e.username}`} event={e} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="ig-empty">Nobody unfollowed this day. 🎉</p>
        )}
      </div>
      {bucket.outbound.length > 0 && (
        <div className="ig-col ig-col-out">
          <div className="ig-col-head">
            <span className="ig-col-title">You did</span>
            <span className="ig-col-badge out">{bucket.outbound.length}</span>
          </div>
          <ul className="ig-user-list">
            {bucket.outbound.map((e) => (
              <UserRow key={`o-${e.kind}-${e.username}`} event={e} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}
      <span className="ig-day-detail-account" aria-hidden>
        @{account}
      </span>
    </div>
  );
}

function UserRow({
  event,
  onOpen,
}: {
  event: FollowEvent;
  onOpen: (username: string) => void;
}) {
  return (
    <li className="ig-user-row">
      <span className={`ig-avatar ${event.dir === 'out' ? 'out' : event.kind}`} aria-hidden>
        {event.username.slice(0, 1).toUpperCase()}
      </span>
      <button className="ig-user-name" onClick={() => onOpen(event.username)}>
        {event.name ? (
          <>
            {event.name} <span className="ig-user-handle">@{event.username}</span>
          </>
        ) : (
          `@${event.username}`
        )}
      </button>
      <span className={`ig-user-tag ${event.dir === 'out' ? 'out' : event.kind}`}>
        {event.dir === 'out'
          ? `You ${event.kind === 'follow' ? 'followed' : 'unfollowed'}`
          : event.kind === 'follow'
            ? 'Followed'
            : 'Unfollowed'}
      </span>
    </li>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: 'inline-block' }}>
      <path d={up ? 'M6 2l4 5H2z' : 'M6 10L2 5h8z'} fill="currentColor" />
    </svg>
  );
}

function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
