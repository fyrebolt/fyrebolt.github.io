// ===== When the next pull is due =====
//
// The site is static and the job runs on a Mac it can't see, so history.json
// carries the schedule the pull read out of its own LaunchAgent (see
// scripts/lib/instagram-schedule.mjs). This turns that into "10:20 AM, in 21
// minutes".
//
// Everything here works in the *job's* time zone, not the viewer's. The hours
// are wall-clock times on that Mac; read on a phone three time zones away,
// "9:20" is otherwise a number with no meaning. That's why the arithmetic goes
// through Intl rather than Date's local-time getters.
//
// Plain JavaScript with no imports, like exportFormat.js: node:test exercises
// exactly the code the browser bundle ships. Types live in schedule.d.ts.

/** The wall clock in `timeZone` at a given instant. */
export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const out = {};
  for (const { type, value } of fmt.formatToParts(date)) {
    if (type in FIELD) out[FIELD[type]] = Number(value);
  }
  // h23 renders midnight as 24 in some ICU versions; normalise it to 0.
  if (out.hour === 24) out.hour = 0;
  return out;
}

const FIELD = {
  year: 'year',
  month: 'month',
  day: 'day',
  hour: 'hour',
  minute: 'minute',
};

/**
 * An unknown zone must not take the page down.
 *
 * The value comes from a JSON file that a stale or hand-edited copy can get
 * wrong, and Intl throws a RangeError on a name it doesn't know. Falling back
 * to the viewer's own zone shows a time that's plausible rather than a blank
 * panel.
 */
function safeZone(timeZone) {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The instant at which `timeZone`'s wall clock reads these parts.
 *
 * Two passes on purpose: the first guess uses the offset in force *now*, which
 * is the wrong one when the target falls on the far side of a DST change, and
 * the second re-reads the offset at the guessed instant to correct it.
 */
export function instantFrom({ year, month, day, hour, minute }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let ts = naive - offsetAt(new Date(naive), timeZone);
  ts = naive - offsetAt(new Date(ts), timeZone);
  return new Date(ts);
}

/** How far `timeZone`'s wall clock runs ahead of UTC at this instant, in ms. */
function offsetAt(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant.getTime();
}

/** Same calendar day, in whatever zone the parts were read in? */
function sameDay(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function addDays(parts, n) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The next time the job will actually try.
 *
 * The launchd job fires every hour, but the pull no-ops with --once-daily as
 * soon as a run has succeeded that day. So a day whose data is already in is
 * *finished*: the next real attempt is tomorrow's first slot, not the top of
 * the next hour. `satisfied` says which of those two answers this is, because
 * the difference is exactly what someone opening this panel wants to know.
 */
export function nextAttempt(schedule, generatedAt, now = new Date()) {
  if (!schedule || !Array.isArray(schedule.hours) || schedule.hours.length === 0) return null;

  const tz = schedule.timeZone;
  const minute = Number.isInteger(schedule.minute) ? schedule.minute : 0;
  const hours = [...schedule.hours].sort((a, b) => a - b);
  const nowParts = zonedParts(now, tz);

  const generated = generatedAt ? new Date(generatedAt) : null;
  const satisfied = Boolean(
    generated && !Number.isNaN(generated.getTime()) && sameDay(zonedParts(generated, tz), nowParts),
  );

  const slot = (dayParts, hour) => instantFrom({ ...dayParts, hour, minute }, tz);
  const tomorrow = () => slot(addDays(nowParts, 1), hours[0]);

  if (satisfied) return { at: tomorrow(), satisfied: true };

  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const remaining = hours.find((h) => h * 60 + minute > nowMinutes);
  return {
    at: remaining === undefined ? tomorrow() : slot(nowParts, remaining),
    satisfied: false,
  };
}

/** "10:20 AM", on the job's clock. */
export function formatClock(date, timeZone) {
  return new Intl.DateTimeFormat([], {
    timeZone: safeZone(timeZone),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** "today" / "tomorrow" / "Wed, Aug 6" — relative to the job's day, not the viewer's. */
export function formatDayLabel(date, now, timeZone) {
  const target = zonedParts(date, timeZone);
  const today = zonedParts(now, timeZone);
  if (sameDay(target, today)) return 'today';
  if (sameDay(target, addDaysParts(today, 1))) return 'tomorrow';
  return new Intl.DateTimeFormat([], {
    timeZone: safeZone(timeZone),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function addDaysParts(parts, n) {
  return { ...addDays(parts, n), hour: parts.hour, minute: parts.minute };
}

/** "in 21 minutes" — a plain countdown, in whatever units read best. */
export function formatRelative(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return 'due now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(ms / 86_400_000);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** "hourly, 9:20 AM – 11:20 PM" — the retry window the job was installed with. */
export function describeWindow(schedule, now = new Date()) {
  if (!schedule || !Array.isArray(schedule.hours) || schedule.hours.length === 0) return '';
  const hours = [...schedule.hours].sort((a, b) => a - b);
  const minute = Number.isInteger(schedule.minute) ? schedule.minute : 0;
  const parts = zonedParts(now, schedule.timeZone);
  const at = (h) => formatClock(instantFrom({ ...parts, hour: h, minute }, schedule.timeZone), schedule.timeZone);
  if (hours.length === 1) return `once a day at ${at(hours[0])}`;
  return `hourly, ${at(hours[0])} – ${at(hours[hours.length - 1])}`;
}

/**
 * "PDT", but only when it's worth saying.
 *
 * Returns '' when the viewer is already on the job's clock — the common case,
 * where a zone label is just noise.
 */
export function zoneAbbrev(date, timeZone) {
  const zone = safeZone(timeZone);
  if (!zone) return '';
  if (zone === Intl.DateTimeFormat().resolvedOptions().timeZone) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'short',
    hour: 'numeric',
  }).formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}
