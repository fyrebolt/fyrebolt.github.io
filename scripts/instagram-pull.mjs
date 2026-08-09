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
// Credentials live in scripts/.instagram-secrets.json (gitignored). Write them
// with the setup script rather than by hand — it also checks them against
// instagram.com before it finishes:
//   node scripts/instagram-setup.mjs
// The file it writes:
//   { "account": "yourhandle", "sessionid": "...", "ds_user_id": "...", "csrftoken": "..." }
// A hand-written { "account": ..., "cookie": "<whole Cookie: header>" } also works.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  buildSession,
  igHeaders,
  profileInfoUrl,
  profileReferer,
} from './lib/instagram-session.mjs';
import { readInstalledSchedule } from './lib/instagram-schedule.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SECRETS = resolve(__dirname, '.instagram-secrets.json');
const STATE = resolve(__dirname, '.instagram-state.json');
const OUT = resolve(REPO, 'public/instagram/history.json');

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

/**
 * A failure this script knows how to describe.
 *
 * `fatal` separates the two kinds, and the distinction earns its keep inside
 * verifyCandidates: a session-level problem (expired cookie, checkpoint) makes
 * every request after it meaningless and has to abort the run, while a single
 * handle that won't resolve is just one candidate we can't confirm.
 */
class PullError extends Error {
  constructor(code, message, hint, fatal) {
    super(message);
    this.name = 'PullError';
    this.code = code;
    this.hint = hint;
    this.fatal = fatal;
  }
}

/**
 * Abort the run.
 *
 * Throws rather than calling process.exit, which can't be caught and so quietly
 * turned every try/catch around a request into dead code — one 400 on one
 * unrelated handle was enough to kill a finished 60-page pull before it wrote.
 * Reporting lives in the top-level handler instead, so a failure that something
 * recovers from doesn't announce itself.
 */
function die(code, message, hint) {
  throw new PullError(code, message, hint, true);
}

/** One request failed. Callers may reasonably continue without it. */
function requestFailed(message) {
  return new PullError(1, message, undefined, false);
}

// ===== Credentials =====

