import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackerData } from './data';
import {
  startPull,
  cancelPull,
  fetchStatus,
  fetchHistory,
  fetchSchedule,
  setSchedule,
  verifyToken,
  type AgentStatus,
  type ScheduledPull,
} from './agent';
import type { AgentSession } from './agentSession';

/**
 * The controls that only exist on the Mac running the pull:
 *
 *   "Update now"   — pull immediately
 *   "Stop"         — end the run in flight
 *   "Schedule…"    — pull once, at a time you pick
 *
 * Renders nothing at all unless the local agent (scripts/instagram-agent.mjs)
 * answers on loopback, so on any other device, or in anyone else's browser,
 * these simply don't exist rather than sitting there dead.
 *
 * All of it lives in one component because it shares the passphrase: asking
 * twice for the same secret, or letting one button hold a token the other
 * doesn't know was rejected, would both be worse than the coupling.
 */
export default function AgentControls({
  session,
  onPulled,
}: {
  session: AgentSession;
  onPulled: (fresh: TrackerData) => void;
}) {
  const { available, token, remember, forget } = session;

  // Which action, if any, is waiting on a passphrase. The unlock form resumes it
  // by calling `perform` with the token it just verified — the token in state is
  // a render behind at that point, so the action can't read it from there.
  const [asking, setAsking] = useState<Action | null>(null);
  const [entry, setEntry] = useState('');
  const [unlockNote, setUnlockNote] = useState<string | null>(null);

  const [run, setRun] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [armed, setArmed] = useState<ScheduledPull | null>(null);
  const [picking, setPicking] = useState(false);
  const [when, setWhen] = useState('');
  const [schedNote, setSchedNote] = useState<string | null>(null);

  /** Is the "are you sure" for stopping a run on screen? */
  const [confirmingStop, setConfirmingStop] = useState(false);

  /** The saved token turned out to be stale — forget it and ask again. */
  const reject = useCallback(
    (action: Action) => {
      forget();
      setEntry('');
      setUnlockNote('That passphrase was rejected.');
      setAsking(action);
    },
    [forget],
  );

  // ===== The pull =====

  const beginPull = useCallback(
    async (withToken: string) => {
      setBusy(true);
      setNote(null);
      const res = await startPull(withToken);
      if (res.kind === 'badToken') {
        reject('pull');
        setBusy(false);
        return;
      }
      if (res.kind !== 'started') {
        setNote(res.message);
        setBusy(false);
        return;
      }
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
    [reject],
  );

  /**
   * Stop the run in flight.
   *
   * No status is written locally: the agent reports the run as cancelled on the
   * next poll, and letting that be the single source of "it stopped" avoids the
   * state where the page says stopped and the pull is still going.
   */
  const stopPull = useCallback(async () => {
    setConfirmingStop(false);
    if (!token) return;
    setNote(null);
    const res = await cancelPull(token);
    if (res.kind === 'badToken') return reject('pull');
    if (res.kind === 'error') setNote(res.message);
    // 'idle' needs nothing said: the run finished on its own a moment ago, and
    // the poll is about to show exactly that.
  }, [token, reject]);

  // ===== The one-off schedule =====

  const commitSchedule = useCallback(
    async (withToken: string, at: Date | null) => {
      setSchedNote(null);
      const res = await setSchedule(withToken, at);
      if (res.kind === 'badToken') {
        reject('schedule');
        return;
      }
      if (res.kind === 'error') {
        setSchedNote(res.message);
        return;
      }
      setArmed(res.scheduled);
      setPicking(false);
      setSchedNote(res.scheduled ? null : 'Scheduled pull cancelled.');
    },
    [reject],
  );

  /** Whatever the picker is showing, as an instant — null while it's unusable. */
  const chosen = usableDate(when);

  /** Carry out an action with a token known to be good. */
  const perform = useCallback(
    (action: Action, withToken: string) => {
      if (action === 'pull') return beginPull(withToken);
      const at = usableDate(when);
      if (at) commitSchedule(withToken, at);
      else setPicking(true); // asked to schedule before choosing a time
    },
    [beginPull, commitSchedule, when],
  );

  /** Ask for the passphrase, or go straight ahead if it's already saved. */
  const request = useCallback(
    (action: Action) => {
      if (token) perform(action, token);
      else {
        setUnlockNote(null);
        setEntry('');
        setAsking(action);
      }
    },
    [token, perform],
  );

  // What's already armed, so a reload doesn't look like nothing is scheduled.
  useEffect(() => {
    if (available !== true || !token) return;
    let stop = false;
    fetchSchedule(token).then((s) => {
      if (!stop) setArmed(s);
    });
    return () => {
      stop = true;
    };
  }, [available, token]);

  /**
   * Notice when the armed pull fires.
   *
   * The agent clears the entry as it starts the run, so an armed slot that has
   * come back empty means the run is under way — picking its status up here is
   * what makes a scheduled pull show the same live progress as a pressed one.
   */
  useEffect(() => {
    if (!armed || !token || run?.running) return;
    const id = setInterval(async () => {
      const still = await fetchSchedule(token);
      if (still) return;
      setArmed(null);
      const status = await fetchStatus(token);
      if (status?.running) {
        setRun(status);
        setBusy(true);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [armed, token, run?.running]);

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
      if (!status.running) {
        setBusy(false);
        // The run this was asking about is over, one way or another.
        setConfirmingStop(false);
      }
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

  /** Signalled, but not gone yet: a push on the wire can take a few seconds. */
  const stopping = run?.phase === 'stopping';

  const openPicker = () => {
    setSchedNote(null);
    if (!when) setWhen(defaultWhen());
    setPicking(true);
  };

  return (
    <>
      {run?.running ? (
        <>
          <RunningChip run={run} />
          <button
            className="ios-btn ig-agent-btn ig-agent-stop"
            disabled={stopping}
            onClick={() => setConfirmingStop((v) => !v)}
            aria-expanded={confirmingStop}
          >
            ■ {stopping ? 'Stopping…' : 'Stop'}
          </button>
        </>
      ) : (
        <button
          className="ios-btn ios-btn-primary ig-agent-btn"
          disabled={busy}
          onClick={() => request('pull')}
        >
          ⟳ {busy ? 'Starting…' : 'Update now'}
        </button>
      )}

      <button className="ios-btn ig-agent-btn" onClick={picking ? () => setPicking(false) : openPicker}>
        ⏱ Schedule…
      </button>

      {run && !run.running && (
        <span
          className={`ig-agent-note ${run.cancelled ? '' : run.ok ? 'ok' : 'err'}`}
          role="status"
        >
          {run.cancelled
            ? (run.error ?? 'Stopped.')
            : run.ok
              ? (run.summary ?? 'Updated.')
              : (run.error ?? 'Update failed.')}
        </span>
      )}
      {note && <span className="ig-agent-note err">{note}</span>}

      {confirmingStop && run?.running && (
        <div className="ig-agent-confirm" role="alertdialog" aria-label="Stop the running pull">
          <p className="ig-agent-confirm-text">
            <strong>Stop this pull?</strong> Nothing gets saved — the run only writes at the very
            end.{' '}
            {run.followers != null
              ? `The ${run.followers} followers read so far are discarded`
              : 'The work so far is discarded'}
            , and the numbers on this page stay as they are. Instagram also holds the next run off
            for a couple of minutes.
          </p>
          <div className="ig-agent-confirm-row">
            <button className="ios-btn ig-btn-danger" type="button" onClick={stopPull}>
              Stop it
            </button>
            <button
              className="ios-btn ig-btn-quiet"
              type="button"
              onClick={() => setConfirmingStop(false)}
            >
              Keep going
            </button>
          </div>
        </div>
      )}

      {asking && (
        <form
          className="ig-agent-unlock"
          onSubmit={async (e) => {
            e.preventDefault();
            const value = entry.trim();
            if (!value) return;
            setBusy(true);
            const ok = await verifyToken(value);
            setBusy(false);
            if (!ok) {
              setUnlockNote('That passphrase was rejected.');
              return;
            }
            remember(value);
            setAsking(null);
            perform(asking, value);
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
              setAsking(null);
              setUnlockNote(null);
            }}
          >
            Cancel
          </button>
          {unlockNote && <span className="ig-agent-note err">{unlockNote}</span>}
        </form>
      )}

      {picking && (
        <form
          className="ig-agent-schedule"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) request('schedule');
          }}
        >
          <label className="ig-agent-schedule-label" htmlFor="ig-schedule-at">
            Run one pull at
          </label>
          <input
            id="ig-schedule-at"
            className="ios-input ig-agent-when"
            type="datetime-local"
            value={when}
            min={toLocalInput(new Date())}
            onChange={(e) => setWhen(e.target.value)}
          />
          <button className="ios-btn ios-btn-primary" type="submit" disabled={!chosen}>
            Schedule
          </button>
          <button className="ios-btn ig-btn-quiet" type="button" onClick={() => setPicking(false)}>
            Cancel
          </button>
          <span className="ig-agent-schedule-hint">
            One extra run, on top of the daily job — it won’t change the schedule.
          </span>
        </form>
      )}

      {armed && (
        <div className="ig-agent-armed" role="status">
          <span className="ig-agent-armed-dot" aria-hidden />
          <span>
            Pull scheduled for <strong>{describeAt(armed.at)}</strong>
          </span>
          <button
            className="ios-btn ig-btn-quiet"
            type="button"
            onClick={() => token && commitSchedule(token, null)}
          >
            Cancel it
          </button>
        </div>
      )}
      {schedNote && <span className="ig-agent-note err">{schedNote}</span>}
    </>
  );
}

type Action = 'pull' | 'schedule';

function RunningChip({ run }: { run: AgentStatus }) {
  const counts = [
    run.followers != null ? `${run.followers} followers` : null,
    run.following != null ? `${run.following} following` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="ig-agent ig-agent-running" role="status">
      <span className="ig-spinner" aria-hidden /> {run.phase}
      {counts ? ` — ${counts}` : ''}
    </span>
  );
}

/**
 * `datetime-local` speaks wall-clock strings in the *browser's* zone, which is
 * the agent's zone too — nothing but this Mac can see these controls at all.
 */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** The picker's value as an instant, or null when it's empty or half-typed. */
function usableDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** An hour out, on the minute — close enough to "later today" to just edit. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

function describeAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const today = new Date().toDateString() === at.toDateString();
  return at.toLocaleString([], {
    ...(today ? {} : { weekday: 'short', month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}
