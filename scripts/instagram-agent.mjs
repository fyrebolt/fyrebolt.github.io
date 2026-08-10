#!/usr/bin/env node
// ===== Local "Update now" agent =====
//
// A tiny HTTP server on the loopback interface that lets the Instagram Tracker
// page trigger a pull on demand. The deployed site is static, so it can't run
// anything itself — but a browser on this Mac *can* reach 127.0.0.1, even from
// an https:// page (loopback is exempt from mixed-content blocking).
//
//   GET  /health   → { ok: true }              no token, no side effects
//   GET  /profile  → live profile overview for one handle       (token required)
//   GET  /status   → progress of the current/last run          (token required)
//   GET  /attempt  → how the last attempt ended, and why       (token required)
//   GET  /history  → the freshly written history.json          (token required)
//   POST /pull     → start a pull, returns immediately         (token required)
//   POST /cancel   → stop the running pull                     (token required)
//   GET  /schedule → the one-off pull that's armed, if any     (token required)
//   POST /schedule → arm one for a given time, or cancel it    (token required)
//
// ── Why it's shaped this way ────────────────────────────────────────────────
// CORS does NOT stop a request from arriving; it only stops the *page* reading
// the response. Any site you visit can therefore fire a "simple" request at this
// port. Three things keep that harmless:
//
//   1. GET /health has no side effects, and reveals nothing but liveness.
//   2. POST /pull demands a custom header (x-tracker-token). A custom header
//      forces a CORS preflight, which this server refuses unless the Origin is
//      on the allowlist — so a hostile page's request dies at the OPTIONS and
//      never executes.
//   3. The token itself, which lives only in localStorage for the allowed
//      origin and is unreadable cross-origin.
//
// It also binds to 127.0.0.1 only (nothing on the LAN can reach it), runs one
// fixed action rather than arbitrary commands, allows a single concurrent run,
// and enforces a cooldown so a stuck button can't hammer Instagram.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import {
  IG_UA,
  buildSession,
  igHeaders,
  profileInfoUrl,
  profileReferer,
} from './lib/instagram-session.mjs';
import { isDue, isStale, normalize, parseRequested } from './lib/instagram-oneshot.mjs';
import { attemptPath, readAttempt, writeAttempt } from './lib/instagram-attempt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SECRETS = resolve(__dirname, '.instagram-secrets.json');
const PULL = resolve(__dirname, 'instagram-pull.mjs');
const HISTORY = resolve(REPO, 'public/instagram/history.json');
/** How the last attempt ended — written by the pull, or here when one is cancelled. */
const ATTEMPT = attemptPath(__dirname);
/** The armed one-off pull. On disk, so a restart or a reboot doesn't lose it. */
const ONESHOT = resolve(__dirname, '.instagram-oneshot.json');

const DEFAULT_PORT = 4599;
/** Minimum gap between run *starts*, ms. Instagram rate-limits; be polite. */
const COOLDOWN_MS = 120_000;
/** How often the armed one-off is checked. Polling, not a timer — see below. */
const TICK_MS = 20_000;

const ALLOWED_ORIGINS = ['https://fyrebolt.github.io'];
/** Any localhost port, so `npm run dev` works too. */
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function log(...parts) {
  console.log(`[${new Date().toISOString()}]`, ...parts);
}

// ===== Config =====

