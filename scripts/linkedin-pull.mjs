#!/usr/bin/env node
// ===== Daily LinkedIn pull =====
//
// Runs once a day on your own machine and updates public/linkedin/history.json:
//
//   1. resolves your profile + authoritative connection/follower counts
//   2. pages your connections list
//   3. reads "who viewed your profile" and unions it into a permanent log
//   4. diffs the connection set against the previous run to emit events
//   5. writes history.json (and optionally commits it)
//
// ── Why the viewer log is a union, not a diff ───────────────────────────────
// Connections behave like Instagram followers: a stable set you diff. Profile
// views do not. LinkedIn shows a free account only its most recent handful of
// viewers and drops them entirely after 90 days, so there is no "set" to diff —
// there's a sliding window you have to keep copying out before it moves. Every
// run therefore unions whatever is currently visible into a log that only ever
// grows. Run it daily and after a year you have a view history LinkedIn itself
// will not show you; miss a week and those views are gone for good.
//
// ── On the API ──────────────────────────────────────────────────────────────
// LinkedIn has no public API for any of this. This uses the private voyager
// endpoints linkedin.com's own front-end calls, authenticated with your session
// cookie — the same arrangement (and the same caveats) as the Instagram
// tracker: it's automated collection, which LinkedIn's user agreement
// disallows, and it must run from a residential IP because datacenter ranges
// get challenged immediately.
//
// Voyager's response shapes drift without notice, so the parsers below are
// deliberately structural rather than path-based: they walk the payload looking
// for anything that *looks like* a profile or a view record. When LinkedIn
// changes something, run with --debug and inspect scripts/.linkedin-debug/.
//
// Usage:
//   node scripts/linkedin-pull.mjs             # pull and write
//   node scripts/linkedin-pull.mjs --dry-run   # pull, print a summary, write nothing
//   node scripts/linkedin-pull.mjs --debug     # also dump raw payloads for inspection
//   node scripts/linkedin-pull.mjs --commit    # write, then git commit + push
//   node scripts/linkedin-pull.mjs --force     # write even if the read looks partial
//   node scripts/linkedin-pull.mjs --once-daily  # no-op if today already succeeded
//
// Credentials live in scripts/.linkedin-secrets.json (gitignored):
//   {
//     "profile": "your-public-id",
//     "cookie": "<the whole Cookie: header from devtools>",
//     "publishViewers": false
//   }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SECRETS = resolve(__dirname, '.linkedin-secrets.json');
const STATE = resolve(__dirname, '.linkedin-state.json');
const DEBUG_DIR = resolve(__dirname, '.linkedin-debug');
/** The published file. Viewer identities are stripped unless you opt in. */
const OUT = resolve(REPO, 'public/linkedin/history.json');
/** The full-detail file, never committed. Drop it on the page to see names. */
const PRIVATE_OUT = resolve(__dirname, '.linkedin-private.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Page size for the connections list. LinkedIn caps this around 40–50. */
const PAGE_SIZE = 40;
/** Politeness window between pages, ms. Randomised inside this range. */
const DELAY_MIN = 1800;
const DELAY_MAX = 3800;
/** Extra breather every N pages. */
const LONG_PAUSE_EVERY = 10;
const LONG_PAUSE_MS = 11000;
/** Hard ceiling so a pagination bug can't loop forever. */
const MAX_PAGES = 200;
/** Refuse to write if we paged less than this share of the reported total. */
const COMPLETENESS_FLOOR = 0.9;
/** Cap on the stored view log — years of daily pulls before this ever bites. */
const MAX_VIEWS = 20000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const COMMIT = args.has('--commit');
const FORCE = args.has('--force');
const DEBUG = args.has('--debug');
const NO_NOTIFY = args.has('--no-notify');
const ONCE_DAILY = args.has('--once-daily');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);

function log(...parts) {
  console.log(`[${new Date().toISOString()}]`, ...parts);
}

/** YYYY-MM-DD in *local* time — "today" means the user's day, not UTC's. */
export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Has a pull already succeeded today?
 *
 * history.json is written only on success, so its `generatedAt` *is* the record
 * of the last good run. This is what lets the job be scheduled every hour while
 * doing real work at most once a day: the first attempt that succeeds makes the
 * rest of the day's attempts no-ops, and a failed attempt leaves the file
 * untouched so the next hour tries again.
 */
export function alreadySucceededToday(prev, now = new Date()) {
  if (!prev || prev.sample || !prev.generatedAt) return false;
  const t = new Date(prev.generatedAt);
  if (Number.isNaN(t.getTime())) return false;
  return localDay(t) === localDay(now);
}

