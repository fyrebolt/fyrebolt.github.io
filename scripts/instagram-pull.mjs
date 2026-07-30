#!/usr/bin/env node
// ===== Daily Instagram follower pull =====
//
// Runs once a day on your own machine (see scripts/launchd/README in the repo
// README) and updates public/instagram/history.json:
//
//   1. resolves your numeric user id + authoritative counts
//   2. pages your followers and following lists
//   3. diffs the follower set against the previous run to emit follow/unfollow
//      events, preserving relationship start dates already on file
//   4. writes history.json (and optionally commits it)
//
// Instagram has no public API for follower *lists* — this uses the same private
// web endpoints instagram.com itself calls, authenticated with your own session
// cookie. That means it can break without warning, and it needs a real browser
// session: expect to re-paste the cookie every few weeks.
//
// Usage:
//   node scripts/instagram-pull.mjs             # pull and write
//   node scripts/instagram-pull.mjs --dry-run   # pull, print a summary, write nothing
//   node scripts/instagram-pull.mjs --commit    # write, then git commit + push
//   node scripts/instagram-pull.mjs --force     # write even if the read looks partial
//   node scripts/instagram-pull.mjs --once-daily  # no-op if today already succeeded
//
// Credentials live in scripts/.instagram-secrets.json (gitignored):
//   { "account": "yourhandle", "cookie": "<the whole Cookie: header from devtools>" }
// or explicitly:
//   { "account": "yourhandle", "sessionid": "...", "ds_user_id": "...", "csrftoken": "..." }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SECRETS = resolve(__dirname, '.instagram-secrets.json');
const STATE = resolve(__dirname, '.instagram-state.json');
const OUT = resolve(REPO, 'public/instagram/history.json');

const IG_APP_ID = '936619743392459';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Page size. Instagram caps the web followers endpoint around 50. */
const PAGE_SIZE = 50;
/** Politeness window between pages, ms. Randomised inside this range. */
const DELAY_MIN = 1400;
const DELAY_MAX = 3200;
/** Extra breather every N pages. */
const LONG_PAUSE_EVERY = 12;
const LONG_PAUSE_MS = 9000;
/** Hard ceiling so a pagination bug can't loop forever. */
const MAX_PAGES = 400;
/** Refuse to write if we collected less than this share of the reported total. */
const COMPLETENESS_FLOOR = 0.9;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const COMMIT = args.has('--commit');
const FORCE = args.has('--force');
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
 * of the last good run — no separate stamp file to drift out of sync. This is
 * what lets the job be scheduled every hour while still doing real work at most
 * once a day: the first attempt that succeeds makes the rest of the day's
 * attempts no-ops. A failed attempt leaves the file untouched, so the next hour
 * tries again.
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
 * only lands in a log file nobody opens — you could go a month believing it's
 * still tracking. Strings are passed as argv rather than interpolated into the
 * AppleScript source, so quotes or emoji in a message can't break it.
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
    'Instagram Tracker',
    code === 2 ? 'Action needed — tracking has stopped' : 'Run failed',
    message,
  );
  process.exit(code);
}

// ===== Credentials =====

function loadSecrets() {
  if (!existsSync(SECRETS)) {
    die(
      2,
      'No credentials found.',
      `Create ${SECRETS} with:\n\n` +
        `  {\n    "account": "yourhandle",\n    "cookie": "<paste the Cookie: request header from instagram.com>"\n  }\n\n` +
        `  To get it: open instagram.com logged in → DevTools → Network → click any\n` +
        `  request to instagram.com → Request Headers → copy the whole "cookie:" value.`,
    );
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(SECRETS, 'utf8'));
  } catch (e) {
    die(2, `${SECRETS} is not valid JSON: ${e.message}`);
  }

  const account = String(raw.account || '').replace(/^@/, '').trim();
  if (!account) die(2, 'Set "account" (your handle, without the @) in the secrets file.');

  // Accept either a raw Cookie header or the three individual values.
  const jar = raw.cookie ? parseCookieHeader(raw.cookie) : {};
  const sessionid = raw.sessionid || jar.sessionid;
  const dsUserId = raw.ds_user_id || jar.ds_user_id;
  const csrftoken = raw.csrftoken || jar.csrftoken || '';

  if (!sessionid) {
    die(
      2,
      'No sessionid in the secrets file.',
      'Paste the full "cookie:" request header into the "cookie" field, or set "sessionid" directly.',
    );
  }

  const cookieParts = [`sessionid=${sessionid}`];
  if (dsUserId) cookieParts.push(`ds_user_id=${dsUserId}`);
  if (csrftoken) cookieParts.push(`csrftoken=${csrftoken}`);

  return { account, cookie: cookieParts.join('; '), csrftoken };
}

