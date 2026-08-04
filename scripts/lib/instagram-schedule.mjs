// ===== Reading the installed launchd schedule =====
//
// The site is static: it can't ask the Mac when the next pull is due. So the
// pull records its own schedule into history.json each time it writes, and the
// app reads it back — which also means a re-install at a different hour fixes
// itself on the next successful run, with nothing to keep in sync by hand.
//
// The plist installed by scripts/instagram-schedule.sh is the source of truth,
// not a constant duplicated here: the install time is chosen at install time.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SCHEDULE_LABEL = 'com.fyrebolt.instagram-tracker';

/** Where scripts/instagram-schedule.sh installs the LaunchAgent. */
export function schedulePlistPath(home = homedir()) {
  return join(home, 'Library', 'LaunchAgents', `${SCHEDULE_LABEL}.plist`);
}

/**
 * The StartCalendarInterval entries out of a LaunchAgent plist.
 *
 * Deliberately a small regex reader rather than a plist parser: the only file
 * this is ever pointed at is the one instagram-schedule.sh writes, whose shape
 * is fixed two files away. A dependency to re-read our own output would be a
 * poor trade — and anything unexpected returns null, which the caller treats as
 * "no schedule known" rather than guessing.
 */
export function parsePlistSchedule(xml) {
  const array = /<key>StartCalendarInterval<\/key>\s*<array>([\s\S]*?)<\/array>/i.exec(
    String(xml ?? ''),
  );
  if (!array) return null;

  const hours = [];
  let minute = null;
  for (const [, body] of array[1].matchAll(/<dict>([\s\S]*?)<\/dict>/gi)) {
    const h = /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/i.exec(body);
    const m = /<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/i.exec(body);
    if (!h) continue;
    const hour = Number(h[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    hours.push(hour);
    // Every entry carries the same minute (the installer writes it that way);
    // the first one wins if that ever stops being true.
    if (minute === null && m) {
      const mm = Number(m[1]);
      if (Number.isInteger(mm) && mm >= 0 && mm <= 59) minute = mm;
    }
  }

  if (!hours.length) return null;
  return {
    hours: [...new Set(hours)].sort((a, b) => a - b),
    minute: minute ?? 0,
  };
}

/**
 * The schedule to record in history.json, or null if the job isn't installed.
 *
 * The time zone travels with it because the hours are wall-clock times on the
 * Mac that runs the job, and the phone reading the page may well be somewhere
 * else — without it, "next attempt 9:20" is a number with no meaning.
 */
export function readInstalledSchedule(
  path = schedulePlistPath(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  let xml;
  try {
    xml = readFileSync(path, 'utf8');
  } catch {
    return null; // not installed, or not readable — either way, nothing to say
  }
  const parsed = parsePlistSchedule(xml);
  if (!parsed) return null;
  return { ...parsed, timeZone, source: 'launchd' };
}
