// ===== Client for the local "Update now" agent =====
//
// The deployed site is static and can't pull anything itself, but a browser on
// the same Mac can reach 127.0.0.1 — loopback is exempt from mixed-content
// blocking, so this works from https://fyrebolt.github.io too.
//
// If the agent isn't running (any other device, anyone else's browser) every
// call here fails fast and the UI simply doesn't offer the button.

const AGENT = 'http://127.0.0.1:4599';
const TOKEN_KEY = 'ig-agent-token-v1';
/** Probe budget. The agent is local, so it answers in single-digit ms or not at all. */
const PROBE_MS = 1500;

export interface AgentStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  phase: string;
  followers: number | null;
  following: number | null;
  ok: boolean | null;
  summary: string | null;
  error: string | null;
  /** Stopped on purpose. Not the same as failed, and shouldn't read like it. */
  cancelled?: boolean;
}

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode — the token just won't be remembered */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function withTimeout(path: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(`${AGENT}${path}`, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * JSON from one of the agent's read endpoints, or null.
 *
 * Every read here answers the same question — "is the agent there, and did it
 * say yes?" — so they all collapse to null on a refused connection, a timeout,
 * a bad token or a non-200. The UI treats all of those the same way: no agent,
 * no live extras.
 */
async function read<T>(path: string, token: string | null, ms: number): Promise<T | null> {
  try {
    const res = await withTimeout(path, token ? { headers: { 'x-tracker-token': token } } : {}, ms);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Is the agent running on this machine? Never throws. */
export async function probeAgent(): Promise<boolean> {
  const body = await read<{ agent?: string }>('/health', null, PROBE_MS);
  return body?.agent === 'instagram-tracker';
}

export type StartResult =
  | { kind: 'started' }
  | { kind: 'badToken' }
  | { kind: 'busy'; message: string }
  | { kind: 'error'; message: string };

/**
 * Ask the agent to run a pull. The custom header is deliberate: it forces a CORS
 * preflight, which the agent refuses for any origin outside its allowlist.
 */
export async function startPull(token: string): Promise<StartResult> {
  try {
    const res = await withTimeout(
      '/pull',
      { method: 'POST', headers: { 'x-tracker-token': token } },
      8000,
    );
    if (res.status === 202) return { kind: 'started' };
    if (res.status === 401) return { kind: 'badToken' };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 409 || res.status === 429) {
      return { kind: 'busy', message: body.error ?? 'busy' };
    }
    return { kind: 'error', message: body.error ?? `agent returned ${res.status}` };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error && e.name === 'AbortError' ? 'the agent timed out' : 'could not reach the agent',
    };
  }
}

export type CancelResult =
  | { kind: 'cancelling' }
  | { kind: 'badToken' }
  | { kind: 'idle' }
  | { kind: 'error'; message: string };

/**
 * Stop the pull in flight.
 *
 * The agent answers as soon as it has signalled the run, not once it's gone —
 * a `git push` can sit on the network for a few seconds — so the caller keeps
 * polling /status and learns it's over from `phase: 'cancelled'`.
 */
export async function cancelPull(token: string): Promise<CancelResult> {
  try {
    const res = await withTimeout(
      '/cancel',
      { method: 'POST', headers: { 'x-tracker-token': token } },
      8000,
    );
    if (res.status === 202) return { kind: 'cancelling' };
    if (res.status === 401) return { kind: 'badToken' };
    if (res.status === 409) return { kind: 'idle' };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: 'error', message: body.error ?? `agent returned ${res.status}` };
  } catch (e) {
    return {
      kind: 'error',
      message:
        e instanceof Error && e.name === 'AbortError'
          ? 'the agent timed out'
          : 'could not reach the agent',
    };
  }
}

/** Who asked for a run: the daily job, an armed one-off, or the button. */
export type AttemptTrigger = 'automatic' | 'scheduled' | 'manual';

/** How a run ended. See scripts/lib/instagram-attempt.mjs. */
export type AttemptOutcome = 'ok' | 'skipped' | 'failed' | 'unpublished' | 'cancelled';

