import { useEffect, useRef, useState } from 'react';
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
import AgentControls from './AgentControls';

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
            <AgentControls onPulled={onPulled} />
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
