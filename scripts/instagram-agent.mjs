#!/usr/bin/env node
// ===== Local "Update now" agent =====
//
// A tiny HTTP server on the loopback interface that lets the Instagram Tracker
// page trigger a pull on demand. The deployed site is static, so it can't run
// anything itself — but a browser on this Mac *can* reach 127.0.0.1, even from
// an https:// page (loopback is exempt from mixed-content blocking).
//
//   GET  /health   → { ok: true }              no token, no side effects
//   GET  /status   → progress of the current/last run          (token required)
//   GET  /history  → the freshly written history.json          (token required)
//   POST /pull     → start a pull, returns immediately         (token required)
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
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SECRETS = resolve(__dirname, '.instagram-secrets.json');
const PULL = resolve(__dirname, 'instagram-pull.mjs');
const HISTORY = resolve(REPO, 'public/instagram/history.json');

const DEFAULT_PORT = 4599;
/** Minimum gap between run *starts*, ms. Instagram rate-limits; be polite. */
const COOLDOWN_MS = 120_000;

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
  };
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
  lastStart: 0,
};

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

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  // Only ever hand CORS approval to an allowed origin.
  if (origin && originAllowed(origin)) Object.assign(headers, corsHeaders(origin));
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

// ===== The pull =====

function startPull() {
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

  // Fixed argv — nothing from the request reaches the child.
  const child = spawn(process.execPath, [PULL, '--commit'], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let tail = '';
  const absorb = (chunk) => {
    const text = String(chunk);
    tail = (tail + text).slice(-4000);
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

  child.on('close', (code) => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.ok = code === 0;
    state.phase = code === 0 ? 'done' : 'failed';
    const summary = tail.match(/followers \d+ · following \d+[^\n]*/);
    state.summary = summary ? summary[0] : null;
    if (code !== 0) {
      // Surface the script's own "✗ …" line; it's already written for humans.
      const reason = tail.match(/✗ ([^\n]+)/);
      state.error = reason ? reason[1] : `pull exited ${code}`;
    }
    log(`run finished: ${state.phase}${state.error ? ` — ${state.error}` : ''}`);
  });

  child.on('error', (e) => {
    state.running = false;
    state.ok = false;
    state.phase = 'failed';
    state.error = `could not start the pull: ${e.message}`;
  });
}

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
    startPull();
    return send(res, 202, { started: true }, origin);
  }

  send(res, 404, { error: 'not found' }, origin);
});

server.listen(config.port, '127.0.0.1', () => {
  log(`agent listening on http://127.0.0.1:${config.port} (loopback only)`);
  log(`allowed origins: ${ALLOWED_ORIGINS.join(', ')} + any localhost port`);
});
