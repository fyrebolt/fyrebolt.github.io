// ===== One-off "pull at this time" =====
//
// The daily LaunchAgent covers the routine case; this covers the other one —
// "grab it right after the post goes up tonight". The agent (scripts/
// instagram-agent.mjs) keeps at most one of these armed at a time and fires the
// same pull the "Update now" button does.
//
// The decisions live here, away from the HTTP plumbing, because they're the
// part with edge cases worth testing: a time typed into a box may be nonsense,
// may be in the past, may be a year out — and a Mac that slept through the
// chosen minute has to decide whether firing late is still what was meant.

/** No point arming something a month out; the daily job has run 30 times by then. */
export const MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How late a missed run may still fire.
 *
 * The agent is a long-running listener, but the Mac it lives on sleeps, and
 * launchd restarts the process at login. Either can carry the clock past the
 * chosen minute. Firing a little late is what you wanted; firing at 4am because
 * the lid was shut at 11pm is not, so a run that missed its slot by more than
 * this is dropped rather than run.
 */
export const GRACE_MS = 6 * 60 * 60 * 1000;

/** Clock skew between the browser's idea of "now" and the agent's. */
const PAST_SLACK_MS = 60 * 1000;

/**
 * Validate a requested time.
 *
 * Returns `{ at: Date }` or `{ error }` — the error text is shown verbatim in
 * the page, so it's written for the person who typed the time.
 */
export function parseRequested(value, now = new Date()) {
  if (typeof value !== 'string' || !value.trim()) return { error: 'no time given' };
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return { error: 'that is not a time I can read' };
  const delta = at.getTime() - now.getTime();
  if (delta < -PAST_SLACK_MS) return { error: 'that time has already passed' };
  if (delta > MAX_AHEAD_MS) return { error: 'that is more than 30 days out' };
  return { at };
}

/** Has this entry's moment arrived? */
export function isDue(entry, now = new Date()) {
  const at = entryTime(entry);
  return at !== null && at <= now.getTime();
}

/** Did it miss its slot by more than the grace window? */
export function isStale(entry, now = new Date()) {
  const at = entryTime(entry);
  return at !== null && now.getTime() - at > GRACE_MS;
}

/**
 * A stored entry, or null if the file held something unusable.
 *
 * The file is hand-editable and survives upgrades, so anything that isn't a
 * plain `{ at }` with a real date is treated as "nothing armed" rather than
 * being allowed to crash the agent on boot.
 */
export function normalize(entry) {
  const at = entryTime(entry);
  if (at === null) return null;
  return {
    at: new Date(at).toISOString(),
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
  };
}

function entryTime(entry) {
  if (!entry || typeof entry.at !== 'string') return null;
  const ms = new Date(entry.at).getTime();
  return Number.isNaN(ms) ? null : ms;
}