// ===== Small persistent state (notification de-duplication) =====

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(next) {
  try {
    writeFileSync(STATE, JSON.stringify(next, null, 2) + '\n');
  } catch {
    /* state is a convenience; never fail a run over it */
  }
}

/**
 * Post a macOS notification. This job runs unattended, so a failure otherwise
 * only lands in a log file nobody opens. Strings are passed as argv rather than
 * interpolated into the AppleScript source, so quotes or emoji can't break it.
 */
function notify(title, subtitle, message) {
  if (NO_NOTIFY || process.platform !== 'darwin') return;
  const scpt =
    'on run argv\n' +
    'display notification (item 3 of argv) with title (item 1 of argv) ' +
    'subtitle (item 2 of argv) sound name "Basso"\n' +
    'end run';
  try {
    execFileSync('osascript', ['-e', scpt, title, subtitle, message], {
      stdio: 'ignore',
      timeout: 10000,
    });
  } catch {
    /* notifications are a courtesy — never let one fail the run */
  }
}

/**
 * Notify at most once per day per failure kind.
 *
 * The job retries every hour, so without this an expired cookie would fire the
 * same alert fifteen times before lunch and train you to ignore it.
 */
function notifyOncePerDay(kind, title, subtitle, message) {
  const today = localDay();
  const state = readState();
  if (state.notifiedOn === today && state.notifiedKind === kind) return;
  writeState({ ...state, notifiedOn: today, notifiedKind: kind });
  notify(title, subtitle, message);
}