function loadConfig() {
  if (!existsSync(SECRETS)) {
    console.error(`✗ ${SECRETS} not found. Set up the tracker first.`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(SECRETS, 'utf8'));
  if (!raw.agentToken || String(raw.agentToken).length < 16) {
    console.error(
      '✗ No usable "agentToken" in the secrets file.\n\n' +
        '  Add a long random token (16+ chars) — this is the passphrase the page\n' +
        '  asks you for. Generate one with:\n\n' +
        `    node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"\n\n` +
        `  Suggestion: ${randomBytes(24).toString('base64url')}\n`,
    );
    process.exit(2);
  }
  return {
    token: String(raw.agentToken),
    port: Number(raw.agentPort) || DEFAULT_PORT,
    // The Instagram session, reused for live profile lookups — assembled exactly
    // as the puller does it, from the same secrets file.
    session: buildSession(raw),
  };
}

/** Short-lived cache so reopening the same profile doesn't re-hit Instagram. */
const profileCache = new Map();
const PROFILE_TTL_MS = 5 * 60 * 1000;

/** Live overview for one handle, via the same private endpoint the puller uses. */
async function fetchProfileInfo(username) {
  const key = username.toLowerCase();
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.value;

  const res = await fetch(profileInfoUrl(username), {
    headers: igHeaders(config.session, profileReferer(username)),
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`Instagram returned ${res.status}`);

  const json = await res.json();
  const u = json?.data?.user;
  if (!u) return { notFound: true };

  const value = {
    username: u.username ?? username,
    fullName: u.full_name || undefined,
    // Proxied through this agent rather than handed to the page: the CDN URL is
    // signed and short-lived, and this keeps it off the public site entirely.
    pic: u.profile_pic_url_hd || u.profile_pic_url || undefined,
    bio: u.biography || undefined,
    verified: Boolean(u.is_verified),
    private: Boolean(u.is_private),
    followers: u.edge_followed_by?.count ?? null,
    following: u.edge_follow?.count ?? null,
    posts: u.edge_owner_to_timeline_media?.count ?? null,
  };
  profileCache.set(key, { at: Date.now(), value });
  return value;
}

const config = loadConfig();

// ===== Run state =====

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  phase: 'idle',
  followers: null,
  following: null,
  ok: null,
  summary: null,
  error: null,
  /** Did someone stop this run on purpose? A cancelled run isn't a broken one. */
  cancelled: false,
  lastStart: 0,
};

/** The pull in flight, so it can be stopped. Null whenever nothing is running. */
let child = null;
/** What that run was started as: 'manual' (the button) or 'scheduled' (a one-off). */
let trigger = null;
/** Why it was stopped, in the words the record will carry. */
let cancelReason = null;
/** How long a stopped pull gets to exit on its own before it's killed outright. */
const KILL_GRACE_MS = 5000;

// ===== Auth =====

function originAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin);
}

/** Constant-time compare so the token can't be recovered by timing. */
function tokenValid(supplied) {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(config.token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-tracker-token',
    // Chrome doesn't currently demand this for loopback, but Private Network
    // Access may tighten; opting in now keeps the button working if it does.
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** The request body as JSON, capped so a bad client can't fill memory. */
function readJson(req, limit = 4096) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        rejectBody(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error('body is not JSON'));
      }
    });
    req.on('error', rejectBody);
  });
}

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  // Only ever hand CORS approval to an allowed origin.
  if (origin && originAllowed(origin)) Object.assign(headers, corsHeaders(origin));
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

// ===== The pull =====