function loadSecrets() {
  if (!existsSync(SECRETS)) {
    die(
      2,
      'No credentials found.',
      `Run the setup script — it prompts for your cookie and writes ${SECRETS}:\n\n` +
        `      node scripts/instagram-setup.mjs\n\n` +
        `  It tells you where to find the cookie (instagram.com → DevTools → Network →\n` +
        `  any request to instagram.com → Request Headers → the whole "cookie:" value).`,
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

  const session = buildSession(raw);
  if (!session.sessionid) {
    die(
      2,
      'No sessionid in the secrets file.',
      'Re-run "node scripts/instagram-setup.mjs" and paste the full "cookie:" request header.',
    );
  }

  return { account, ...session };
}

// ===== HTTP =====

/** GET JSON with backoff on throttling, and clear failures on auth problems. */
async function getJson(url, creds, referer, attempt = 1) {
  let res;
  try {
    res = await fetch(url, { headers: igHeaders(creds, referer) });
  } catch (e) {
    if (attempt <= 3) {
      const wait = 15000 * attempt;
      log(`network error (${e.message}); retrying in ${wait / 1000}s`);
      await sleep(wait);
      return getJson(url, creds, referer, attempt + 1);
    }
    throw requestFailed(`Network error after ${attempt} attempts: ${e.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    // Phrased to read well both in a terminal and as a notification body.
    die(
      2,
      `Session cookie expired (HTTP ${res.status}) — re-paste it to resume tracking.`,
      'Log in to instagram.com in a browser, then run:\n\n' +
        '      node scripts/instagram-setup.mjs\n\n' +
        '  It takes a fresh "cookie:" request header and checks it before it finishes.\n' +
        '  Daily tracking is paused until then; the next hourly attempt picks it up.',
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
  // Scoped to this one URL, not the session: Instagram serves a 400 for profiles
  // whose own data it can't render (a stale business-category schema does it),
  // and that says nothing about the next request.
  if (!res.ok) throw requestFailed(`HTTP ${res.status} from ${url}`);

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
        '  a browser, clear any "suspicious login" prompt, then run\n' +
        '  "node scripts/instagram-setup.mjs" with a fresh cookie header.',
    );
  }
  if (json?.message === 'checkpoint_required' || json?.message === 'challenge_required') {
    die(
      2,
      'Instagram wants a security checkpoint cleared.',
      'Open instagram.com in a browser, confirm the prompt, then re-paste the cookie:\n' +
        '      node scripts/instagram-setup.mjs',
    );
  }
  return json;
}

// ===== Instagram reads =====

/** Numeric id + authoritative follower/following counts for the handle. */
async function fetchProfile(creds) {
  const json = await getJson(profileInfoUrl(creds.account), creds, profileReferer(creds.account));
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

/**
 * Follow/unfollow events from the difference between two readings of one list.
 *
 * `dir` says whose action it was: 'in' for the followers list (what was done to
 * you), 'out' for the following list (what you did). Only outbound events carry
 * the tag — an event without one is inbound, which is what everything recorded
 * before outbound tracking existed was.
 *
 * The following list is already fetched every run for the mutuals maths, so
 * tracking what *you* did costs nothing extra.
 */
export function diffList(current, previous, nowIso, dir) {
  const prevByKey = new Map((previous ?? []).map((p) => [p.username.toLowerCase(), p]));
  const curKeys = new Set(current.map((p) => p.username.toLowerCase()));
  const event = (p, kind) => ({
    username: p.username,
    kind,
    t: nowIso,
    name: p.name,
    ...(dir === 'out' ? { dir } : {}),
  });

  return {
    added: current
      .filter((p) => !prevByKey.has(p.username.toLowerCase()))
      .map((p) => event(p, 'follow')),
    removed: [...prevByKey.values()]
      .filter((p) => !curKeys.has(p.username.toLowerCase()))
      .map((p) => event(p, 'unfollow')),
  };
}

/**
 * Which live relationship field settles a candidate event, and what it must say.
 *
 * Inbound events are about whether *they* follow you (`follows_viewer`);
 * outbound about whether *you* follow them (`followed_by_viewer`).
 */
export function expectedRelationship(candidate) {
  return {
    field: candidate.dir === 'out' ? 'followed_by_viewer' : 'follows_viewer',
    want: candidate.kind === 'follow',
  };
}

/**
 * Does a candidate event survive contact with the live relationship?
 *
 * true  — confirmed, record it
 * false — contradicted, drop it
 * null  — couldn't tell; the caller drops it rather than guess
 *
 * `rel` is the live user object, or the string 'gone' when the account no
 * longer resolves — a deleted account can't still be following you, so an
 * unfollow stands while a follow obviously can't.
 */
export function verdict(candidate, rel) {
  if (rel === 'gone') return candidate.kind === 'unfollow';
  const { field, want } = expectedRelationship(candidate);
  const actual = rel?.[field];
  if (typeof actual !== 'boolean') return null;
  return actual === want;
}

/** Above this many candidates, verifying each one would be abusive. */
const MAX_VERIFY = 40;

/**
 * Confirm each candidate against Instagram before it becomes permanent history.
 *
 * Paging is the reason this exists. Instagram's followers/following endpoints
 * are eventually consistent: two runs minutes apart returned 865 following each
 * time, but not the *same* 865 — four accounts dropped out and four different
 * ones appeared. Diffing that churn invented four unfollows and four follows,
 * none of which had happened. Comparing totals can't catch it, because the
 * totals were identical.
 */
export async function verifyCandidates(candidates, creds, pause = () => sleep(jitter())) {
  if (candidates.length === 0) return { kept: [], dropped: [] };
  if (candidates.length > MAX_VERIFY) {
    log(`skipping verification: ${candidates.length} candidates exceeds the ${MAX_VERIFY} cap`);
    return { kept: candidates, dropped: [] };
  }

  const kept = [];
  const dropped = [];
  for (const c of candidates) {
    let rel;
    try {
      const json = await getJson(profileInfoUrl(c.username), creds, profileReferer(c.username));
      rel = json?.data?.user ?? 'gone';
    } catch (e) {
      // A dead session poisons every remaining verification, so it has to stop
      // the run — otherwise each candidate reads as "unverifiable" and a whole
      // day of real follows and unfollows gets silently discarded.
      if (e instanceof PullError && e.fatal) throw e;
      log(`could not verify @${c.username} (${e.message})`);
      rel = null;
    }
    const ok = verdict(c, rel);
    if (ok === true) kept.push(c);
    else dropped.push({ ...c, why: ok === false ? 'contradicted' : 'unverifiable' });
    await pause();
  }
  return { kept, dropped };
}

/**
 * The stored list changes only through confirmed events — never through a read
 * simply missing someone.
 *
 * Rebuilding the list from each read is what made paging churn self-sustaining:
 * a missed page deleted people, and their reappearance next run looked like a
 * brand-new follow. Verification alone can't catch that half of it, because
 * "do you follow them?" is true either way. Holding people until an unfollow is
 * actually confirmed breaks the cycle at the source.
 */
export function stableList(previous, currentRead, confirmedGone) {
  const byKey = new Map();
  for (const p of previous ?? []) byKey.set(p.username.toLowerCase(), p);
  for (const p of currentRead) {
    const k = p.username.toLowerCase();
    const old = byKey.get(k);
    // Fresh profile fields win; the earliest known date is kept.
    byKey.set(k, old ? { ...p, since: old.since ?? p.since } : p);
  }
  for (const k of confirmedGone) byKey.delete(k);
  return [...byKey.values()].sort((a, b) => a.username.localeCompare(b.username));
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

  const empty = { added: [], removed: [] };
  const inbound = firstRealRun ? empty : diffList(followers, prev.followers, nowIso, 'in');
  const outbound = firstRealRun ? empty : diffList(following, prev.following, nowIso, 'out');

  // Every candidate is checked against the live relationship before it becomes
  // permanent history — see verifyCandidates for why paging makes this necessary.
  const candidates = [...inbound.added, ...inbound.removed, ...outbound.added, ...outbound.removed];
  const { kept, dropped } = await verifyCandidates(candidates, creds);
  if (dropped.length) {
    log(`discarded ${dropped.length} unconfirmed change(s): ` +
      dropped.map((e) => `@${e.username} (${e.dir ?? 'in'} ${e.kind}, ${e.why})`).join(', '));
  }

  const events = [...kept, ...(firstRealRun ? [] : prev.events ?? [])]
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, 5000);

  // Only a confirmed unfollow removes anyone from the stored lists.
  const goneFrom = (dir) =>
    new Set(
      kept
        .filter((e) => (e.dir ?? 'in') === dir && e.kind === 'unfollow')
        .map((e) => e.username.toLowerCase()),
    );
  const nextFollowers = stableList(prev?.followers, mergedFollowers, goneFrom('in'));
  const nextFollowing = stableList(prev?.following, mergedFollowing, goneFrom('out'));

  const data = {
    account: creds.account,
    generatedAt: nowIso,
    sample: false,
    // Recorded on every write so the static page can say when the next attempt
    // is due. Re-read each time rather than remembered: a re-install at a
    // different hour then corrects itself, with nothing to keep in sync by hand.
    // Undefined (job not installed) is dropped by JSON.stringify.
    schedule: readInstalledSchedule() ?? undefined,
    // Snapshot the stored totals, not the raw read — the read fluctuates.
    snapshots: appendSnapshot(firstRealRun ? [] : prev.snapshots, {
      t: nowIso,
      followers: nextFollowers.length,
      following: nextFollowing.length,
    }),
    events,
    followers: nextFollowers,
    following: nextFollowing,
  };

  const confirmed = (dir, kind) =>
    kept.filter((e) => (e.dir ?? 'in') === dir && e.kind === kind);
  const mutuals = countMutuals(nextFollowers, nextFollowing);
  log(
    `followers ${nextFollowers.length} · following ${nextFollowing.length} · mutuals ${mutuals} · ` +
      `+${confirmed('in', 'follow').length} new · −${confirmed('in', 'unfollow').length} lost` +
      (dropped.length ? ` · ${dropped.length} unconfirmed, discarded` : ''),
  );
  for (const [label, list] of [
    ['new', confirmed('in', 'follow')],
    ['lost', confirmed('in', 'unfollow')],
    ['you followed', confirmed('out', 'follow')],
    ['you unfollowed', confirmed('out', 'unfollow')],
  ]) {
    if (list.length) log(`  ${label}: ${list.map((e) => '@' + e.username).join(', ')}`);
  }
  if (firstRealRun) log('first real run — recorded a baseline, diffs start tomorrow');

  if (DRY_RUN) {
    log('dry run: history.json not written');
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  log(`wrote ${OUT}`);

  if (COMMIT) commitAndPush(confirmed('in', 'follow').length, confirmed('in', 'unfollow').length);
}

export function countMutuals(followers, following) {
  const followingKeys = new Set(following.map((p) => p.username.toLowerCase()));
  return followers.filter((p) => followingKeys.has(p.username.toLowerCase())).length;
}

/**
 * Returns a human-readable reason if the read looks partial, else null.
 *
 * Note this compares *totals* only. A stable total does not mean a stable set —
 * paging can return the same number of different accounts — which is what
 * verifyCandidates exists to catch.
 */
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

/** The branch GitHub Pages deploys from. Publishing means landing a commit here. */
const PUBLISH_BRANCH = 'main';

/**
 * Should this run commit, given the branch the repo is sitting on?
 *
 * The job runs unattended against a working copy you also develop in, so it can
 * find itself on a feature branch — and committing there is worse than not
 * committing at all: the data lands somewhere that never deploys, `git push`
 * fails on a branch with no upstream, and the commit has to be picked out of
 * someone's feature history afterwards.
 */
export function publishDecision(branch, publishBranch = PUBLISH_BRANCH) {
  if (!branch || branch === 'HEAD') {
    return { publish: false, where: 'a detached HEAD' };
  }
  if (branch !== publishBranch) {
    return { publish: false, where: `branch ${branch}` };
  }
  return { publish: true, where: branch };
}

/**
 * Is this the push that failed because origin moved on?
 *
 * Worth distinguishing: a rejected push is fixed by rebasing and trying again,
 * while a credential or network failure is not, and retrying one as if it were
 * the other just fails twice as slowly.
 */
export function isPushRejection(message) {
  return /non-fast-forward|fetch first|rejected|behind its remote/i.test(String(message ?? ''));
}

function commitAndPush(gainedCount, lostCount) {
  const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  try {
    if (!git('status', '--porcelain', 'public/instagram/history.json')) {
      log('no change to commit');
      return;
    }

    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const decision = publishDecision(branch);
    if (!decision.publish) {
      // The data is written and safe; it just isn't published. Left uncommitted
      // on purpose so it's yours to place, rather than parked on your feature work.
      log(`on ${decision.where}, not ${PUBLISH_BRANCH} — history.json written but not committed`);
      console.error(
        `\n⚠ history.json was written but not published: the repo is on ${decision.where}.\n\n` +
          `  Publish it with:\n\n` +
          `      git stash && git checkout ${PUBLISH_BRANCH} && git stash pop\n` +
          `      git commit -m "Instagram tracker" -- public/instagram/history.json && git push\n`,
      );
      notifyOncePerDay(
        'branch',
        'Instagram Tracker',
        'Data saved, but not published',
        `The repo is on ${decision.where}, not ${PUBLISH_BRANCH}. The live site is behind.`,
      );
      process.exitCode = 1;
      return;
    }

    // Commit via an explicit pathspec rather than `add` + `commit`: this job runs
    // unattended, and the repo may well have unrelated staged work in the index
    // that must not get swept into an automated commit.
    git('commit', '-m', `Instagram tracker: +${gainedCount} / −${lostCount}`, '--',
      'public/instagram/history.json');

    try {
      git('push');
    } catch (e) {
      if (!isPushRejection(e.message)) throw e;
      // origin moved on while this clone sat behind — the single most common way
      // this job goes quiet, because the pull keeps succeeding and only the
      // publish fails. Rebase onto it and try once more. --autostash because the
      // working copy is also yours, and unrelated edits must not block the retry.
      log('push rejected (origin has moved on); rebasing and retrying once');
      git('pull', '--rebase', '--autostash', 'origin', PUBLISH_BRANCH);
      git('push');
    }
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
    if (e instanceof PullError) {
      console.error(`\n✗ ${e.message}`);
      if (e.hint) console.error(`\n  ${e.hint}\n`);
      // Exit 2 means "needs your attention" (expired cookie, bad config); 1 is
      // transient (throttled, network) and the next hourly attempt may well succeed.
      notifyOncePerDay(
        e.code === 2 ? 'action' : 'transient',
        'Instagram Tracker',
        e.code === 2 ? 'Action needed — tracking has stopped' : 'Run failed',
        e.message,
      );
      process.exit(e.code);
    }
    console.error('\n✗ Unexpected failure:', e);
    process.exit(1);
  });
}