function die(code, message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n  ${hint}\n`);
  // Exit 2 means "needs your attention" (expired cookie, bad config); 1 is
  // transient (throttled, network) and the next hourly attempt may well succeed.
  notifyOncePerDay(
    code === 2 ? 'action' : 'transient',
    'LinkedIn Tracker',
    code === 2 ? 'Action needed — tracking has stopped' : 'Run failed',
    message,
  );
  process.exit(code);
}

// ===== Credentials =====

export function parseCookieHeader(header) {
  const jar = {};
  for (const raw of String(header ?? '').split(';')) {
    // Trim before locating the '=': a leading space would otherwise push the
    // separator to index 1 on a valueless "=orphan" fragment, and an entry
    // keyed on the empty string would land in the jar.
    const pair = raw.trim();
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

/**
 * Voyager's CSRF token is just the JSESSIONID value with its quotes removed.
 *
 * The cookie is stored as `JSESSIONID="ajax:1234"` — quotes included — and the
 * header must be `csrf-token: ajax:1234`. Sending the quoted form is the single
 * most common reason a hand-built voyager request comes back 403.
 */
export function csrfFromJsessionid(value) {
  // Trim first: the quotes are the innermost wrapper, so stripping them before
  // the surrounding whitespace leaves them in place.
  return String(value ?? '').trim().replace(/^"|"$/g, '').trim();
}

function loadSecrets() {
  if (!existsSync(SECRETS)) {
    die(
      2,
      'No credentials found.',
      `Create ${SECRETS} with:\n\n` +
        `  {\n    "profile": "your-public-id",\n` +
        `    "cookie": "<paste the whole cookie: request header from linkedin.com>",\n` +
        `    "publishViewers": false\n  }\n\n` +
        `  To get the cookie: open linkedin.com logged in → DevTools → Network → click any\n` +
        `  request to www.linkedin.com → Request Headers → copy the whole "cookie:" value.\n` +
        `  "profile" is the slug in linkedin.com/in/<slug> (it can be omitted — the job\n` +
        `  will resolve it from the session).`,
    );
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(SECRETS, 'utf8'));
  } catch (e) {
    die(2, `${SECRETS} is not valid JSON: ${e.message}`);
  }

  const jar = raw.cookie ? parseCookieHeader(raw.cookie) : {};
  const liAt = raw.li_at || jar.li_at;
  const jsession = raw.jsessionid || jar.JSESSIONID || jar.jsessionid;

  if (!liAt) {
    die(
      2,
      'No li_at in the secrets file.',
      'Paste the full "cookie:" request header into the "cookie" field, or set "li_at" directly.',
    );
  }
  if (!jsession) {
    die(
      2,
      'No JSESSIONID in the secrets file.',
      'Voyager rejects any request without a matching csrf-token, which is derived from it.\n' +
        '  Copy the whole cookie header rather than just li_at.',
    );
  }

  const csrf = csrfFromJsessionid(jsession);
  return {
    profile: String(raw.profile ?? '').replace(/^.*\/in\//, '').replace(/\/$/, '').trim(),
    cookie: `li_at=${liAt}; JSESSIONID="${csrf}"`,
    csrf,
    // Default false: unlike a follower list, profile viewers are information
    // LinkedIn shows only to you. Publishing names to a public repo exposes
    // people who never agreed to that. Opt in explicitly if you want it.
    publishViewers: raw.publishViewers === true,
  };
}

// ===== HTTP =====

function headers(creds, referer) {
  return {
    // The normalized flavour returns a flat `included` array instead of deeply
    // nested unions, which is far easier to walk.
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': 'en-US,en;q=0.9',
    'csrf-token': creds.csrf,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
    'user-agent': UA,
    referer,
    cookie: creds.cookie,
  };
}

/**
 * GET JSON with backoff on throttling and clear failures on auth problems.
 *
 * `soft` endpoints are ones we can live without (followers, the views count):
 * they return null on failure instead of killing the run, because losing the
 * whole day's connection diff over an endpoint LinkedIn moved would be a much
 * worse outcome than a missing field.
 */
async function getJson(url, creds, referer, { soft = false, attempt = 1 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: headers(creds, referer) });
  } catch (e) {
    if (attempt <= 3) {
      const wait = 15000 * attempt;
      log(`network error (${e.message}); retrying in ${wait / 1000}s`);
      await sleep(wait);
      return getJson(url, creds, referer, { soft, attempt: attempt + 1 });
    }
    if (soft) return null;
    die(1, `Network error after ${attempt} attempts: ${e.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    // A 403 on one optional endpoint usually means "not entitled" (a Premium
    // surface on a free account), not "logged out" — so only a required
    // endpoint saying this is treated as an expired session.
    if (soft) return null;
    die(
      2,
      `Session rejected (HTTP ${res.status}) — re-paste your LinkedIn cookie to resume tracking.`,
      'Log in to linkedin.com in a browser, copy a fresh "cookie:" request header, and\n' +
        '  update scripts/.linkedin-secrets.json. Daily tracking is paused until then.\n' +
        '  If it keeps happening immediately, check that JSESSIONID came across too —\n' +
        '  voyager needs the csrf-token derived from it.',
    );
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt <= 3) {
      const wait = 60000 * attempt;
      log(`HTTP ${res.status}; backing off ${wait / 1000}s (attempt ${attempt}/3)`);
      await sleep(wait);
      return getJson(url, creds, referer, { soft, attempt: attempt + 1 });
    }
    if (soft) return null;
    die(
      1,
      `LinkedIn is throttling this session (HTTP ${res.status}) and did not recover.`,
      'Leave it alone for a few hours — the daily schedule will pick it up tomorrow.',
    );
  }
  if (!res.ok) {
    if (soft) return null;
    die(1, `HTTP ${res.status} from ${url}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (soft) return null;
    // A login wall or a challenge page returns HTML rather than JSON.
    die(
      2,
      'LinkedIn returned HTML instead of JSON.',
      'That usually means a checkpoint on the account, or a logged-out session. Open\n' +
        '  linkedin.com in a browser, clear any prompt, then re-copy the cookie header.',
    );
  }
  return json;
}

function dumpDebug(name, json) {
  if (!DEBUG || json == null) return;
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    writeFileSync(resolve(DEBUG_DIR, `${name}.json`), JSON.stringify(json, null, 2) + '\n');
    log(`debug: wrote ${name}.json`);
  } catch {
    /* debugging is a convenience */
  }
}

// ===== Generic voyager parsing =====
//
// Everything below is written against the *shape* of the payload rather than a
// fixed path, because voyager's decoration ids and field names change without
// notice and a path-based parser silently returns nothing when they do.

/** Depth-first walk over every object in a payload. */
export function walk(node, visit, seen = new Set()) {
  if (node == null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (!Array.isArray(node)) visit(node);
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    if (value && typeof value === 'object') walk(value, visit, seen);
  }
}

/**
 * Read a text field that may be a plain string or an attributed-text object.
 *
 * The dash (newer) model wraps almost every string as `{ text: "…" }`, and
 * sometimes as `{ text: { text: "…" } }`. The legacy model just uses a string.
 */
export function textOf(value) {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.trim() || undefined;
    if (value.text && typeof value.text === 'object') return textOf(value.text);
  }
  return undefined;
}

/** Index every entity in the payload by its urn, for resolving references. */
export function indexByUrn(json) {
  const map = new Map();
  walk(json, (node) => {
    const urn = node.entityUrn ?? node['*entityUrn'];
    if (typeof urn === 'string') map.set(urn, node);
  });
  return map;
}

/** Does this object look like a person? */
function isProfileNode(node) {
  return typeof node.publicIdentifier === 'string' && node.publicIdentifier.trim() !== '';
}

/** Normalise a voyager person object into our Person shape. */
export function toPerson(node) {
  const first = textOf(node.firstName);
  const last = textOf(node.lastName);
  const name = [first, last].filter(Boolean).join(' ').trim();
  return {
    id: node.publicIdentifier.trim(),
    name: name || undefined,
    headline: textOf(node.headline ?? node.occupation ?? node.primarySubtitle),
    company: textOf(node.companyName ?? node.secondarySubtitle),
    location: textOf(node.geoLocationName ?? node.locationName ?? node.tertiarySubtitle),
  };
}

/** Every distinct person mentioned anywhere in a payload. */
export function collectProfiles(json) {
  const out = new Map();
  walk(json, (node) => {
    if (!isProfileNode(node)) return;
    const person = toPerson(node);
    const prev = out.get(person.id.toLowerCase());
    // Later, richer records win — list decorations often carry a headline the
    // bare mini-profile doesn't.
    out.set(person.id.toLowerCase(), prev ? { ...prev, ...stripUndefined(person) } : person);
  });
  return [...out.values()];
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** The first plausible epoch-ms timestamp on a node, as ISO. */
export function viewTimeOf(node) {
  for (const key of ['viewedAt', 'lastViewedAt', 'viewTime', 'time', 'createdAt', 'occurredAt']) {
    const raw = node[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    // Accept seconds or milliseconds; reject anything outside a sane window so
    // an unrelated numeric field (a count, an id) can't masquerade as a date.
    const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : null;
    if (ms == null) continue;
    const d = new Date(ms);
    if (d.getFullYear() < 2003 || d.getTime() > Date.now() + 86_400_000) continue;
    return d.toISOString();
  }
  return null;
}

/**
 * The description LinkedIn shows in place of a name for an anonymous viewer.
 *
 * These arrive under a handful of different keys depending on how much the
 * viewer's privacy setting allows ("Someone at Acme", "Someone in the Software
 * industry", or just "LinkedIn Member").
 */
export function obfuscatedLabelOf(node) {
  const direct = textOf(
    node.obfuscatedViewerLabel ??
      node.viewerObfuscationLabel ??
      node.anonymousLabel ??
      node.obfuscatedName,
  );
  if (direct) return direct;

  const type = typeof node.viewerObfuscationType === 'string' ? node.viewerObfuscationType : null;
  if (type) {
    const company = textOf(node.companyName ?? node.company);
    const industry = textOf(node.industryName ?? node.industry);
    if (/COMPANY/i.test(type) && company) return `Someone at ${company}`;
    if (/INDUSTRY/i.test(type) && industry) return `Someone in ${industry}`;
    return 'Someone on LinkedIn';
  }
  // Some shapes give only a headline for a semi-private viewer.
  const headline = textOf(node.headline ?? node.subtitle ?? node.primarySubtitle);
  return headline ? `Someone — ${headline}` : null;
}

/**
 * Pull view records out of a "who viewed your profile" payload.
 *
 * A record is any node carrying a plausible view timestamp *and* either an
 * identifiable person or an obfuscation description. Nodes referencing a
 * profile by urn are resolved through the payload's own entity index.
 */
export function extractViewers(json) {
  if (!json) return [];
  const byUrn = indexByUrn(json);
  const out = [];

  walk(json, (node) => {
    const t = viewTimeOf(node);
    if (!t) return;

    const profile = resolveProfile(node, byUrn);
    const label = profile ? null : obfuscatedLabelOf(node);
    if (!profile && !label) return;

    out.push(
      stripUndefined({
        t,
        id: profile?.id,
        name: profile?.name,
        headline: profile?.headline ?? textOf(node.headline ?? node.subtitle),
        company: profile?.company ?? textOf(node.companyName ?? node.company),
        anonymous: profile ? undefined : true,
        label: label ?? undefined,
        degree: degreeOf(node),
      }),
    );
  });

  // The same record can be reached by more than one path in a normalized
  // payload; collapse exact duplicates.
  const seen = new Set();
  return out.filter((v) => {
    const key = `${v.id ?? v.label}|${v.t}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A person referenced directly, nested, or by urn. */
function resolveProfile(node, byUrn) {
  if (isProfileNode(node)) return toPerson(node);

  for (const [key, value] of Object.entries(node)) {
    if (!/viewer|profile|member|actor/i.test(key)) continue;
    if (value && typeof value === 'object' && isProfileNode(value)) return toPerson(value);
    if (typeof value === 'string' && value.startsWith('urn:li:')) {
      const target = byUrn.get(value);
      if (target && isProfileNode(target)) return toPerson(target);
    }
  }
  return null;
}

function degreeOf(node) {
  const raw =
    (typeof node.distance === 'string' && node.distance) ||
    (node.distance && typeof node.distance === 'object' && node.distance.value) ||
    node.memberDistance ||
    null;
  if (typeof raw !== 'string') return undefined;
  const m = /DISTANCE_(\d)/.exec(raw);
  if (m) return Number(m[1]);
  if (/SELF/i.test(raw)) return 0;
  return undefined;
}

/** The rolling "profile views" / "search appearances" figures, when present. */
export function extractCounts(json) {
  const out = {};
  if (!json) return out;
  walk(json, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (out.views == null && /^(numViews|allTimeNumViews|profileViews)$/i.test(key)) {
        out.views = value;
      }
      if (out.searchAppearances == null && /^(numSearchAppearances|searchAppearances)$/i.test(key)) {
        out.searchAppearances = value;
      }
    }
  });
  return out;
}

