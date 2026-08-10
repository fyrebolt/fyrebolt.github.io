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
import { useAgentSession, type AgentSession } from './agentSession';
import { fetchLastAttempt, type LastAttempt } from './agent';

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
  // Held here rather than inside the buttons: the details panel's "Last attempt"
  // line comes from the same agent behind the same passphrase, and unlocking in
  // one place has to light up the other.
  const session = useAgentSession();

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
          {showDetails && <CollectionDetails data={data!} session={session} />}
          <div className="ig-import-actions">
            <AgentControls session={session} onPulled={onPulled} />
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
function CollectionDetails({ data, session }: { data: TrackerData; session: AgentSession }) {
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

      <LastAttemptRow session={session} />

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

/** How long the "Last attempt" line waits before asking the agent again. */
const ATTEMPT_POLL_MS = 20_000;

/**
 * When the tracker last *tried*, who asked it to, and what went wrong.
 *
 * "Collected" above says when a pull last worked, which is a different question
 * and a misleading one on its own: an expired cookie writes no history.json, so
 * a tracker that has been failing all week looks identical to one that simply
 * hasn't been due yet. This is the row that tells them apart.
 *
 * It can only come from the local agent — a failure produces no commit, so the
 * published site has no way to hear about it. Renders nothing anywhere else,
 * which is the same deal the Update now button makes.
 */
function LastAttemptRow({ session }: { session: AgentSession }) {
  const { available, token } = session;
  const [attempt, setAttempt] = useState<LastAttempt | null>(null);

  useEffect(() => {
    if (available !== true || !token) return;
    let stop = false;
    const tick = () =>
      fetchLastAttempt(token).then((next) => {
        if (!stop) setAttempt(next);
      });
    tick();
    const id = setInterval(tick, ATTEMPT_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [available, token]);

  if (!attempt) return null;
  const { tone, headline } = describeOutcome(attempt);
  // A failure explains itself; a success has counts instead. Never both.
  const detail = attempt.reason ?? attempt.summary;

  return (
    <>
      <dt>Last attempt</dt>
      <dd>
        {new Date(attempt.at).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}{' '}
        <span className="ig-live-dim">({timeAgo(attempt.at)})</span> ·{' '}
        {TRIGGER_LABEL[attempt.trigger]}
        <span className="ig-live-note">
          <span className={tone}>{headline}</span>
          {detail ? ` — ${detail}` : ''}
        </span>
        {attempt.hint && <span className="ig-live-note">{attempt.hint}</span>}
      </dd>
    </>
  );
}

/** Who set the run going, said the way you'd say it out loud. */
const TRIGGER_LABEL: Record<LastAttempt['trigger'], string> = {
  automatic: 'the daily job',
  scheduled: 'a scheduled one-off',
  manual: 'started by hand',
};

/**
 * The verdict line, and how loudly to say it.
 *
 * Only a run that read nothing is a failure. A run that was stopped on purpose,
 * or one that found today's work already done, is the tracker behaving — and
 * colouring those red would train you to ignore the colour that matters.
 */
function describeOutcome(attempt: LastAttempt): { tone: string; headline: string } {
  switch (attempt.outcome) {
    case 'ok':
      return { tone: 'ig-live-done', headline: '✓ Succeeded' };
    case 'skipped':
      return { tone: 'ig-live-pending', headline: 'Nothing to do' };
    case 'cancelled':
      return { tone: 'ig-live-pending', headline: 'Stopped' };
    case 'unpublished':
      return { tone: 'ig-live-warn', headline: '⚠ Pulled, but not published' };
    default:
      return { tone: 'ig-live-fail', headline: '✗ Failed' };
  }
}
