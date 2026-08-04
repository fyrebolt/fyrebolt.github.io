import { useCallback, useEffect, useRef, useState } from 'react';
import { timeAgo, type TrackerData } from './data';
import {
  describeWindow,
  formatClock,
  formatDayLabel,
  formatRelative,
  nextAttempt,
  resolveSchedule,
  zoneAbbrev,
} from './schedule';
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

/** Progress of an in-browser import of a data-export ZIP. */
export interface ImportState {
  busy: boolean;
  error?: string;
  note?: string;
}

export default function ImportPanel({
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
  const [showDetails, setShowDetails] = useState(false);
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
            <button
              className="ig-live-toggle"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((v) => !v)}
            >
              <strong>Live data</strong>
              <span className="ig-live-caret" aria-hidden>
                {showDetails ? '▴' : '▾'}
              </span>
            </button>{' '}
            · updated {timeAgo(data!.generatedAt)}
          </div>
          {showDetails && <CollectionDetails data={data!} />}
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
 * What's behind the green "Live data" badge: when this reading was taken, how,
 * and when the next one is due.
 *
 * The schedule is whatever the pull last read out of its own LaunchAgent, so
 * everything here is reported rather than assumed — a file written by a manual
 * run carries no schedule, and this says so instead of inventing a time.
 */
function CollectionDetails({ data }: { data: TrackerData }) {
  // The countdown is the point of the panel, so it can't be frozen at the
  // moment it opened. A minute is finer than anything displayed here changes.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const collected = new Date(data.generatedAt);
  // A file with no schedule of its own still gets a time, from the default the
  // installer uses — flagged as assumed rather than presented as fact.
  const { schedule, assumed } = resolveSchedule(data.schedule);
  const next = nextAttempt(schedule, data.generatedAt, now)!;
  const zone = zoneAbbrev(next.at, schedule.timeZone);
  const dayLabel = formatDayLabel(next.at, now, schedule.timeZone);
  const clock = formatClock(next.at, schedule.timeZone);

  return (
    <dl className="ig-live-details">
      <dt>Collected</dt>
      <dd>
        {collected.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}{' '}
        <span className="ig-live-dim">({timeAgo(data.generatedAt)})</span>
      </dd>

      <dt>How</dt>
      <dd>
        {data.schedule
          ? 'Scheduled pull on the Mac at home — read from instagram.com with a saved session, then committed to this site.'
          : 'Pulled by hand — read from instagram.com with a saved session, then committed to this site.'}
      </dd>

      <dt>Holdings</dt>
      <dd>
        {data.followers?.length ?? 0} followers · {data.following?.length ?? 0} following
      </dd>

      <dt>Today</dt>
      <dd>
        {next.satisfied ? (
          <span className="ig-live-done">✓ Daily pull complete</span>
        ) : (
          <span className="ig-live-pending">Not in yet — the job is still retrying</span>
        )}
      </dd>

      <dt>Next pull</dt>
      <dd>
        <strong>
          {dayLabel === 'today' ? clock : `${dayLabel} at ${clock}`}
          {zone ? ` ${zone}` : ''}
        </strong>{' '}
        <span className="ig-live-dim">({formatRelative(next.at, now)})</span>
        <span className="ig-live-note">
          {next.satisfied
            ? 'Today is done, so the hourly firings until then will no-op.'
            : 'This is the next retry — it stops as soon as one succeeds.'}
        </span>
      </dd>

      <dt>Schedule</dt>
      <dd>
        {describeWindow(schedule, now)}
        <span className="ig-live-note">
          {assumed
            ? 'Assumed — this file predates schedule recording, or came from a manual run. The next scheduled pull writes the real one here.'
            : 'Read from the installed job. Retries, not repeats: at most one pull a day.'}
        </span>
      </dd>
    </dl>
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