// ===== LinkedIn reads =====

const BASE = 'https://www.linkedin.com/voyager/api';
const FEED_REFERER = 'https://www.linkedin.com/feed/';

/** Your own public id and name, from the session. */
async function fetchMe(creds) {
  const json = await getJson(`${BASE}/me`, creds, FEED_REFERER);
  dumpDebug('me', json);
  const people = collectProfiles(json);
  if (people.length === 0) {
    die(
      1,
      'Could not resolve your own profile from the session.',
      'Set "profile" explicitly in the secrets file (the slug in linkedin.com/in/<slug>),\n' +
        '  or re-copy the cookie header.',
    );
  }
  return people[0];
}

/** Follower count and connection total. Both are best-effort but usually present. */
async function fetchCounts(creds, publicId) {
  const referer = `https://www.linkedin.com/in/${publicId}/`;
  const network = await getJson(
    `${BASE}/identity/profiles/${encodeURIComponent(publicId)}/networkinfo`,
    creds,
    referer,
    { soft: true },
  );
  dumpDebug('networkinfo', network);

  const summary = await getJson(`${BASE}/relationships/connectionsSummary`, creds, FEED_REFERER, {
    soft: true,
  });
  dumpDebug('connectionsSummary', summary);

  return {
    followers: firstNumber(network, /^followersCount$/i),
    connections: firstNumber(summary, /^numConnections$/i) ?? firstNumber(network, /^connectionsCount$/i),
  };
}