export interface LastAttempt {
  at: string;
  finishedAt: string;
  trigger: AttemptTrigger;
  outcome: AttemptOutcome;
  reason: string | null;
  hint: string | null;
  summary: string | null;
}

/**
 * How the last attempt went — including the failed ones.
 *
 * Only the agent can answer this. history.json is written on success alone, so
 * a run that died on an expired cookie leaves the published site looking exactly
 * as it did before; this is the one place that knows otherwise.
 */
export async function fetchLastAttempt(token: string): Promise<LastAttempt | null> {
  const body = await read<{ attempt: LastAttempt | null }>('/attempt', token, 5000);
  return body?.attempt ?? null;
}

/**
 * The history.json the agent just wrote. Lets the page show new numbers without
 * waiting out the GitHub Pages redeploy.
 */
export async function fetchHistory(token: string): Promise<unknown | null> {
  return read('/history', token, 8000);
}

export interface LiveProfile {
  username: string;
  fullName?: string;
  pic?: string;
  bio?: string;
  verified?: boolean;
  private?: boolean;
  followers: number | null;
  following: number | null;
  posts: number | null;
  notFound?: boolean;
}

/** Live overview for one account. Null when the agent isn't running. */
export async function fetchProfileInfo(
  token: string,
  username: string,
): Promise<LiveProfile | null> {
  return read<LiveProfile>(`/profile?username=${encodeURIComponent(username)}`, token, 9000);
}

/**
 * Fetch an avatar through the agent and hand back a blob URL.
 *
 * Deliberately not an `<img src>` pointing at the agent: that couldn't carry the
 * token header, which is what forces the CORS preflight the whole security model
 * rests on. Revoke the returned URL when done.
 */
export async function fetchAvatar(token: string, src: string): Promise<string | null> {
  try {
    const res = await withTimeout(
      `/avatar?src=${encodeURIComponent(src)}`,
      { headers: { 'x-tracker-token': token } },
      9000,
    );
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/** Poll the current run. Returns null if the agent became unreachable. */
export async function fetchStatus(token: string): Promise<AgentStatus | null> {
  return read<AgentStatus>('/status', token, 5000);
}

/**
 * Does the agent accept this passphrase?
 *
 * "Update now" answers that as a side effect of starting a pull, but scheduling
 * shouldn't have to run one to find out its token is wrong — so this asks a
 * read endpoint and looks specifically at the 401.
 */
export async function verifyToken(token: string): Promise<boolean> {
  try {
    const res = await withTimeout('/status', { headers: { 'x-tracker-token': token } }, 5000);
    return res.ok;
  } catch {
    return false;
  }
}

/** A one-off pull the agent has been asked to run at a set time. */
export interface ScheduledPull {
  at: string;
  createdAt: string;
}

/** The armed one-off pull, or null when there isn't one (or no agent). */
export async function fetchSchedule(token: string): Promise<ScheduledPull | null> {
  const body = await read<{ scheduled: ScheduledPull | null }>('/schedule', token, 5000);
  return body?.scheduled ?? null;
}

export type ScheduleResult =
  | { kind: 'ok'; scheduled: ScheduledPull | null }
  | { kind: 'badToken' }
  | { kind: 'error'; message: string };

/**
 * Arm a one-off pull for `at`, or cancel the armed one by passing null.
 *
 * `at` is an instant, not a wall-clock string: the agent only ever runs on the
 * machine serving loopback, but sending an ISO timestamp means the two ends
 * can't disagree about which 9pm was meant.
 */
export async function setSchedule(token: string, at: Date | null): Promise<ScheduleResult> {
  try {
    const res = await withTimeout(
      '/schedule',
      {
        method: 'POST',
        headers: { 'x-tracker-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ at: at ? at.toISOString() : null }),
      },
      8000,
    );
    if (res.status === 401) return { kind: 'badToken' };
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      scheduled?: ScheduledPull | null;
    };
    if (!res.ok) return { kind: 'error', message: body.error ?? `agent returned ${res.status}` };
    return { kind: 'ok', scheduled: body.scheduled ?? null };
  } catch (e) {
    return {
      kind: 'error',
      message:
        e instanceof Error && e.name === 'AbortError'
          ? 'the agent timed out'
          : 'could not reach the agent',
    };
  }
}
