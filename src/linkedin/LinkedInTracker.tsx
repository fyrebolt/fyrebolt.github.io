import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '../ios/AppShell';
import { Segmented } from '../ios';
import {
  clearLocalData,
  collapseViewers,
  dayKey,
  downloadHistoryJson,
  exactDate,
  filterRange,
  filterViewers,
  groupByDay,
  loadLocalData,
  loadTrackerData,
  monthYear,
  relationships,
  saveLocalData,
  searchPeople,
  searchViewers,
  seriesValue,
  sortPeople,
  staleness,
  statsForRange,
  timeAgo,
  topBy,
  viewsInRange,
  viewsPerDay,
  viewStats,
  type ListKind,
  type NetworkEvent,
  type Person,
  type ProfileView,
  type SeriesKey,
  type Snapshot,
  type SortKey,
  type TrackerData,
  type Viewer,
  type ViewerFilter,
} from './data';
import { Avatar, AnonAvatar } from './Avatar';
import { buildFromExport, parseExport } from './importExport';
import ProfileSheet from './ProfileSheet';
import './linkedin.css';

interface ImportState {
  busy: boolean;
  error?: string;
  note?: string;
}

type Range = '7' | '30' | '90' | '365' | '0';

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '365', label: '1Y' },
  { value: '0', label: 'All' },
];