export function firstNumber(json, pattern) {
  let found = null;
  walk(json, (node) => {
    if (found != null) return;
    for (const [key, value] of Object.entries(node)) {
      if (pattern.test(key) && typeof value === 'number' && Number.isFinite(value)) {
        found = value;
        return;
      }
    }
  });
  return found;
}

/**
 * Page the connections list in full.
 *
 * Two endpoint generations are tried in order — the dash one linkedin.com uses
 * today, then the legacy one — because which is live has changed more than once
 * and a tracker that stops working silently is worse than useless.
 */
async function fetchConnections(creds) {
  const referer = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
  const shapes = [
    (start) =>
      `${BASE}/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16` +
      `&count=${PAGE_SIZE}&q=search&sortType=RECENTLY_ADDED&start=${start}`,
    (start) => `${BASE}/relationships/connections?count=${PAGE_SIZE}&start=${start}`,
  ];

  for (const [i, shape] of shapes.entries()) {
    const out = new Map();
    let page = 0;
    let ok = true;

    while (page < MAX_PAGES) {
      const json = await getJson(shape(page * PAGE_SIZE), creds, referer, { soft: true });
      if (json == null) {
        ok = false;
        break;
      }
      if (page === 0) dumpDebug(`connections-shape${i}`, json);

      const people = collectProfiles(json);
      // Voyager echoes your own profile in the payload; it isn't a connection.
      for (const p of people) out.set(p.id.toLowerCase(), p);

      page++;
      process.stdout.write(`\r  connections: ${out.size} (page ${page})   `);
      // An empty page is the end of the list — voyager doesn't reliably report
      // a total, so running dry is the terminator.
      if (people.length === 0) break;

      await sleep(jitter());
      if (page % LONG_PAUSE_EVERY === 0) await sleep(LONG_PAUSE_MS);
    }
    process.stdout.write('\n');

    if (page >= MAX_PAGES) log(`warning: hit the ${MAX_PAGES}-page ceiling on connections`);
    if (ok && out.size > 0) return [...out.values()];
    log(`connections: endpoint shape ${i + 1} returned nothing; trying the next one`);
  }

  die(
    1,
    'Could not read your connections from any known endpoint.',
    'LinkedIn has probably moved the endpoint again. Re-run with --debug and check\n' +
      '  scripts/.linkedin-debug/ to see what came back.',
  );
}

