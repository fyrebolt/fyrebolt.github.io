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
