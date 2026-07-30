import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '../ios/AppShell';
import { Segmented } from '../ios';
import {
  buildDayActivity,
  dayKey,
  groupByDay,
  loadTrackerData,
  loadLocalData,
  saveLocalData,
  clearLocalData,
  downloadHistoryJson,
  filterRange,
  monthYear,
  relationships,
  searchProfiles,
  sortProfiles,
  staleness,
  statsForRange,
  timeAgo,
  trackingStartedAt,
  type DayActivity,
  type DayBucket,
  type FollowEvent,
  type ListKind,
  type Profile,
  type Snapshot,
  type SortKey,
  type TrackerData,
} from './data';
import { parseExport, buildFromExport } from './importZip';
import {
  probeAgent,
  startPull,
  fetchStatus,
  fetchHistory,
  loadToken,
  saveToken,
  clearToken,
  type AgentStatus,
} from './agent';
import ProfileSheet from './ProfileSheet';
import './instagram.css';

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

function ImportPanel({
  data,
  state,
  onFiles,
  onDownload,
  onClear,
  onPulled,
}: {
  data: TrackerData | null;
  state: ImportState;
  onFiles: (files: File[]) => void;
  onDownload: () => void;
  onClear: () => void;
  onPulled: (fresh: TrackerData) => void;
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
        accept=".zip,.json,application/zip,application/json"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />

      {isLive ? (
        <div className="ig-import-live">
          <div className="ig-import-live-text">
            <strong>Live data</strong> · updated {timeAgo(data!.generatedAt)}
          </div>
          <div className="ig-import-actions">
            <UpdateNow onPulled={onPulled} />
            <button className="ios-btn" onClick={pick} disabled={state.busy}>
              {state.busy ? 'Importing…' : 'Backfill from export'}
            </button>
            <button className="ios-btn" onClick={onDownload}>
              Download history.json
            </button>
            <button className="ios-btn ig-btn-quiet" onClick={onClear}>
              Clear local
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
            Drag in <code>followers_1.json</code> and <code>following.json</code> — or the whole{' '}
            <code>.zip</code>. Export via Accounts Center → Download your information →{' '}
            <em>Followers and following</em> (JSON). Parsed entirely in your browser — this
            backfills the real follow dates the daily job can’t see.
          </span>
        </button>
      )}

      {state.error && <p className="ig-import-msg err">{state.error}</p>}
      {state.note && !state.error && <p className="ig-import-msg ok">{state.note}</p>}
    </section>
  );
}

/**
 * "Update now" — triggers a pull via the local agent (scripts/instagram-agent.mjs).
 *
 * Renders nothing at all unless the agent answers on loopback, so on any other
 * device, or in anyone else's browser, the button simply doesn't exist rather
 * than sitting there dead.
 */