/**
 * "Who viewed your profile", from whichever surface still answers.
 *
 * Every one of these is soft: a free account gets a truncated list and may be
 * refused outright on the analytics surfaces, and that's a normal Tuesday
 * rather than a failure worth stopping the run over.
 */
async function fetchViewers(creds) {
  const referer = 'https://www.linkedin.com/me/profile-views/';
  const urls = [
    `${BASE}/identity/wvmpCards?count=50&q=viewersCard&start=0`,
    `${BASE}/identity/wvmpCards?q=viewersCard`,
    `${BASE}/identity/dash/profileViews?q=viewers&count=50&start=0`,
    `${BASE}/identity/wvmpCards?count=50&q=surfaceCards&start=0`,
  ];

  const all = [];
  const counts = {};
  for (const [i, url] of urls.entries()) {
    const json = await getJson(url, creds, referer, { soft: true });
    if (!json) continue;
    dumpDebug(`viewers-${i}`, json);

    const found = extractViewers(json);
    all.push(...found);
    Object.assign(counts, stripUndefined(extractCounts(json)), counts);
    if (found.length) log(`  profile views: ${found.length} record(s) from endpoint ${i + 1}`);
    await sleep(jitter());
  }

  if (all.length === 0) {
    log(
      '  profile views: nothing readable. LinkedIn shows free accounts only a handful of\n' +
        '  recent viewers, and moves this surface often — re-run with --debug to inspect.',
    );
  }
  return { views: all, counts };
}

/**
 * Followers, best-effort.
 *
 * Unlike connections, LinkedIn exposes no stable list endpoint for followers —
 * only a count. This tries the surface the "Followers" page uses and shrugs if
 * it isn't there; the count from networkinfo is what the graph actually plots.
 */
async function fetchFollowers(creds) {
  const referer = 'https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/';
  const json = await getJson(
    `${BASE}/identity/dash/profileFollowers?q=followers&count=${PAGE_SIZE}&start=0`,
    creds,
    referer,
    { soft: true },
  );
  if (!json) return [];
  dumpDebug('followers', json);
  return collectProfiles(json);
}

// ===== Merge =====

function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data.snapshots) || !Array.isArray(data.events)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Carry `since` forward for people already on file, and stamp today for ones
 * we're seeing for the first time. On the very first real run there's no
 * baseline, so everyone stays undated rather than all claiming to have
 * connected today — a CSV import backfills the true dates.
 */
export function mergeSince(current, previousList, nowIso, firstRealRun) {
  const prevByKey = new Map((previousList ?? []).map((p) => [p.id.toLowerCase(), p]));
  return current.map((p) => {
    const prev = prevByKey.get(p.id.toLowerCase());
    const since = prev?.since ?? (firstRealRun ? undefined : nowIso);
    return since ? { ...p, since } : p;
  });
}

/** Connect/disconnect events from the connection-set difference. */
export function diffConnections(current, previous, nowIso) {
  const prevByKey = new Map((previous ?? []).map((p) => [p.id.toLowerCase(), p]));
  const curKeys = new Set(current.map((p) => p.id.toLowerCase()));

  const gained = current
    .filter((p) => !prevByKey.has(p.id.toLowerCase()))
    .map((p) => ({ id: p.id, kind: 'connect', t: nowIso, name: p.name, headline: p.headline }));

  const lost = [...prevByKey.values()]
    .filter((p) => !curKeys.has(p.id.toLowerCase()))
    .map((p) => ({ id: p.id, kind: 'disconnect', t: nowIso, name: p.name, headline: p.headline }));

  return { gained, lost };
}

/**
 * The stored list changes only through confirmed events — never through a read
 * simply missing someone.
 *
 * Rebuilding the list from each read makes paging churn self-sustaining: a
 * missed page deletes people, and their reappearance next run looks like a
 * brand-new connection. Holding people until a disconnect is actually seen
 * breaks that cycle. (Voyager's connections endpoint is eventually consistent
 * in exactly the way Instagram's followers endpoint is.)
 */