function startPull(kind) {
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastStart = Date.now();
  state.phase = 'starting';
  state.followers = null;
  state.following = null;
  state.ok = null;
  state.summary = null;
  state.error = null;
  state.cancelled = false;
  trigger = kind;

  // Fixed argv — nothing from the request reaches the child except which of the
  // two buttons pressed it, which is checked against a fixed list before it gets
  // here and only ever ends up in a log line.
  //
  // detached so the pull becomes its own process group leader: it spawns git,
  // which spawns more, and "stop it" has to mean the whole tree rather than the
  // node process with a push still running underneath it.
  child = spawn(process.execPath, [PULL, '--commit', `--trigger=${kind}`], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let tail = '';
  const absorb = (chunk) => {
    const text = String(chunk);
    tail = (tail + text).slice(-4000);
    // Once it's been told to stop, its progress is no longer the story: a pull
    // still printing pages while it winds down would keep overwriting
    // "stopping", and the page would show no sign the button did anything.
    if (state.cancelled) return;
    // The pull writes "\r  followers: N (page X)" as it goes.
    const m = [...text.matchAll(/(followers|following):\s*(\d+)/g)].pop();
    if (m) {
      state.phase = `paging ${m[1]}`;
      state[m[1]] = Number(m[2]);
    }
    if (/resolved id/.test(text)) state.phase = 'resolved profile';
    if (/committed and pushed/.test(text)) state.phase = 'published';
  };
  child.stdout.on('data', absorb);
  child.stderr.on('data', absorb);

  child.on('close', (code, signal) => {
    const startedAt = state.startedAt;
    child = null;
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.ok = code === 0;
    const summary = tail.match(/followers \d+ · following \d+[^\n]*/);
    state.summary = summary ? summary[0] : null;

    if (state.cancelled) {
      // A run stopped on purpose is not a failure, and it can't file its own
      // report — it was killed. The record is written here instead, once the
      // process is actually gone, and only when it really did die by signal:
      // a run that finished in the instant between the request and the kill
      // has already written a truthful record of its own.
      state.phase = 'cancelled';
      state.error = 'Stopped. Nothing was recorded for this run.';
      if (signal || code !== 0) {
        writeAttempt(ATTEMPT, {
          at: startedAt,
          finishedAt: state.finishedAt,
          trigger,
          outcome: 'cancelled',
          reason: cancelReason,
          hint: 'Nothing was written, so the numbers on the page are still the last good ones.',
        });
      }
    } else {
      state.phase = code === 0 ? 'done' : 'failed';
      if (code !== 0) {
        // Surface the script's own "✗ …" line; it's already written for humans.
        const reason = tail.match(/✗ ([^\n]+)/);
        state.error = reason ? reason[1] : `pull exited ${code}`;
      }
    }
    log(`run finished: ${state.phase}${state.error ? ` — ${state.error}` : ''}`);
  });

  child.on('error', (e) => {
    child = null;
    state.running = false;
    state.ok = false;
    state.phase = 'failed';
    state.error = `could not start the pull: ${e.message}`;
  });
}

/**
 * Stop the running pull. Returns false if there was nothing to stop.
 *
 * SIGTERM to the whole process group, then SIGKILL to whatever is left: node
 * dies on the first one, but a `git push` waiting on the network can sit through
 * it, and "cancel" that leaves a push running isn't a cancel.
 *
 * Nothing has to be undone afterwards. The pull writes history.json in a single
 * step at the very end and commits after that, so a run stopped part-way has
 * touched nothing — the cost of cancelling is only the work it threw away.
 */
function cancelPull(reason = 'stopped from the tracker page while it was running') {
  if (!state.running || !child) return false;
  const doomed = child;
  cancelReason = reason;
  state.cancelled = true;
  state.phase = 'stopping';
  signalGroup(doomed, 'SIGTERM');
  setTimeout(() => {
    if (doomed.exitCode === null && doomed.signalCode === null) {
      log('the pull did not stop on SIGTERM; killing it');
      signalGroup(doomed, 'SIGKILL');
    }
  }, KILL_GRACE_MS).unref();
  return true;
}

/**
 * Signal a child and everything it started.
 *
 * The negative pid addresses the process group, which only exists because the
 * child was spawned detached. It falls back to the child alone if the group is
 * already gone — which is a race, not an error.
 */
function signalGroup(proc, signal) {
  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      /* already dead — the close handler has the rest */
    }
  }
}

// ===== The one-off pull =====
//
// At most one is armed at a time: the button that sets it is "run it at this
// time", not "add another to the pile", and a queue would need a UI to inspect.
// Re-arming simply replaces whatever was there.

/** null when nothing is armed. Mirrors the file, which is the durable copy. */
let oneshot = readOneshot();

function readOneshot() {
  try {
    return normalize(JSON.parse(readFileSync(ONESHOT, 'utf8')));
  } catch {
    return null; // no file, or a file that isn't a usable entry
  }
}

function writeOneshot(entry) {
  oneshot = entry;
  try {
    if (entry) writeFileSync(ONESHOT, JSON.stringify(entry, null, 2) + '\n');
    else if (existsSync(ONESHOT)) unlinkSync(ONESHOT);
  } catch (e) {
    // The in-memory copy still holds, so the run itself is safe; only surviving
    // a restart is lost. Worth a line in the log, not worth failing the request.
    log(`could not persist the scheduled pull: ${e.message}`);
  }
}