function UpdateNow({ onPulled }: { onPulled: (fresh: TrackerData) => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [asking, setAsking] = useState(false);
  const [entry, setEntry] = useState('');
  const [run, setRun] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    probeAgent().then(setAvailable);
  }, []);

  const begin = useCallback(
    async (withToken: string) => {
      setBusy(true);
      setNote(null);
      const res = await startPull(withToken);
      if (res.kind === 'badToken') {
        clearToken();
        setToken(null);
        setAsking(true);
        setNote('That passphrase was rejected.');
        setBusy(false);
        return;
      }
      if (res.kind !== 'started') {
        setNote(res.message);
        setBusy(false);
        return;
      }
      saveToken(withToken);
      setToken(withToken);
      setAsking(false);
      setRun({
        running: true,
        phase: 'starting',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        followers: null,
        following: null,
        ok: null,
        summary: null,
        error: null,
      });
    },
    [],
  );

  // Poll while a run is in flight. A full pull takes a few minutes.
  useEffect(() => {
    if (!run?.running || !token) return;
    let stop = false;
    const tick = async () => {
      const status = await fetchStatus(token);
      if (stop) return;
      if (!status) {
        setRun(null);
        setBusy(false);
        setNote('Lost contact with the agent.');
        return;
      }
      setRun(status);
      if (!status.running) setBusy(false);
    };
    const id = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [run?.running, token]);

  /**
   * Load the freshly written file once a run succeeds.
   *
   * Deliberately separate from the polling effect: marking the run finished
   * re-renders, which tears that effect down, and an in-flight fetch there would
   * be cancelled by its own cleanup — dropping the update it was fetching.
   */
  const deliveredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!token || !run || run.running || !run.ok || !run.finishedAt) return;
    if (deliveredRef.current === run.finishedAt) return; // one delivery per run
    deliveredRef.current = run.finishedAt;
    fetchHistory(token).then((fresh) => {
      if (fresh) onPulled(fresh as TrackerData);
    });
  }, [run, token, onPulled]);

  if (available !== true) return null;

  if (run?.running) {
    const counts = [
      run.followers != null ? `${run.followers} followers` : null,
      run.following != null ? `${run.following} following` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <span className="ig-agent ig-agent-running" role="status">
        <Spinner /> {run.phase}
        {counts ? ` — ${counts}` : ''}
      </span>
    );
  }

  if (asking) {
    return (
      <form
        className="ig-agent-unlock"
        onSubmit={(e) => {
          e.preventDefault();
          if (entry.trim()) begin(entry.trim());
        }}
      >
        <input
          className="ios-input ig-agent-input"
          type="password"
          value={entry}
          autoFocus
          onChange={(e) => setEntry(e.target.value)}
          placeholder="Agent passphrase"
          aria-label="Agent passphrase"
        />
        <button className="ios-btn ios-btn-primary" type="submit" disabled={!entry.trim() || busy}>
          Unlock
        </button>
        <button
          className="ios-btn ig-btn-quiet"
          type="button"
          onClick={() => {
            setAsking(false);
            setNote(null);
          }}
        >
          Cancel
        </button>
        {note && <span className="ig-agent-note err">{note}</span>}
      </form>
    );
  }

  return (
    <>
      <button
        className="ios-btn ios-btn-primary ig-agent-btn"
        disabled={busy}
        onClick={() => (token ? begin(token) : setAsking(true))}
      >
        ⟳ {busy ? 'Starting…' : 'Update now'}
      </button>
      {run && !run.running && (
        <span className={`ig-agent-note ${run.ok ? 'ok' : 'err'}`} role="status">
          {run.ok ? run.summary ?? 'Updated.' : run.error ?? 'Update failed.'}
        </span>
      )}
      {note && <span className="ig-agent-note err">{note}</span>}
    </>
  );
}