export function stableList(previous, currentRead, confirmedGone) {
  const byKey = new Map();
  for (const p of previous ?? []) byKey.set(p.id.toLowerCase(), p);
  for (const p of currentRead) {
    const k = p.id.toLowerCase();
    const old = byKey.get(k);
    // Fresh profile fields win; the earliest known date is kept.
    byKey.set(k, old ? { ...old, ...p, since: old.since ?? p.since } : p);
  }
  for (const k of confirmedGone) byKey.delete(k);
  return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** One snapshot per calendar day — a re-run on the same day replaces it. */
export function appendSnapshot(snapshots, point) {
  const day = point.t.slice(0, 10);
  const kept = (snapshots ?? []).filter((s) => String(s.t).slice(0, 10) !== day);
  kept.push(point);
  kept.sort((a, b) => new Date(a.t) - new Date(b.t));
  return kept;
}

/**
 * Union newly visible views into the permanent log.
 *
 * De-duplicated to one record per viewer per local day. That granularity is
 * deliberate: LinkedIn's own timestamps for the same visit are not stable
 * between reads (some surfaces return a coarse "3 days ago" bucket that shifts
 * as it ages), so keying on the exact instant would re-record the same visit
 * every single run. A day is the finest resolution that's actually reliable.
 */
export function mergeViews(previous, incoming, nowIso) {
  const keyOf = (v) => {
    const who = v.id ? `id:${v.id.toLowerCase()}` : `anon:${(v.label ?? 'someone').toLowerCase()}`;
    return `${who}|${localDay(new Date(v.t))}`;
  };

  const byKey = new Map();
  for (const v of previous ?? []) byKey.set(keyOf(v), v);

  let added = 0;
  for (const v of incoming) {
    const key = keyOf(v);
    const old = byKey.get(key);
    if (!old) {
      byKey.set(key, { ...v, seen: nowIso });
      added++;
      continue;
    }
    // Refresh the descriptive fields (people change jobs) but keep the earliest
    // timestamp and the original first-seen stamp.
    byKey.set(key, {
      ...old,
      ...v,
      t: new Date(v.t) < new Date(old.t) ? v.t : old.t,
      seen: old.seen ?? nowIso,
    });
  }

  const merged = [...byKey.values()].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, MAX_VIEWS);
  return { views: merged, added };
}

/**
 * Strip viewer identities for the published file.
 *
 * The shape of the data survives — counts, timing, employers, degrees — so the
 * public page is still a real tracker. What doesn't survive is any way to point
 * at a named person, because unlike a follower list, "who looked at your
 * profile" is something LinkedIn shows only to you, and the people in it never
 * agreed to appear on a public web page.
 */
export function redactViews(views) {
  return views.map((v) => {
    const label = v.company ? `Someone at ${v.company}` : v.label ?? 'Someone on LinkedIn';
    return stripUndefined({
      t: v.t,
      seen: v.seen,
      anonymous: true,
      label,
      company: v.company,
      degree: v.degree,
    });
  });
}

/**
 * Returns a human-readable reason if the read looks partial, else null.
 *
 * A throttled or truncated read looks exactly like a mass disconnect to a
 * diffing tracker, so it's better to write nothing than to record fiction.
 */
export function checkCompleteness(connections, reported, prev) {
  if (reported && connections.length < reported * COMPLETENESS_FLOOR) {
    return `paged ${connections.length} connections but LinkedIn reports ${reported}`;
  }
  const prevCount = prev?.sample ? 0 : prev?.connections?.length ?? 0;
  if (prevCount > 20 && connections.length < prevCount * 0.5) {
    return `connection count halved since the last run (${prevCount} → ${connections.length})`;
  }
  return null;
}

// ===== Main =====