/**
 * Fire the armed one-off when its moment comes.
 *
 * A repeating check rather than one long setTimeout on purpose: a timer that
 * spans a lid-close doesn't fire on time (and above ~24 days doesn't fire at
 * all), whereas a poll simply notices the moment has passed as soon as the Mac
 * is awake again. `isStale` is what keeps "as soon as it's awake" from meaning
 * a pull at 4am for a slot missed the previous evening.
 */
function tickOneshot() {
  if (!oneshot) return;
  const now = new Date();
  if (isStale(oneshot, now)) {
    log(`dropped the scheduled pull for ${oneshot.at} — missed by more than the grace window`);
    writeOneshot(null);
    return;
  }
  if (!isDue(oneshot, now)) return;
  // Still inside the window but the machine is busy: leave it armed and take the
  // next tick. Only a run that's now stale gives up.
  if (state.running) return;
  if (Date.now() - state.lastStart < COOLDOWN_MS) return;

  log(`starting the pull scheduled for ${oneshot.at}`);
  writeOneshot(null);
  startPull('scheduled');
}

setInterval(tickOneshot, TICK_MS).unref();
tickOneshot(); // a slot that passed while the agent was down still counts

// ===== Server =====

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  // Preflight. Refusing here is what stops a hostile page: without CORS
  // approval the browser never sends the real request.
  if (req.method === 'OPTIONS') {
    if (!originAllowed(origin)) {
      log(`refused preflight from origin: ${origin ?? '(none)'}`);
      res.writeHead(403).end();
      return;
    }
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // Liveness only — no token, no side effects, nothing sensitive. This is what
  // lets the page decide whether to render the button at all.
  if (req.method === 'GET' && path === '/health') {
    send(res, 200, { ok: true, agent: 'instagram-tracker' }, origin);
    return;
  }

  const authed = tokenValid(req.headers['x-tracker-token']);

  if (req.method === 'GET' && path === '/status') {
    if (!authed) return send(res, 401, { error: 'bad token' }, origin);
    const { lastStart, ...pub } = state;
    return send(res, 200, pub, origin);
  }

  // Lets the page show the new numbers straight away. Without this it would have
  // to wait out the GitHub Pages redeploy (~a minute) to see its own update.
  if (req.method === 'GET' && path === '/history') {
    if (!authed) return send(res, 401, { error: 'bad token' }, origin);
    try {
      return send(res, 200, JSON.parse(readFileSync(HISTORY, 'utf8')), origin);
    } catch (e) {
      return send(res, 500, { error: `could not read history.json: ${e.message}` }, origin);
    }
  }

  if (req.method === 'GET' && path === '/profile') {
    if (!authed) return send(res, 401, { error: 'bad token' }, origin);
    const username = (url.searchParams.get('username') || '').trim();
    if (!/^[A-Za-z0-9._]{1,40}$/.test(username)) {
      return send(res, 400, { error: 'bad username' }, origin);
    }
    fetchProfileInfo(username)
      .then((info) => send(res, 200, info, origin))
      .catch((e) => send(res, 502, { error: e.message }, origin));
    return;
  }

  if (req.method === 'GET' && path === '/avatar') {
    if (!authed) return send(res, 401, { error: 'bad token' }, origin);
    const src = url.searchParams.get('src') || '';
    // Only ever proxy Instagram's own CDN, never an arbitrary URL.
    if (!/^https:\/\/[a-z0-9.-]*(cdninstagram\.com|fbcdn\.net)\//i.test(src)) {
      return send(res, 400, { error: 'not an instagram cdn url' }, origin);
    }
    fetch(src, { headers: { 'user-agent': IG_UA, referer: 'https://www.instagram.com/' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`cdn returned ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': r.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'private, max-age=300',
          ...(originAllowed(origin) ? corsHeaders(origin) : {}),
        });
        res.end(buf);
      })
      .catch((e) => send(res, 502, { error: e.message }, origin));
    return;
  }

  if (req.method === 'POST' && path === '/pull') {
    // Belt and braces: a non-browser client bypasses CORS entirely, so check
    // the origin here too rather than relying on the preflight alone.
    if (!originAllowed(origin)) return send(res, 403, { error: 'origin not allowed' }, origin);
    if (!authed) {
      log('rejected /pull: bad token');
      return send(res, 401, { error: 'bad token' }, origin);
    }
    if (state.running) return send(res, 409, { error: 'a pull is already running' }, origin);
    const wait = COOLDOWN_MS - (Date.now() - state.lastStart);
    if (wait > 0) {
      return send(
        res,
        429,
        { error: `cooling down — try again in ${Math.ceil(wait / 1000)}s` },
        origin,
      );
    }
    log(`starting pull (requested by ${origin})`);
    startPull('manual');
    return send(res, 202, { started: true }, origin);
  }

  // Stop the run in flight. Same origin check as /pull — it's the same run, and
  // ending someone's pull uninvited is no more acceptable than starting one.
  if (req.method === 'POST' && path === '/cancel') {
    if (!originAllowed(origin)) return send(res, 403, { error: 'origin not allowed' }, origin);
    if (!authed) {
      log('rejected /cancel: bad token');
      return send(res, 401, { error: 'bad token' }, origin);
    }
    if (!cancelPull()) return send(res, 409, { error: 'nothing is running' }, origin);
    log(`stopping the running pull (requested by ${origin})`);
    return send(res, 202, { cancelling: true }, origin);
  }

  // How the last attempt went — including the ones that wrote no history.json,
  // which is the whole reason this exists.
  if (req.method === 'GET' && path === '/attempt') {
    if (!authed) return send(res, 401, { error: 'bad token' }, origin);
    return send(res, 200, { attempt: readAttempt(ATTEMPT) }, origin);
  }

  if (req.method === 'GET' && path === '/schedule') {
    if (!authed) return send(res, 401, { error: 'bad token' }, origin);
    return send(res, 200, { scheduled: oneshot }, origin);
  }

  // Arm a one-off pull, or cancel the armed one with { at: null }. Same origin
  // check as /pull: this schedules a real run, it just does it later.
  if (req.method === 'POST' && path === '/schedule') {
    if (!originAllowed(origin)) return send(res, 403, { error: 'origin not allowed' }, origin);
    if (!authed) {
      log('rejected /schedule: bad token');
      return send(res, 401, { error: 'bad token' }, origin);
    }
    readJson(req)
      .then((body) => {
        if (body.at === null) {
          if (oneshot) log(`cancelled the pull scheduled for ${oneshot.at}`);
          writeOneshot(null);
          return send(res, 200, { scheduled: null }, origin);
        }
        const parsed = parseRequested(body.at);
        if (parsed.error) return send(res, 400, { error: parsed.error }, origin);
        const entry = { at: parsed.at.toISOString(), createdAt: new Date().toISOString() };
        writeOneshot(entry);
        log(`scheduled a pull for ${entry.at}`);
        send(res, 200, { scheduled: entry }, origin);
      })
      .catch((e) => send(res, 400, { error: e.message }, origin));
    return;
  }

  send(res, 404, { error: 'not found' }, origin);
});

// The pull runs in its own process group now, which means it would otherwise
// outlive a Ctrl-C here — still paging Instagram with nothing left to stop it.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    const doomed = child;
    if (!state.running || !doomed) process.exit(0);
    log('shutting down — stopping the pull in flight');
    cancelPull('the agent was shut down while it was running');
    // Wait for it to actually go, so the cancelled attempt still gets recorded;
    // leave anyway if it won't, rather than hanging on a shutdown.
    const leave = () => process.exit(0);
    doomed.once('close', leave);
    setTimeout(leave, KILL_GRACE_MS + 1000);
  });
}

server.listen(config.port, '127.0.0.1', () => {
  log(`agent listening on http://127.0.0.1:${config.port} (loopback only)`);
  log(`allowed origins: ${ALLOWED_ORIGINS.join(', ')} + any localhost port`);
  if (oneshot) log(`one-off pull armed for ${oneshot.at}`);
});