function Spinner() {
  return <span className="ig-spinner" aria-hidden />;
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

      <ChartCard
        data={data}
        range={range}
        domain={domain}
        setDomain={setDomain}
        selected={pickedDay}
        setSelected={setPickedDay}
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

            {selected && <DayDetail bucket={selected} account={data.account} />}
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

// ===== People browser =====

const TABS: Array<{ kind: ListKind; label: string; tone: string }> = [
  { kind: 'followers', label: 'Followers', tone: 'blue' },
  { kind: 'following', label: 'Following', tone: 'violet' },
  { kind: 'mutuals', label: 'Mutuals', tone: 'green' },
  { kind: 'fans', label: 'You don’t follow back', tone: 'amber' },
  { kind: 'ghosts', label: 'Don’t follow you back', tone: 'pink' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

const HINTS: Record<ListKind, string> = {
  followers: 'Everyone who follows you.',
  following: 'Everyone you follow.',
  mutuals: 'You follow each other.',
  fans: 'They follow you and you haven’t followed back.',
  ghosts: 'You follow them and they haven’t followed back.',
};

function PeopleSection({
  followers,
  following,
  onOpen,
}: {
  followers: Profile[];
  following: Profile[];
  onOpen: (username: string) => void;
}) {
  const [kind, setKind] = useState<ListKind>('followers');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  const sets = useMemo(() => relationships(followers, following), [followers, following]);
  const mutualKeys = useMemo(
    () => new Set(sets.mutuals.map((p) => p.username.toLowerCase())),
    [sets.mutuals],
  );

  const rows = useMemo(
    () => sortProfiles(searchProfiles(sets[kind], query), sort),
    [sets, kind, query, sort],
  );

  if (followers.length === 0 && following.length === 0) {
    return (
      <section className="ig-people">
        <h2 className="ig-section-title">People</h2>
        <div className="ig-placeholder small">
          The follower and following lists appear here after the first daily pull, or as soon as you
          import a data export.
        </div>
      </section>
    );
  }

  const total = followers.length + following.length;

  return (
    <section className="ig-people">
      <div className="ig-people-head">
        <h2 className="ig-section-title">People</h2>
        <span className="ig-people-sub">{HINTS[kind]}</span>
      </div>

      <ReciprocityBar
        mutuals={sets.mutuals.length}
        fans={sets.fans.length}
        ghosts={sets.ghosts.length}
      />

      <div className="ig-tabs" role="tablist" aria-label="Relationship lists">
        {TABS.map((t) => (
          <button
            key={t.kind}
            role="tab"
            aria-selected={t.kind === kind}
            className={`ig-tab tone-${t.tone} ${t.kind === kind ? 'is-active' : ''}`}
            onClick={() => {
              setKind(t.kind);
              setQuery('');
            }}
          >
            <span className="ig-tab-count">{sets[t.kind].length.toLocaleString()}</span>
            <span className="ig-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="ig-people-controls">
        <div className="ig-search">
          <svg
            className="ig-search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="ios-input ig-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or @username"
            aria-label="Search people"
          />
        </div>
        <Segmented options={SORT_OPTIONS} value={sort} onChange={setSort} className="ig-sort" />
      </div>

      {rows.length === 0 ? (
        <p className="ig-empty">
          {query ? `Nobody in this list matches “${query}”.` : 'This list is empty. 🎉'}
        </p>
      ) : (
        // Keyed on the query so switching tab / search / sort remounts the
        // scroller, which puts you back at the top of the new list.
        <VirtualList
          key={`${kind}|${query}|${sort}`}
          rows={rows}
          mutualKeys={mutualKeys}
          kind={kind}
          onOpen={onOpen}
        />
      )}

      <p className="ig-people-foot">
        {rows.length.toLocaleString()} shown
        {query ? ` of ${sets[kind].length.toLocaleString()}` : ''} · {total.toLocaleString()}{' '}
        relationships tracked
      </p>
    </section>
  );
}

/** Proportional split of the follow graph into mutual / one-way-in / one-way-out. */
function ReciprocityBar({
  mutuals,
  fans,
  ghosts,
}: {
  mutuals: number;
  fans: number;
  ghosts: number;
}) {
  const total = mutuals + fans + ghosts;
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const mutualRate = Math.round((mutuals / total) * 100);

  return (
    <div className="ig-recip">
      <div className="ig-recip-bar" role="img" aria-label={`${mutualRate}% mutual`}>
        <span className="seg mutual" style={{ width: pct(mutuals) }} />
        <span className="seg fans" style={{ width: pct(fans) }} />
        <span className="seg ghosts" style={{ width: pct(ghosts) }} />
      </div>
      <div className="ig-recip-legend">
        <Legend tone="mutual" label="Mutual" value={mutuals} />
        <Legend tone="fans" label="One-way in" value={fans} />
        <Legend tone="ghosts" label="One-way out" value={ghosts} />
        <span className="ig-recip-rate">{mutualRate}% mutual</span>
      </div>
    </div>
  );
}

function Legend({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <span className="ig-legend">
      <span className={`dot ${tone}`} aria-hidden />
      {label} <strong>{value.toLocaleString()}</strong>
    </span>
  );
}

const ROW_H = 58;
const VIEWPORT_H = 464;
const OVERSCAN = 5;

/**
 * Windowed list — only the visible slice is in the DOM, so a few thousand rows
 * scroll as smoothly as a dozen. Rows are a fixed height by design.
 */
function VirtualList({
  rows,
  mutualKeys,
  kind,
  onOpen,
}: {
  rows: Profile[];
  mutualKeys: Set<string>;
  kind: ListKind;
  onOpen: (username: string) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visible = Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2;
  const slice = rows.slice(first, first + visible);

  return (
    <div
      className="ig-people-scroll"
      style={{ height: Math.min(VIEWPORT_H, rows.length * ROW_H) }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="ig-people-spacer" style={{ height: rows.length * ROW_H }}>
        <ul className="ig-people-list" style={{ transform: `translateY(${first * ROW_H}px)` }}>
          {slice.map((p) => (
            <PersonRow
              key={p.username}
              person={p}
              kind={kind}
              mutual={mutualKeys.has(p.username.toLowerCase())}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function PersonRow({
  person,
  kind,
  mutual,
  onOpen,
}: {
  person: Profile;
  kind: ListKind;
  mutual: boolean;
  onOpen: (username: string) => void;
}) {
  const since = monthYear(person.since);
  // In the mutuals tab the badge would be on every row, so it earns nothing.
  const showMutual = mutual && kind !== 'mutuals';

  return (
    <li className="ig-person" style={{ height: ROW_H }}>
      <button
        className="ig-person-open"
        onClick={() => onOpen(person.username)}
        aria-label={`Details for @${person.username}`}
      />
      <Avatar username={person.username} />
      <span className="ig-person-text">
        <span className="ig-person-top">
          <span className="ig-person-name">{person.name || person.username}</span>
          {person.verified && (
            <svg className="ig-verified" viewBox="0 0 24 24" aria-label="Verified" role="img">
              <path
                d="M12 2l2.4 1.8 3-.2 1 2.8 2.4 1.8-1 2.8 1 2.8-2.4 1.8-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8L3.2 15.8l1-2.8-1-2.8L5.6 8.4l1-2.8 3 .2z"
                fill="currentColor"
              />
              <path
                d="M8.5 12.2l2.2 2.2 4.6-4.6"
                stroke="#fff"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {person.private && <span className="ig-chip-mini">private</span>}
        </span>
        <span className="ig-person-handle">@{person.username}</span>
      </span>
      {showMutual && <span className="ig-person-badge mutual">mutual</span>}
      {since && <span className="ig-person-since">{since}</span>}
    </li>
  );
}

/** Deterministic gradient from the username, so each account keeps its colour. */
function Avatar({ username }: { username: string }) {
  const { hue, initial } = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < username.length; i++) acc = (acc * 31 + username.charCodeAt(i)) % 360;
    // Plenty of handles start with . or _ — skip to the first real character so
    // the avatar doesn't just show punctuation.
    const letter = [...username].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? username.slice(0, 1);
    return { hue: acc, initial: letter.toUpperCase() };
  }, [username]);

  return (
    <span
      className="ig-avatar"
      aria-hidden
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 72% 62%), hsl(${(hue + 42) % 360} 68% 46%))`,
      }}
    >
      {initial}
    </span>
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
              <UserRow key={`f-${e.username}`} event={e} />
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
              <UserRow key={`u-${e.username}`} event={e} />
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
              <UserRow key={`o-${e.kind}-${e.username}`} event={e} />
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

function UserRow({ event }: { event: FollowEvent }) {
  return (
    <li className="ig-user-row">
      <span className={`ig-avatar ${event.dir === 'out' ? 'out' : event.kind}`} aria-hidden>
        {event.username.slice(0, 1).toUpperCase()}
      </span>
      <a
        className="ig-user-name"
        href={`https://instagram.com/${event.username}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {event.name ? (
          <>
            {event.name} <span className="ig-user-handle">@{event.username}</span>
          </>
        ) : (
          `@${event.username}`
        )}
      </a>
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
      <path d={up ? 'M6 2l4 5H2z' : 'M6 10L2 5h8z'} fill="currentColor" />
    </svg>
  );
}

// ===== Interactive follower chart =====

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

function ChartCard({
  data,
  range,
  domain,
  setDomain,
  selected,
  setSelected,
}: {
  data: TrackerData;
  range: Range;
  domain: [number, number] | null;
  setDomain: (d: [number, number] | null) => void;
  selected: string | null;
  setSelected: (k: string | null) => void;
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
    if (!domain) return filterRange(data.snapshots, Number(range));
    const inside = data.snapshots.filter((s) => {
      const t = new Date(s.t).getTime();
      return t >= domain[0] && t <= domain[1];
    });
    return inside.length >= 2 ? inside : data.snapshots.slice(-2);
  }, [data.snapshots, range, domain]);

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
          {fullDate(visible[0].t)} — {fullDate(visible[visible.length - 1].t)}
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
            <span className="ig-tip-date">{fullDate(active.t)}</span>
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

      {detail && <DayBreakdown day={detail} trackStart={trackStart} pinned={Boolean(selected)} />}
    </section>
  );
}

const DETAIL_LIMIT = 24;

/** Who followed / unfollowed on the selected day. */
function DayBreakdown({
  day,
  trackStart,
  pinned,
}: {
  day: DayActivity;
  trackStart: string | null;
  pinned: boolean;
}) {
  const beforeTracking = trackStart ? new Date(day.key) < new Date(dayKey(trackStart)) : true;

  if (day.follows.length === 0 && day.unfollows.length === 0 && day.outbound.length === 0)
    return null;

  return (
    <div className={`ig-breakdown ${pinned ? 'is-pinned' : ''}`}>
      <div className="ig-breakdown-head">
        <span className="ig-breakdown-date">{fullDate(day.key)}</span>
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
              <a
                className="ig-breakdown-handle"
                href={`https://instagram.com/${p.username}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {p.name || `@${p.username}`}
              </a>
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
              <a
                className="ig-breakdown-handle"
                href={`https://instagram.com/${e.username}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {e.name || `@${e.username}`}
              </a>
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
              <a
                className="ig-breakdown-handle"
                href={`https://instagram.com/${e.username}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {e.name || `@${e.username}`}
              </a>
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

function fullDate(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
    : new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