export default function LinkedInTracker() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [range, setRange] = useState<Range>('30');
  const [importState, setImportState] = useState<ImportState>({ busy: false });

  // Mirrored into a ref so the import handler can merge onto the current data
  // without being re-created (and re-passed) on every update.
  const dataRef = useRef<TrackerData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    // Prefer locally imported data over the committed file unless the committed
    // one is newer — the daily job writes that. Local data is also how the
    // unredacted viewer log gets seen, so it must not be silently overwritten.
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
      const { lists, profile, name, history } = await parseExport(files);
      const previous = dataRef.current;

      // A dropped history.json is used as-is; a CSV export is reconstructed and
      // merged onto what we already had.
      const next = history
        ? history
        : buildFromExport(lists, profile ?? previous?.profile ?? '', name, previous);

      saveLocalData(next);
      setData(next);
      setStatus('ready');
      setImportState({
        busy: false,
        note: history
          ? `Loaded ${history.views?.length.toLocaleString() ?? 0} recorded profile views from that file.`
          : `Imported ${lists.connections.length.toLocaleString()} connections and ` +
            `${lists.followers.length.toLocaleString()} followers, with their real dates.`,
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
      title="LinkedIn Tracker"
      glyph="💼"
      maxWidth={880}
      right={
        data ? (
          <a
            className="ios-btn ios-btn-ghost li-open"
            href={`https://www.linkedin.com/in/${data.profile}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {data.name ?? `/in/${data.profile}`}
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
      />
      {status === 'loading' && <div className="li-placeholder">Loading your network history…</div>}
      {status === 'error' && (
        <div className="li-placeholder">Couldn’t load tracker data. Try again later.</div>
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

function ImportPanel({
  data,
  state,
  onFiles,
  onDownload,
  onClear,
}: {
  data: TrackerData | null;
  state: ImportState;
  onFiles: (files: File[]) => void;
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
    const files = [...(e.dataTransfer.files ?? [])];
    if (files.length) onFiles(files);
  };

  return (
    <section
      className={`li-import ${dragging ? 'is-dragging' : ''}`}
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
        accept=".zip,.csv,.json,application/zip,text/csv,application/json"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />

      {isLive ? (
        <div className="li-import-live">
          <div className="li-import-live-text">
            <strong>Live data</strong> · updated {timeAgo(data!.generatedAt)}
          </div>
          <div className="li-import-actions">
            <button className="ios-btn" onClick={pick} disabled={state.busy}>
              {state.busy ? 'Importing…' : 'Import export / private log'}
            </button>
            <button className="ios-btn" onClick={onDownload}>
              Download history.json
            </button>
            <button className="ios-btn li-btn-quiet" onClick={onClear}>
              Clear local
            </button>
          </div>
        </div>
      ) : (
        <button className="li-import-drop" onClick={pick} disabled={state.busy} type="button">
          <span className="li-import-icon" aria-hidden>
            ⬆︎
          </span>
          <span className="li-import-title">
            {state.busy ? 'Reading your export…' : 'Import your LinkedIn data export'}
          </span>
          <span className="li-import-sub">
            Drag in <code>Connections.csv</code> and <code>Followers.csv</code> — or the whole{' '}
            <code>.zip</code>. Request it via Settings → Data privacy →{' '}
            <em>Get a copy of your data</em>. Parsed entirely in your browser; email addresses are
            dropped and never stored. This backfills the real connection dates all the way back to
            the day you joined.
          </span>
        </button>
      )}

      {state.error && <p className="li-import-msg err">{state.error}</p>}
      {state.note && !state.error && <p className="li-import-msg ok">{state.note}</p>}
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
  const [series, setSeries] = useState<SeriesKey>('connections');
  const [openProfile, setOpenProfile] = useState<string | null>(null);

  const connectionStats = useMemo(
    () => statsForRange(data.snapshots, days, 'connections'),
    [data.snapshots, days],
  );
  const followerStats = useMemo(
    () => statsForRange(data.snapshots, days, 'followers'),
    [data.snapshots, days],
  );

  // Memoised because `?? []` would otherwise mint a new array on every render
  // and invalidate every downstream useMemo that depends on it.
  const views = useMemo(() => data.views ?? [], [data.views]);
  const rangeViews = useMemo(() => viewsInRange(views, days), [views, days]);
  const rangeLabel = days === 0 ? 'all time' : `last ${days} days`;

  return (
    <div className="li">
      <UnfinishedNotice />

      {data.sample ? (
        <div className="li-banner" role="note">
          <span className="li-banner-dot" aria-hidden />
          Showing sample data. Run the daily pull (or import your export above) to track{' '}
          <strong>/in/{data.profile}</strong> for real.
        </div>
      ) : (
        <StaleBanner generatedAt={data.generatedAt} />
      )}

      {data.redacted && (
        <div className="li-banner is-redacted" role="note">
          <span className="li-banner-dot" aria-hidden />
          <span>
            <strong>Viewer names are withheld from the published file.</strong> Everyone who looked
            at your profile is counted here, but they’re identified only by company and headline —
            they never agreed to be listed on a public page. Drop in{' '}
            <code>scripts/.linkedin-private.json</code> to see the full log on this device.
          </span>
        </div>
      )}

      <section className="li-hero">
        <HeroStat
          label="Connections"
          value={connectionStats.current}
          delta={connectionStats.delta}
          rangeLabel={rangeLabel}
          tone="blue"
        />
        <HeroStat
          label="Followers"
          value={followerStats.current}
          delta={followerStats.delta}
          rangeLabel={rangeLabel}
          tone="teal"
        />
        <HeroStat
          label="Profile views"
          value={rangeViews.length}
          rangeLabel={rangeLabel}
          tone="amber"
        />
        <Segmented
          options={RANGE_OPTIONS}
          value={range}
          onChange={setRange}
          className="li-range"
        />
      </section>

      <ChartCard data={data} range={range} series={series} setSeries={setSeries} />

      <ViewersSection views={views} redacted={data.redacted} onOpen={setOpenProfile} />

      <NetworkActivity events={data.events} onOpen={setOpenProfile} />

      <PeopleSection
        connections={data.connections ?? []}
        followers={data.followers ?? []}
        onOpen={setOpenProfile}
      />

      {openProfile && (
        <ProfileSheet
          key={openProfile}
          id={openProfile}
          data={data}
          onClose={() => setOpenProfile(null)}
        />
      )}
    </div>
  );
}

function HeroStat({
  label,
  value,
  delta,
  rangeLabel,
  tone,
}: {
  label: string;
  value: number;
  delta?: number;
  rangeLabel: string;
  tone: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className={`li-hero-stat tone-${tone}`}>
      <span className="li-hero-label">{label}</span>
      <span className="li-hero-count">{value.toLocaleString()}</span>
      {delta == null ? (
        <span className="li-hero-sub">{rangeLabel}</span>
      ) : (
        <span className={`li-delta ${up ? 'up' : 'down'}`}>
          <Arrow up={up} /> {up ? '+' : ''}
          {delta.toLocaleString()} <span className="li-delta-sub">· {rangeLabel}</span>
        </span>
      )}
    </div>
  );
}

/**
 * States plainly that this isn't finished.
 *
 * The page is deployed and reachable even though it's off the home screen, so
 * someone can land here cold. Everything below renders real, working UI over
 * sample data, which is exactly the kind of thing that reads as a live tracker
 * unless it says otherwise.
 */
function UnfinishedNotice() {
  return (
    <div className="li-banner is-unfinished" role="note">
      <span className="li-banner-dot" aria-hidden />
      <span>
        <strong>Unfinished — a work in progress.</strong> The app itself works, but the daily pull
        behind it doesn’t yet: LinkedIn cuts off a scripted session after a handful of requests, so
        profile-view collection isn’t reliable. Connections can be loaded from the official data
        export (above), which needs no API at all. Details in the{' '}
        <a href="https://github.com/fyrebolt/fyrebolt.github.io#-linkedin-tracker-linkedin-unfinished">
          README
        </a>
        .
      </span>
    </div>
  );
}

/**
 * Warns when the daily pull has clearly stopped.
 *
 * This is more urgent than the equivalent Instagram banner: a follower you miss
 * today is still there tomorrow, but LinkedIn drops viewers off the list within
 * days, so every skipped run loses profile views permanently.
 */
function StaleBanner({ generatedAt }: { generatedAt: string }) {
  const { hours, level } = staleness(generatedAt);
  if (level === 'ok') return null;

  const days = Math.floor(hours / 24);
  const age = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.round(hours)} hours`;

  return (
    <div className={`li-banner is-stale ${level}`} role="alert">
      <span className="li-banner-dot" aria-hidden />
      <span>
        <strong>Tracking may have stopped</strong> — last successful pull was {age} ago, and profile
        views seen in the meantime are gone for good. The usual cause is an expired{' '}
        <code>li_at</code> cookie. Check with <code>./scripts/linkedin-schedule.sh status</code>.
      </span>
    </div>
  );
}

// ===== Who viewed your profile =====

const VIEWER_FILTERS: Array<{ value: ViewerFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'named', label: 'Named' },
  { value: 'anonymous', label: 'Anonymous' },
  { value: 'repeat', label: 'Repeat' },
];

const VIEW_BAR_DAYS = 30;

function ViewersSection({
  views,
  redacted,
  onOpen,
}: {
  views: ProfileView[];
  redacted?: boolean;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<ViewerFilter>('all');
  const [query, setQuery] = useState('');
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const stats = useMemo(() => viewStats(views), [views]);
  const bars = useMemo(() => viewsPerDay(views, VIEW_BAR_DAYS), [views]);
  const companies = useMemo(() => topBy(views, 'company'), [views]);

  // A picked day narrows the list to that day's visitors; otherwise it's everyone.
  const scoped = useMemo(
    () => (pickedDay ? views.filter((v) => dayKey(v.t) === pickedDay) : views),
    [views, pickedDay],
  );
  const viewers = useMemo(() => collapseViewers(scoped), [scoped]);
  const rows = useMemo(
    () => searchViewers(filterViewers(viewers, filter), query),
    [viewers, filter, query],
  );

  if (views.length === 0) {
    return (
      <section className="li-card li-viewers">
        <h2 className="li-section-title">Who viewed your profile</h2>
        <div className="li-placeholder small">
          No profile views recorded yet. LinkedIn shows only your most recent viewers and drops them
          after 90 days — the daily pull unions each day’s visible list into a permanent log, so this
          fills in from the first run onwards.
        </div>
      </section>
    );
  }

  const peak = Math.max(1, ...bars.map((b) => b.count));

  return (
    <section className="li-card li-viewers">
      <div className="li-section-head">
        <h2 className="li-section-title">Who viewed your profile</h2>
        <span className="li-section-sub">
          {stats.total.toLocaleString()} views · {stats.people.toLocaleString()} named people ·{' '}
          {stats.repeat.toLocaleString()} came back
        </span>
      </div>

      <div className="li-viewbars" role="img" aria-label={`Profile views per day, last ${VIEW_BAR_DAYS} days`}>
        {bars.map((b) => (
          <button
            key={b.key}
            className={`li-viewbar ${b.key === pickedDay ? 'is-active' : ''} ${b.count === 0 ? 'is-empty' : ''}`}
            style={{ '--h': `${(b.count / peak) * 100}%` } as React.CSSProperties}
            onClick={() => setPickedDay(pickedDay === b.key ? null : b.count ? b.key : null)}
            disabled={b.count === 0}
            title={`${shortDate(b.key)} — ${b.count} view${b.count === 1 ? '' : 's'}`}
            aria-label={`${shortDate(b.key)}, ${b.count} views`}
          >
            <span className="li-viewbar-fill" aria-hidden />
          </button>
        ))}
      </div>
      <div className="li-viewbars-axis">
        <span>{shortDate(bars[0].key)}</span>
        {stats.busiestDay && (
          <span className="li-viewbars-peak">
            busiest: {shortDate(stats.busiestDay.key)} ({stats.busiestDay.count})
          </span>
        )}
        <span>today</span>
      </div>

      {companies.length > 0 && (
        <div className="li-rollup">
          <span className="li-rollup-label">Most views from</span>
          {companies.map((c) => (
            <button
              key={c.label}
              className={`li-chip-btn ${query === c.label ? 'is-active' : ''}`}
              onClick={() => setQuery(query === c.label ? '' : c.label)}
            >
              {c.label} <span className="li-chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="li-controls">
        <div className="li-search">
          <SearchIcon />
          <input
            className="ios-input li-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search viewers by name, title or company"
            aria-label="Search viewers"
          />
        </div>
        <Segmented options={VIEWER_FILTERS} value={filter} onChange={setFilter} className="li-sort" />
      </div>

      {pickedDay && (
        <p className="li-scope">
          Showing {shortDate(pickedDay)} only
          <button className="li-scope-clear" onClick={() => setPickedDay(null)}>
            show all days
          </button>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="li-empty">Nobody in this view matches.</p>
      ) : (
        <ul className="li-viewer-list">
          {rows.slice(0, 120).map((v) => (
            <ViewerRow key={v.key} viewer={v} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {rows.length > 120 && (
        <p className="li-empty">+ {(rows.length - 120).toLocaleString()} more — narrow the search.</p>
      )}

      <p className="li-note">
        {redacted
          ? 'Names are withheld from the published file by design. '
          : ''}
        Anonymous viewers are LinkedIn’s own doing — people browsing in private mode, or whose
        setting hides them. Two anonymous viewers described the same way are indistinguishable, so
        the “{stats.anonymous.toLocaleString()} anonymous” figure counts views, not people.
      </p>
    </section>
  );
}

function ViewerRow({ viewer, onOpen }: { viewer: Viewer; onOpen: (id: string) => void }) {
  const title = viewer.name ?? viewer.label ?? 'Someone on LinkedIn';
  // A redacted viewer's label already reads "Someone at Acme", so repeating the
  // company underneath it just says Acme twice.
  const company =
    viewer.company && !title.includes(viewer.company) ? viewer.company : undefined;
  const sub = [viewer.headline, company].filter(Boolean).join(' · ');

  return (
    <li className={`li-viewer ${viewer.anonymous ? 'is-anon' : ''}`}>
      {viewer.anonymous ? <AnonAvatar /> : <Avatar seed={viewer.id ?? title} label={viewer.name} />}
      <span className="li-viewer-text">
        <span className="li-viewer-top">
          {viewer.id ? (
            <button className="li-viewer-name" onClick={() => onOpen(viewer.id!)}>
              {title}
            </button>
          ) : (
            <span className="li-viewer-name is-static">{title}</span>
          )}
          {viewer.degree ? <span className="li-degree">{degreeLabel(viewer.degree)}</span> : null}
          {viewer.visits > 1 && <span className="li-badge repeat">{viewer.visits}× </span>}
        </span>
        {sub && <span className="li-viewer-sub">{sub}</span>}
      </span>
      <span className="li-viewer-when" title={exactDate(viewer.lastAt)}>
        {timeAgo(viewer.lastAt)}
      </span>
    </li>
  );
}

function degreeLabel(d: number): string {
  return d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`;
}

// ===== Network activity =====

function NetworkActivity({
  events,
  onOpen,
}: {
  events: NetworkEvent[];
  onOpen: (id: string) => void;
}) {
  const buckets = useMemo(() => groupByDay(events), [events]);
  const [selectedDay, setSelectedDay] = useState<string>(() => buckets[0]?.key ?? '');
  const selected = buckets.find((b) => b.key === selectedDay) ?? buckets[0];

  if (buckets.length === 0) {
    return (
      <section className="li-card li-activity">
        <h2 className="li-section-title">Network activity</h2>
        <div className="li-placeholder small">
          No connection changes recorded yet — the first daily run sets the baseline.
        </div>
      </section>
    );
  }

  return (
    <section className="li-card li-activity">
      <h2 className="li-section-title">Network activity</h2>
      <div className="li-day-strip" role="tablist" aria-label="Days with activity">
        {buckets.slice(0, 30).map((b) => (
          <button
            key={b.key}
            role="tab"
            aria-selected={b.key === selected?.key}
            className={`li-day-chip ${b.key === selected?.key ? 'is-active' : ''}`}
            onClick={() => setSelectedDay(b.key)}
          >
            <span className="li-day-chip-date">{shortDate(b.key)}</span>
            <span className="li-day-chip-net">
              <span className="pos">+{b.connects.length}</span>
              {b.disconnects.length > 0 && <span className="neg">−{b.disconnects.length}</span>}
              {b.follows.length > 0 && <span className="out">⇢{b.follows.length}</span>}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="li-day-detail">
          <DayColumn
            title="New connections"
            tone="pos"
            events={selected.connects}
            empty="No new connections this day."
            onOpen={onOpen}
          />
          <DayColumn
            title="Connections lost"
            tone="neg"
            events={selected.disconnects}
            empty="Nobody disconnected. 🎉"
            onOpen={onOpen}
          />
          {selected.follows.length > 0 && (
            <DayColumn
              title="Followers"
              tone="out"
              events={selected.follows}
              empty=""
              onOpen={onOpen}
            />
          )}
        </div>
      )}
    </section>
  );
}

function DayColumn({
  title,
  tone,
  events,
  empty,
  onOpen,
}: {
  title: string;
  tone: string;
  events: NetworkEvent[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="li-col">
      <div className="li-col-head">
        <span className="li-col-title">{title}</span>
        <span className={`li-col-badge ${tone}`}>{events.length}</span>
      </div>
      {events.length ? (
        <ul className="li-user-list">
          {events.map((e) => (
            <li key={`${e.kind}-${e.id}-${e.t}`} className="li-user-row">
              <Avatar seed={e.id} label={e.name} small />
              <button className="li-user-name" onClick={() => onOpen(e.id)}>
                <span className="li-user-title">{e.name ?? e.id}</span>
                {e.headline && <span className="li-user-headline">{e.headline}</span>}
              </button>
              <span className={`li-user-tag ${tone}`}>{eventLabel(e)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="li-empty">{empty}</p>
      )}
    </div>
  );
}

function eventLabel(e: NetworkEvent): string {
  if (e.kind === 'connect') return 'connected';
  if (e.kind === 'disconnect') return 'disconnected';
  if (e.kind === 'follow') return e.dir === 'out' ? 'you followed' : 'followed';
  return e.dir === 'out' ? 'you unfollowed' : 'unfollowed';
}

// ===== People browser =====

const TABS: Array<{ kind: ListKind; label: string; tone: string }> = [
  { kind: 'connections', label: 'Connections', tone: 'blue' },
  { kind: 'followers', label: 'Followers', tone: 'teal' },
  { kind: 'both', label: 'Connected + following', tone: 'green' },
  { kind: 'onlyFollowers', label: 'Following, not connected', tone: 'amber' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

const HINTS: Record<ListKind, string> = {
  connections: 'Your 1st-degree connections — mutual by definition.',
  followers: 'Everyone who follows your posts.',
  both: 'Connected to you and following your posts.',
  onlyFollowers: 'They follow you without ever having connected.',
};

function PeopleSection({
  connections,
  followers,
  onOpen,
}: {
  connections: Person[];
  followers: Person[];
  onOpen: (id: string) => void;
}) {
  const [kind, setKind] = useState<ListKind>('connections');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  const sets = useMemo(() => relationships(connections, followers), [connections, followers]);
  const rows = useMemo(
    () => sortPeople(searchPeople(sets[kind], query), sort),
    [sets, kind, query, sort],
  );

  if (connections.length === 0 && followers.length === 0) {
    return (
      <section className="li-card li-people">
        <h2 className="li-section-title">People</h2>
        <div className="li-placeholder small">
          Your connections appear here after the first daily pull, or as soon as you import a data
          export.
        </div>
      </section>
    );
  }

  return (
    <section className="li-card li-people">
      <div className="li-section-head">
        <h2 className="li-section-title">People</h2>
        <span className="li-section-sub">{HINTS[kind]}</span>
      </div>

      <div className="li-tabs" role="tablist" aria-label="Network lists">
        {TABS.map((t) => (
          <button
            key={t.kind}
            role="tab"
            aria-selected={t.kind === kind}
            className={`li-tab tone-${t.tone} ${t.kind === kind ? 'is-active' : ''}`}
            onClick={() => {
              setKind(t.kind);
              setQuery('');
            }}
          >
            <span className="li-tab-count">{sets[t.kind].length.toLocaleString()}</span>
            <span className="li-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="li-controls">
        <div className="li-search">
          <SearchIcon />
          <input
            className="ios-input li-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, title or company"
            aria-label="Search people"
          />
        </div>
        <Segmented options={SORT_OPTIONS} value={sort} onChange={setSort} className="li-sort" />
      </div>

      {rows.length === 0 ? (
        <p className="li-empty">
          {query ? `Nobody in this list matches “${query}”.` : 'This list is empty.'}
        </p>
      ) : (
        // Keyed on the query so switching tab / search / sort remounts the
        // scroller, which puts you back at the top of the new list.
        <VirtualList key={`${kind}|${query}|${sort}`} rows={rows} onOpen={onOpen} />
      )}

      <p className="li-people-foot">
        {rows.length.toLocaleString()} shown
        {query ? ` of ${sets[kind].length.toLocaleString()}` : ''}
      </p>
    </section>
  );
}

const ROW_H = 62;
const VIEWPORT_H = 496;
const OVERSCAN = 5;

/**
 * Windowed list — only the visible slice is in the DOM, so a few thousand rows
 * scroll as smoothly as a dozen. Rows are a fixed height by design.
 */
function VirtualList({ rows, onOpen }: { rows: Person[]; onOpen: (id: string) => void }) {
  const [scrollTop, setScrollTop] = useState(0);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visible = Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2;
  const slice = rows.slice(first, first + visible);

  return (
    <div
      className="li-people-scroll"
      style={{ height: Math.min(VIEWPORT_H, rows.length * ROW_H) }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="li-people-spacer" style={{ height: rows.length * ROW_H }}>
        <ul className="li-people-list" style={{ transform: `translateY(${first * ROW_H}px)` }}>
          {slice.map((p) => (
            <PersonRow key={p.id} person={p} onOpen={onOpen} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: (id: string) => void }) {
  const since = monthYear(person.since);
  const sub = [person.headline, person.company].filter(Boolean).join(' · ');

  return (
    <li className="li-person" style={{ height: ROW_H }}>
      <button
        className="li-person-open"
        onClick={() => onOpen(person.id)}
        aria-label={`Details for ${person.name ?? person.id}`}
      />
      <Avatar seed={person.id} label={person.name} />
      <span className="li-person-text">
        <span className="li-person-name">{person.name ?? person.id}</span>
        {sub && <span className="li-person-sub">{sub}</span>}
      </span>
      {since && <span className="li-person-since">{since}</span>}
    </li>
  );
}

function SearchIcon() {
  return (
    <svg className="li-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: 'inline-block' }}>
      <path d={up ? 'M6 2l4 5H2z' : 'M6 10L2 5h8z'} fill="currentColor" />
    </svg>
  );
}

// ===== Chart =====

const W = 720;
const H = 220;
const PAD_X = 10;
const PAD_Y = 22;

const SERIES_OPTIONS: Array<{ value: SeriesKey; label: string }> = [
  { value: 'connections', label: 'Connections' },
  { value: 'followers', label: 'Followers' },
  { value: 'views', label: 'Views (90d)' },
];

interface Geo {
  line: string;
  area: string;
  times: number[];
  vals: number[];
  points: Array<{ t: number; v: number }>;
  x: (t: number) => number;
  y: (v: number) => number;
}

function buildGeo(snapshots: Snapshot[], key: SeriesKey): Geo | null {
  const points = snapshots
    .map((s) => ({ t: new Date(s.t).getTime(), v: seriesValue(s, key) }))
    .filter((p): p is { t: number; v: number } => p.v != null && Number.isFinite(p.t));
  if (points.length < 2) return null;

  const times = points.map((p) => p.t);
  const vals = points.map((p) => p.v);
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

  const line = `M ${points.map((p) => `${x(p.t)},${y(p.v)}`).join(' L ')}`;
  const area = `${line} L ${x(tMax)},${H - PAD_Y} L ${x(tMin)},${H - PAD_Y} Z`;
  return { line, area, times, vals, points, x, y };
}

function ChartCard({
  data,
  range,
  series,
  setSeries,
}: {
  data: TrackerData;
  range: Range;
  series: SeriesKey;
  setSeries: (s: SeriesKey) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const visible = useMemo(() => filterRange(data.snapshots, Number(range)), [data.snapshots, range]);
  const geo = useMemo(() => buildGeo(visible, series), [visible, series]);

  const onMove = (e: React.PointerEvent) => {
    if (!geo) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < geo.points.length; i++) {
      const d = Math.abs(geo.x(geo.points[i].t) - svgX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  };

  const label = SERIES_OPTIONS.find((o) => o.value === series)!.label;

  return (
    <section className="li-card li-chart-card">
      <div className="li-chart-head">
        <Segmented options={SERIES_OPTIONS} value={series} onChange={setSeries} className="li-series" />
        {geo && (
          <span className="li-chart-span">
            {fullDate(new Date(geo.times[0]).toISOString())} —{' '}
            {fullDate(new Date(geo.times[geo.times.length - 1]).toISOString())}
          </span>
        )}
      </div>

      {!geo ? (
        <div className="li-placeholder small">
          Not enough history yet to draw {label.toLowerCase()}.
        </div>
      ) : (
        <>
          <div className="li-chart-wrap">
            <svg
              ref={svgRef}
              className="li-chart"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${label} over time`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id="liArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0a66c2" stopOpacity="0.26" />
                  <stop offset="100%" stopColor="#0a66c2" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={geo.area} fill="url(#liArea)" />
              <path
                d={geo.line}
                fill="none"
                stroke="#0a66c2"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {hover != null && geo.points[hover] && (
                <g>
                  <line
                    x1={geo.x(geo.points[hover].t)}
                    y1={PAD_Y}
                    x2={geo.x(geo.points[hover].t)}
                    y2={H - PAD_Y}
                    className="li-chart-crosshair"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={geo.x(geo.points[hover].t)}
                    cy={geo.y(geo.points[hover].v)}
                    r="5"
                    fill="#fff"
                    stroke="#0a66c2"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </svg>

            {hover != null && geo.points[hover] && (
              <div
                className="li-tip"
                style={tipPosition((geo.x(geo.points[hover].t) / W) * 100)}
              >
                <span className="li-tip-date">
                  {fullDate(new Date(geo.points[hover].t).toISOString())}
                </span>
                <span className="li-tip-count">
                  {geo.points[hover].v.toLocaleString()} {label.toLowerCase()}
                </span>
              </div>
            )}
          </div>

          <div className="li-chart-foot">
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
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="li-foot-stat">
      <span className="li-foot-value">{value}</span>
      <span className="li-foot-label">{label}</span>
    </div>
  );
}

/** Keep the readout inside the card: centre it, but flush it at either end. */
function tipPosition(pct: number): React.CSSProperties {
  if (pct < 22) return { left: 0, transform: 'none' };
  if (pct > 78) return { left: '100%', transform: 'translateX(-100%)' };
  return { left: `${pct}%`, transform: 'translateX(-50%)' };
}

function fullDate(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
    : new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
