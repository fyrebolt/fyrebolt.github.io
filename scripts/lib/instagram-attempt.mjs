// ===== The last pull attempt =====
//
// history.json records the last pull that *worked*. That is the wrong file to
// ask "is this thing still running?", because the interesting failures are
// exactly the ones that leave it untouched: an expired cookie writes nothing,
// so the site keeps showing yesterday's good data with no hint that four
// attempts have died since.
//
// So every attempt — the hourly job, the one-off, the button, and a run started
// by hand in a terminal — drops a record here as it ends, whether it succeeded
// or not. The agent serves it back to the page (GET /attempt), which is the only
// route it could take: a static site can't learn about a failure that never
// produced a commit.
//
// Local to this Mac and gitignored. The reasons are written for a person, and
// some of them quote Instagram's own responses.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Who asked for the run. */
export const TRIGGERS = ['automatic', 'scheduled', 'manual'];

/**
 * How it ended.
 *
 *   ok           — pulled and written (and published, if it was asked to)
 *   skipped      — an hourly firing that found today's pull already in
 *   failed       — nothing was written; `reason` says why
 *   unpublished  — pulled and written, but the commit or push failed
 *   cancelled    — stopped from the page while it was running
 */
export const OUTCOMES = ['ok', 'skipped', 'failed', 'unpublished', 'cancelled'];

/**
 * Which trigger a set of command-line arguments implies.
 *
 * `--trigger=` is explicit and wins; the agent passes it, because only the agent
 * knows whether a run came from the button or from an armed one-off. Everything
 * else is inferred from `--once-daily`, which is the flag the LaunchAgent is
 * installed with — inferring rather than requiring a new flag means a job
 * installed before any of this existed still reports itself correctly, with no
 * re-install.
 */
export function triggerFrom(argv = []) {
  for (const arg of argv) {
    const m = /^--trigger=(.+)$/.exec(String(arg));
    if (m && TRIGGERS.includes(m[1])) return m[1];
  }
  return argv.includes('--once-daily') ? 'automatic' : 'manual';
}

/**
 * A record ready to store, or null if it isn't one.
 *
 * Applied on the way in *and* on the way out: the file is hand-editable, it
 * survives upgrades, and it is read by a long-running server on boot. Anything
 * unrecognisable is "no attempt on file", never a crash.
 */
export function normalizeAttempt(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const at = time(entry.at);
  if (!at) return null;
  const outcome = OUTCOMES.includes(entry.outcome) ? entry.outcome : null;
  if (!outcome) return null;
  return {
    at,
    finishedAt: time(entry.finishedAt) ?? at,
    trigger: TRIGGERS.includes(entry.trigger) ? entry.trigger : 'manual',
    outcome,
    reason: text(entry.reason),
    hint: text(entry.hint),
    summary: text(entry.summary),
    // How many failures in a row, and how long the unattended job is holding off
    // as a result — see lib/instagram-backoff.mjs. Both are absent on a healthy
    // record rather than zero/null, so an older file reads as "not holding off".
    ...(Number.isInteger(entry.failures) && entry.failures > 0
      ? { failures: entry.failures }
      : {}),
    ...(time(entry.retryAfter) ? { retryAfter: time(entry.retryAfter) } : {}),
  };
}

function time(value) {
  if (typeof value !== 'string') return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** A trimmed string, or null. Long hints are capped so the panel stays readable. */
function text(value, limit = 400) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? trimmed.slice(0, limit - 1) + '…' : trimmed;
}

/** Where the record lives. One file, holding only the most recent attempt. */
export function attemptPath(scriptsDir) {
  return join(scriptsDir, '.instagram-attempt.json');
}

/** The stored attempt, or null when there is none (or it was unreadable). */
export function readAttempt(path) {
  try {
    return normalizeAttempt(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Store an attempt. Returns what was written, or null if it was rejected.
 *
 * Never throws: this is bookkeeping that runs on the way out of a run which has
 * already decided its own exit code, and losing the record must not turn a
 * successful pull into a failed one.
 */
export function writeAttempt(path, entry) {
  const record = normalizeAttempt(entry);
  if (!record) return null;
  try {
    writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
    return record;
  } catch {
    return null;
  }
}
