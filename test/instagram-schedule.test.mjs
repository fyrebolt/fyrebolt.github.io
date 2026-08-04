// Tests for the two halves of "when is the next pull?":
//
//   scripts/lib/instagram-schedule.mjs — reading the installed LaunchAgent
//   src/instagram/schedule.js          — turning that into a time to show
//
// The arithmetic is all in the *job's* time zone, which is what makes it worth
// testing: every case below fixes a `now` in one zone and asserts the answer in
// another, because the phone reading the page need not be where the Mac is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlistSchedule } from '../scripts/lib/instagram-schedule.mjs';
import {
  describeWindow,
  formatClock,
  formatDayLabel,
  formatRelative,
  instantFrom,
  nextAttempt,
  zonedParts,
} from '../src/instagram/schedule.js';

const LA = 'America/Los_Angeles';

/** The plist scripts/instagram-schedule.sh writes for `install 09:20`. */
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.fyrebolt.instagram-tracker</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>23</integer><key>Minute</key><integer>20</integer></dict>
  </array>
  <key>RunAtLoad</key><false/>
</dict>
</plist>`;

test('parsePlistSchedule', async (t) => {
  await t.test('reads the hours and the minute out of a real plist', () => {
    assert.deepEqual(parsePlistSchedule(PLIST), { hours: [9, 10, 11, 23], minute: 20 });
  });

  await t.test('sorts and de-duplicates the hours', () => {
    const xml = `<key>StartCalendarInterval</key><array>
      <dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>5</integer></dict>
      <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>5</integer></dict>
      <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>5</integer></dict>
    </array>`;
    assert.deepEqual(parsePlistSchedule(xml), { hours: [9, 11], minute: 5 });
  });

  await t.test('returns null rather than guessing when there is nothing to read', () => {
    // The caller records "no schedule" and the UI says so — much better than a
    // confident wrong time.
    assert.equal(parsePlistSchedule(''), null);
    assert.equal(parsePlistSchedule('<plist><dict><key>Label</key></dict></plist>'), null);
    assert.equal(parsePlistSchedule(undefined), null);
  });

  await t.test('ignores entries outside a real clock', () => {
    const xml = `<key>StartCalendarInterval</key><array>
      <dict><key>Hour</key><integer>25</integer><key>Minute</key><integer>0</integer></dict>
      <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>20</integer></dict>
    </array>`;
    assert.deepEqual(parsePlistSchedule(xml), { hours: [9], minute: 20 });
  });

  await t.test('an entry with no Minute still counts, at :00', () => {
    const xml = `<key>StartCalendarInterval</key><array>
      <dict><key>Hour</key><integer>7</integer></dict>
    </array>`;
    assert.deepEqual(parsePlistSchedule(xml), { hours: [7], minute: 0 });
  });
});

test('zonedParts / instantFrom round-trip', async (t) => {
  await t.test('reads the wall clock in the named zone, not the runner’s', () => {
    // 2026-08-04T05:34Z is 22:34 the previous day in Los Angeles.
    const p = zonedParts(new Date('2026-08-04T05:34:00Z'), LA);
    assert.deepEqual(p, { year: 2026, month: 8, day: 3, hour: 22, minute: 34 });
  });

  await t.test('turns a wall clock back into the right instant', () => {
    const at = instantFrom({ year: 2026, month: 8, day: 4, hour: 9, minute: 20 }, LA);
    assert.equal(at.toISOString(), '2026-08-04T16:20:00.000Z'); // PDT, UTC-7
  });

  await t.test('gets a time on the far side of a DST change right', () => {
    // 2026-11-01 is the US fall-back: 9:20 local that morning is UTC-8, not -7.
    // A single-pass offset guess (the offset in force "now") lands an hour out.
    const at = instantFrom({ year: 2026, month: 11, day: 2, hour: 9, minute: 20 }, LA);
    assert.equal(at.toISOString(), '2026-11-02T17:20:00.000Z');
  });

  await t.test('falls back to local time for a zone Intl does not know', () => {
    // The value comes out of a JSON file; a bad one must not throw.
    const p = zonedParts(new Date('2026-08-04T05:34:00Z'), 'Mars/Olympus_Mons');
    assert.equal(typeof p.hour, 'number');
  });
});

test('nextAttempt', async (t) => {
  const schedule = { hours: [9, 10, 11, 12, 23], minute: 20, timeZone: LA };

  await t.test('today’s pull is not in yet: the next slot today', () => {
    // 09:55 in LA, nothing collected today → 10:20 today.
    const now = new Date('2026-08-04T16:55:00Z');
    const got = nextAttempt(schedule, '2026-08-03T05:34:00Z', now);
    assert.equal(got.satisfied, false);
    assert.equal(got.at.toISOString(), '2026-08-04T17:20:00.000Z');
    assert.equal(formatClock(got.at, LA), '10:20 AM');
    assert.equal(formatRelative(got.at, now), 'in 25 minutes');
  });

  await t.test('today’s pull is in: tomorrow’s first slot, not the next hour', () => {
    // This is the whole point of --once-daily. The job still fires at 11:20,
    // but it no-ops, so reporting it as "the next update" would be a lie.
    const now = new Date('2026-08-04T17:55:00Z'); // 10:55 LA
    const got = nextAttempt(schedule, '2026-08-04T16:21:00Z', now); // collected 09:21 LA today
    assert.equal(got.satisfied, true);
    assert.equal(got.at.toISOString(), '2026-08-05T16:20:00.000Z'); // 09:20 LA tomorrow
    assert.equal(formatDayLabel(got.at, now, LA), 'tomorrow');
  });

  await t.test('after the last slot of the day, it rolls to tomorrow', () => {
    const now = new Date('2026-08-05T07:00:00Z'); // 00:00 LA, past 23:20
    const got = nextAttempt(schedule, '2026-08-03T05:34:00Z', now);
    assert.equal(got.satisfied, false);
    assert.equal(got.at.toISOString(), '2026-08-05T16:20:00.000Z'); // 09:20 LA today (the 5th)
  });

  await t.test('the day that counts is the job’s, not the viewer’s', () => {
    // 2026-08-05T04:00Z is the 5th in UTC but still 21:00 on the 4th in LA, and
    // the pull ran at 09:21 LA on the 4th. A viewer in London must still be told
    // "tomorrow", because the job considers today done.
    const now = new Date('2026-08-05T04:00:00Z');
    const got = nextAttempt(schedule, '2026-08-04T16:21:00Z', now);
    assert.equal(got.satisfied, true);
    assert.equal(got.at.toISOString(), '2026-08-05T16:20:00.000Z');
  });

  await t.test('exactly on a slot, the answer is the next one', () => {
    const now = new Date('2026-08-04T17:20:00Z'); // 10:20:00 LA on the nose
    const got = nextAttempt(schedule, '2026-08-03T05:34:00Z', now);
    assert.equal(got.at.toISOString(), '2026-08-04T18:20:00.000Z');
  });

  await t.test('no schedule on file yields null, not a made-up time', () => {
    assert.equal(nextAttempt(undefined, '2026-08-04T16:21:00Z', new Date()), null);
    assert.equal(nextAttempt({ hours: [] }, '2026-08-04T16:21:00Z', new Date()), null);
  });

  await t.test('a missing generatedAt just means "not collected today"', () => {
    const now = new Date('2026-08-04T16:55:00Z');
    const got = nextAttempt(schedule, undefined, now);
    assert.equal(got.satisfied, false);
    assert.equal(got.at.toISOString(), '2026-08-04T17:20:00.000Z');
  });
});

test('formatRelative', async (t) => {
  const base = new Date('2026-08-04T16:00:00Z');
  const at = (ms) => new Date(base.getTime() + ms);

  await t.test('counts in whatever unit reads best', () => {
    assert.equal(formatRelative(at(60_000), base), 'in 1 minute');
    assert.equal(formatRelative(at(25 * 60_000), base), 'in 25 minutes');
    assert.equal(formatRelative(at(3 * 3_600_000), base), 'in about 3 hours');
    assert.equal(formatRelative(at(26 * 3_600_000), base), 'in 1 day');
  });

  await t.test('a slot that has come and gone reads as due', () => {
    assert.equal(formatRelative(at(-5000), base), 'due now');
  });
});

test('describeWindow', async (t) => {
  const now = new Date('2026-08-04T16:00:00Z');

  await t.test('states the retry window', () => {
    const text = describeWindow({ hours: [9, 10, 11, 23], minute: 20, timeZone: LA }, now);
    assert.equal(text, 'hourly, 9:20 AM – 11:20 PM');
  });

  await t.test('a single slot is not a window', () => {
    const text = describeWindow({ hours: [9], minute: 20, timeZone: LA }, now);
    assert.equal(text, 'once a day at 9:20 AM');
  });

  await t.test('says nothing when there is nothing to say', () => {
    assert.equal(describeWindow(undefined, now), '');
  });
});