export function parseCookieHeader(header) {
  const jar = {};
  for (const pair of String(header).split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

// ===== HTTP =====

function headers(creds, referer) {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'x-ig-app-id': IG_APP_ID,
    'x-csrftoken': creds.csrftoken,
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': UA,
    referer,
    cookie: creds.cookie,
  };
}

/** GET JSON with backoff on throttling, and clear failures on auth problems. */
async function getJson(url, creds, referer, attempt = 1) {
  let res;
  try {
    res = await fetch(url, { headers: headers(creds, referer) });
  } catch (e) {
    if (attempt <= 3) {
      const wait = 15000 * attempt;
      log(`network error (${e.message}); retrying in ${wait / 1000}s`);
      await sleep(wait);
      return getJson(url, creds, referer, attempt + 1);
    }
    die(1, `Network error after ${attempt} attempts: ${e.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    // Phrased to read well both in a terminal and as a notification body.
    die(
      2,
      `Session cookie expired (HTTP ${res.status}) — re-paste it to resume tracking.`,
      'Log in to instagram.com in a browser, copy a fresh "cookie:" request header,\n' +
        '  and update scripts/.instagram-secrets.json. Daily tracking is paused until then.',
    );
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt <= 3) {
      const wait = 60000 * attempt;
      log(`HTTP ${res.status}; backing off ${wait / 1000}s (attempt ${attempt}/3)`);
      await sleep(wait);
      return getJson(url, creds, referer, attempt + 1);
    }
    die(
      1,
      `Instagram is throttling this session (HTTP ${res.status}) and did not recover.`,
      'Leave it alone for a few hours — the daily schedule will pick it up tomorrow.',
    );
  }
  if (!res.ok) die(1, `HTTP ${res.status} from ${url}`);

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // A login wall or challenge page returns HTML rather than JSON.
    die(
      2,
      'Instagram returned HTML instead of JSON.',
      'That usually means a checkpoint/challenge on the account. Open instagram.com in\n' +
        '  a browser, clear any "suspicious login" prompt, then re-copy the cookie header.',
    );
  }
  if (json?.message === 'checkpoint_required' || json?.message === 'challenge_required') {
    die(
      2,
      'Instagram wants a security checkpoint cleared.',
      'Open instagram.com in a browser, confirm the prompt, then re-copy the cookie header.',
    );
  }
  return json;
}

// ===== Instagram reads =====

/** Numeric id + authoritative follower/following counts for the handle. */
async function fetchProfile(creds) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(creds.account)}`;
  const json = await getJson(url, creds, `https://www.instagram.com/${creds.account}/`);
  const user = json?.data?.user;
  if (!user?.id) {
    die(
      1,
      `Could not resolve @${creds.account}.`,
      'Check the handle in the secrets file is spelled exactly right.',
    );
  }
  return {
    id: String(user.id),
    name: user.full_name || undefined,
    followerCount: user.edge_followed_by?.count ?? null,
    followingCount: user.edge_follow?.count ?? null,
  };
}

/** Page one relationship list ('followers' | 'following') in full. */
async function fetchList(creds, userId, which) {
  const out = [];
  const seen = new Set();
  let maxId = null;
  let page = 0;

  while (page < MAX_PAGES) {
    page++;
    const params = new URLSearchParams({ count: String(PAGE_SIZE) });
    if (maxId) params.set('max_id', maxId);
    const url = `https://www.instagram.com/api/v1/friendships/${userId}/${which}/?${params}`;
    const json = await getJson(url, creds, `https://www.instagram.com/${creds.account}/${which}/`);

    const users = Array.isArray(json?.users) ? json.users : [];
    for (const u of users) {
      const username = String(u?.username || '').trim();
      if (!username || seen.has(username.toLowerCase())) continue;
      seen.add(username.toLowerCase());
      // profile_pic_url is deliberately dropped — the signed URLs expire and
      // would churn hundreds of KB into history.json on every daily commit.
      out.push({
        username,
        name: u.full_name?.trim() || undefined,
        verified: u.is_verified || undefined,
        private: u.is_private || undefined,
      });
    }

    process.stdout.write(`\r  ${which}: ${out.length} (page ${page})   `);

    maxId = json?.next_max_id ? String(json.next_max_id) : null;
    if (!maxId || users.length === 0) break;

    await sleep(jitter());
    if (page % LONG_PAUSE_EVERY === 0) await sleep(LONG_PAUSE_MS);
  }
  process.stdout.write('\n');

  if (page >= MAX_PAGES) log(`warning: hit the ${MAX_PAGES}-page ceiling on ${which}`);
  return out;
}

// ===== Merge =====

function loadPrevious() {
  if (!existsSync(OUT)) return null;
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    if (!Array.isArray(prev.snapshots) || !Array.isArray(prev.events)) return null;
    return prev;
  } catch {
    return null;
  }
}

/**
 * Carry `since` forward for accounts already on file, and stamp today for ones
 * we're seeing for the first time. On the very first real run there's no
 * baseline, so everyone stays undated rather than all claiming to have joined
 * today — a ZIP import can backfill the true dates.
 */
export function mergeSince(current, previousList, nowIso, firstRealRun) {
  const prevByKey = new Map((previousList ?? []).map((p) => [p.username.toLowerCase(), p]));
  return current.map((p) => {
    const prev = prevByKey.get(p.username.toLowerCase());
    const since = prev?.since ?? (firstRealRun ? undefined : nowIso);
    return since ? { ...p, since } : p;
  });
}

/** Follow/unfollow events from the follower-set difference. */
export function diffFollowers(followers, prevFollowers, nowIso) {
  const prevByKey = new Map((prevFollowers ?? []).map((p) => [p.username.toLowerCase(), p]));
  const curKeys = new Set(followers.map((p) => p.username.toLowerCase()));

  const gained = followers
    .filter((p) => !prevByKey.has(p.username.toLowerCase()))
    .map((p) => ({ username: p.username, kind: 'follow', t: nowIso, name: p.name }));

  const lost = [...prevByKey.values()]
    .filter((p) => !curKeys.has(p.username.toLowerCase()))
    .map((p) => ({ username: p.username, kind: 'unfollow', t: nowIso, name: p.name }));

  return { gained, lost };
}

/** One snapshot per calendar day — a re-run on the same day replaces it. */
export function appendSnapshot(snapshots, point) {
  const day = point.t.slice(0, 10);
  const kept = (snapshots ?? []).filter((s) => String(s.t).slice(0, 10) !== day);
  kept.push(point);
  kept.sort((a, b) => new Date(a.t) - new Date(b.t));
  return kept;
}

// ===== Main =====

async function main() {
  const prev = loadPrevious();

  // Scheduled hourly, but only ever does the work once a day. Checked before
  // anything else so a satisfied day costs one file read and no network at all.
  if (ONCE_DAILY && !DRY_RUN && alreadySucceededToday(prev)) {
    log(`already pulled today (${prev.generatedAt}) — nothing to do`);
    return;
  }

  const creds = loadSecrets();
  const nowIso = new Date().toISOString();
  const firstRealRun = !prev || prev.sample || !prev.followers?.length;

  log(`pulling @${creds.account}${DRY_RUN ? ' (dry run)' : ''}`);

  const profile = await fetchProfile(creds);
  log(
    `resolved id ${profile.id} · ${profile.followerCount ?? '?'} followers · ` +
      `${profile.followingCount ?? '?'} following`,
  );

  const followers = await fetchList(creds, profile.id, 'followers');
  await sleep(jitter() * 2);
  const following = await fetchList(creds, profile.id, 'following');

  // A throttled or truncated read looks exactly like a mass unfollow to a
  // diffing tracker, so bail out rather than record fiction.
  const shortfall = checkCompleteness(followers, following, profile, prev);
  if (shortfall && !FORCE) {
    die(
      1,
      `Read looks incomplete: ${shortfall}`,
      'Nothing was written, so no phantom unfollows got recorded. Try again later, or\n' +
        '  pass --force if you know the drop is real.',
    );
  }
  if (shortfall) log(`warning: ${shortfall} (writing anyway because of --force)`);

  const mergedFollowers = mergeSince(followers, prev?.followers, nowIso, firstRealRun);
  const mergedFollowing = mergeSince(following, prev?.following, nowIso, firstRealRun);

  const { gained, lost } = firstRealRun
    ? { gained: [], lost: [] }
    : diffFollowers(followers, prev.followers, nowIso);

  const events = [...gained, ...lost, ...(firstRealRun ? [] : prev.events ?? [])]
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, 5000);

  const data = {
    account: creds.account,
    generatedAt: nowIso,
    sample: false,
    snapshots: appendSnapshot(firstRealRun ? [] : prev.snapshots, {
      t: nowIso,
      followers: followers.length,
      following: following.length,
    }),
    events,
    followers: mergedFollowers.sort((a, b) => a.username.localeCompare(b.username)),
    following: mergedFollowing.sort((a, b) => a.username.localeCompare(b.username)),
  };

  const mutuals = countMutuals(followers, following);
  log(
    `followers ${followers.length} · following ${following.length} · mutuals ${mutuals} · ` +
      `+${gained.length} new · −${lost.length} lost`,
  );
  if (gained.length) log(`  new:  ${gained.map((e) => '@' + e.username).join(', ')}`);
  if (lost.length) log(`  lost: ${lost.map((e) => '@' + e.username).join(', ')}`);
  if (firstRealRun) log('first real run — recorded a baseline, diffs start tomorrow');

  if (DRY_RUN) {
    log('dry run: history.json not written');
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  log(`wrote ${OUT}`);

  if (COMMIT) commitAndPush(gained.length, lost.length);
}

export function countMutuals(followers, following) {
  const followingKeys = new Set(following.map((p) => p.username.toLowerCase()));
  return followers.filter((p) => followingKeys.has(p.username.toLowerCase())).length;
}

/** Returns a human-readable reason if the read looks partial, else null. */
export function checkCompleteness(followers, following, profile, prev) {
  if (profile.followerCount && followers.length < profile.followerCount * COMPLETENESS_FLOOR) {
    return `paged ${followers.length} followers but the profile reports ${profile.followerCount}`;
  }
  if (profile.followingCount && following.length < profile.followingCount * COMPLETENESS_FLOOR) {
    return `paged ${following.length} following but the profile reports ${profile.followingCount}`;
  }
  const prevCount = prev?.sample ? 0 : prev?.followers?.length ?? 0;
  if (prevCount > 20 && followers.length < prevCount * 0.5) {
    return `follower count halved since the last run (${prevCount} → ${followers.length})`;
  }
  return null;
}

function commitAndPush(gainedCount, lostCount) {
  const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  try {
    if (!git('status', '--porcelain', 'public/instagram/history.json')) {
      log('no change to commit');
      return;
    }
    // Commit via an explicit pathspec rather than `add` + `commit`: this job runs
    // unattended, and the repo may well have unrelated staged work in the index
    // that must not get swept into an automated commit.
    git('commit', '-m', `Instagram tracker: +${gainedCount} / −${lostCount}`, '--',
      'public/instagram/history.json');
    git('push');
    log('committed and pushed');
  } catch (e) {
    // A failed push shouldn't look like a failed pull — the data is already saved.
    console.error(`\n⚠ history.json was written but git failed: ${e.message}`);
    notify(
      'Instagram Tracker',
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