async function main() {
  const prev = loadJson(PRIVATE_OUT) ?? loadJson(OUT);

  // Scheduled hourly, but only ever does the work once a day. Checked before
  // anything else so a satisfied day costs one file read and no network at all.
  if (ONCE_DAILY && !DRY_RUN && alreadySucceededToday(prev)) {
    log(`already pulled today (${prev.generatedAt}) — nothing to do`);
    return;
  }

  const creds = loadSecrets();
  const nowIso = new Date().toISOString();
  const firstRealRun = !prev || prev.sample || !prev.connections?.length;

  const me = await fetchMe(creds);
  const publicId = creds.profile || me.id;
  log(`pulling /in/${publicId}${DRY_RUN ? ' (dry run)' : ''}`);

  const reported = await fetchCounts(creds, publicId);
  log(
    `reported ${reported.connections ?? '?'} connections · ${reported.followers ?? '?'} followers`,
  );

  const connectionsRead = (await fetchConnections(creds)).filter(
    (p) => p.id.toLowerCase() !== publicId.toLowerCase(),
  );
  await sleep(jitter());
  const { views: viewsRead, counts } = await fetchViewers(creds);
  await sleep(jitter());
  const followersRead = (await fetchFollowers(creds)).filter(
    (p) => p.id.toLowerCase() !== publicId.toLowerCase(),
  );

  const shortfall = checkCompleteness(connectionsRead, reported.connections, prev);
  if (shortfall && !FORCE) {
    die(
      1,
      `Read looks incomplete: ${shortfall}`,
      'Nothing was written, so no phantom disconnects got recorded. Try again later, or\n' +
        '  pass --force if you know the drop is real.\n\n' +
        '  Note: profile views seen today were NOT saved either. If this keeps happening,\n' +
        '  --force is the lesser evil — a wrong connection count is recoverable, a missed\n' +
        '  day of viewers is not.',
    );
  }
  if (shortfall) log(`warning: ${shortfall} (writing anyway because of --force)`);

  const mergedConnections = mergeSince(connectionsRead, prev?.connections, nowIso, firstRealRun);
  const mergedFollowers = mergeSince(followersRead, prev?.followers, nowIso, firstRealRun);

  const { gained, lost } = firstRealRun
    ? { gained: [], lost: [] }
    : diffConnections(connectionsRead, prev.connections, nowIso);

  const events = [...gained, ...lost, ...(firstRealRun ? [] : prev.events ?? [])]
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, MAX_VIEWS);

  const goneKeys = new Set(lost.map((e) => e.id.toLowerCase()));
  const nextConnections = stableList(prev?.connections, mergedConnections, goneKeys);
  // Followers come from a soft endpoint that may return nothing at all; an
  // empty read must not be allowed to wipe the stored list.
  const nextFollowers = followersRead.length
    ? stableList(prev?.followers, mergedFollowers, new Set())
    : prev?.followers ?? [];

  const { views, added } = mergeViews(prev?.views, viewsRead, nowIso);

  const base = {
    profile: publicId,
    name: me.name,
    generatedAt: nowIso,
    sample: false,
    snapshots: appendSnapshot(firstRealRun ? [] : prev.snapshots, {
      t: nowIso,
      // Snapshot the stored totals, not the raw read — the read fluctuates.
      connections: nextConnections.length,
      followers: reported.followers ?? nextFollowers.length ?? undefined,
      viewsRolling: counts.views ?? undefined,
      searchAppearances: counts.searchAppearances ?? undefined,
    }),
    events,
    connections: nextConnections,
    followers: nextFollowers,
  };

  const priv = { ...base, redacted: false, views };
  const published = creds.publishViewers
    ? { ...base, redacted: false, views }
    : { ...base, redacted: true, views: redactViews(views) };

  log(
    `connections ${nextConnections.length} · followers ${nextFollowers.length} · ` +
      `+${gained.length} new / −${lost.length} lost · ` +
      `${added} new profile view(s) (${views.length} logged)`,
  );
  for (const [label, list] of [
    ['connected', gained],
    ['disconnected', lost],
  ]) {
    if (list.length) log(`  ${label}: ${list.map((e) => e.name ?? e.id).join(', ')}`);
  }
  if (added) {
    const fresh = views.slice(0, added).map((v) => v.name ?? v.label ?? 'someone');
    log(`  viewed you: ${fresh.join(', ')}`);
  }
  if (firstRealRun) log('first real run — recorded a baseline, diffs start tomorrow');

  if (DRY_RUN) {
    log('dry run: nothing written');
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(published, null, 2) + '\n');
  writeFileSync(PRIVATE_OUT, JSON.stringify(priv, null, 2) + '\n');
  log(`wrote ${OUT}${creds.publishViewers ? '' : ' (viewer names withheld)'}`);
  log(`wrote ${PRIVATE_OUT} (full detail, never committed)`);

  if (COMMIT) commitAndPush(gained.length, lost.length, added);
}

function commitAndPush(gainedCount, lostCount, viewCount) {
  const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  try {
    if (!git('status', '--porcelain', 'public/linkedin/history.json')) {
      log('no change to commit');
      return;
    }
    // Commit via an explicit pathspec rather than `add` + `commit`: this job runs
    // unattended, and the repo may well have unrelated staged work in the index
    // that must not get swept into an automated commit.
    git(
      'commit',
      '-m',
      `LinkedIn tracker: +${gainedCount} / −${lostCount} · ${viewCount} view${viewCount === 1 ? '' : 's'}`,
      '--',
      'public/linkedin/history.json',
    );
    git('push');
    log('committed and pushed');
  } catch (e) {
    // A failed push shouldn't look like a failed pull — the data is already saved.
    console.error(`\n⚠ history.json was written but git failed: ${e.message}`);
    notify(
      'LinkedIn Tracker',
      'Data saved, but publishing failed',
      'The pull succeeded; git could not push. The live site is behind.',
    );
    process.exitCode = 1;
  }
}

// Only run when invoked directly, so the pure helpers above can be unit-tested.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error('\n✗ Unexpected failure:', e);
    process.exit(1);
  });
}
