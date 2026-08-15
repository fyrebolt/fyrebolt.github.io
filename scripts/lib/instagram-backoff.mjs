// ===== Backing off after a refusal =====
//
// The daily job is installed to fire every hour and stop as soon as one run
// succeeds. That is the right shape for a Mac that might be asleep at 9:20 —
// and the wrong shape entirely once Instagram has said no, because then the
// retries aren't catching a missed slot, they're knocking fifteen times on a
// door that has just been shut. A day of that reads as automation from the
// other side, which is exactly the reading to avoid.
//
// So a failure arms a cooling-off period, and the unattended job honours it.
// The ladder is deliberately short at the start — one bad hour is usually
// nothing — and long by the end, because a fourth consecutive failure means
// something is broken that more attempts won't fix.
//
// A person is never held: pressing "Update now" or arming a one-off runs
// immediately. This governs the job that runs while nobody is watching.

/**
 * Wait after the 1st, 2nd, 3rd… consecutive failure. The last value repeats.
 *
 * The first rung is 45 minutes rather than an hour on purpose, and the schedule
 * is why: the job fires hourly, so an hour's wait armed at 09:20:06 lands six
 * seconds after the 10:20 firing and silently costs an hour. A real refusal
 * looked exactly like this — 09:20 failed, 10:20 succeeded — and a first
 * failure that lets the next firing through is the behaviour that keeps. The
 * backoff proper starts at the second one, which is when it's actually earned.
 */
export const BACKOFF_MINUTES = [45, 3 * 60, 6 * 60, 12 * 60, 24 * 60];

/**
 * The floor for a failure that needs a person (exit code 2 — expired cookie,
 * checkpoint). Retrying sooner cannot help: nothing changes until someone
 * re-pastes a cookie or clears a prompt, so an early attempt is a knock with
 * no question behind it.
 */
export const ATTENTION_MIN_MINUTES = 6 * 60;

const MINUTE_MS = 60 * 1000;

/**
 * The failure count and cooling-off time to store after an attempt ends.
 *
 * `unpublished` counts as a success here on purpose: the read worked and
 * Instagram was fine, and the thing that broke was git. Backing off Instagram
 * for a git problem would punish the wrong end. `skipped` and `cancelled` carry
 * the previous state through untouched — neither is evidence either way.
 */
export function nextBackoff(prev, outcome, { code = 1, now = new Date() } = {}) {
  const failures = Number.isInteger(prev?.failures) && prev.failures > 0 ? prev.failures : 0;

  if (outcome === 'ok' || outcome === 'unpublished') return { failures: 0, retryAfter: null };
  if (outcome !== 'failed') return { failures, retryAfter: prev?.retryAfter ?? null };

  const next = failures + 1;
  const rung = BACKOFF_MINUTES[Math.min(next, BACKOFF_MINUTES.length) - 1];
  const minutes = Math.max(rung, code === 2 ? ATTENTION_MIN_MINUTES : 0);
  return {
    failures: next,
    retryAfter: new Date(now.getTime() + minutes * MINUTE_MS).toISOString(),
  };
}

/**
 * Is the unattended job being held back right now?
 *
 * Returns what to say about it, or null when it's free to run. The last
 * failure's reason comes along because that's what makes the hold legible: the
 * useful line is "held until 4:20 PM — Instagram asked us to wait", not "held".
 */
export function coolingOff(attempt, now = new Date()) {
  const until = attempt?.retryAfter ? new Date(attempt.retryAfter) : null;
  if (!until || Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return null;
  return {
    until,
    failures: Number.isInteger(attempt.failures) ? attempt.failures : 1,
    reason: typeof attempt.reason === 'string' ? attempt.reason : null,
  };
}
