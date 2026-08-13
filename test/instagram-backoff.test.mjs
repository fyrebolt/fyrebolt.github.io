// Tests for scripts/lib/instagram-backoff.mjs — what the unattended job does
// after Instagram says no.
//
// The behaviour under test is a restraint, so the cases that matter are the
// ones where it must *not* engage: a person at the keyboard, a git failure that
// had nothing to do with Instagram, and a record written before any of this
// existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENTION_MIN_MINUTES,
  BACKOFF_MINUTES,
  coolingOff,
  nextBackoff,
} from '../scripts/lib/instagram-backoff.mjs';

const NOW = new Date('2026-08-12T18:00:00Z');
const minutesBetween = (iso) => (new Date(iso).getTime() - NOW.getTime()) / 60_000;

test('the ladder lengthens with each failure in a row', () => {
  let prev = null;
  const waits = [];
  for (let i = 0; i < BACKOFF_MINUTES.length + 2; i++) {
    prev = nextBackoff(prev, 'failed', { now: NOW });
    waits.push(minutesBetween(prev.retryAfter));
  }
  assert.deepEqual(waits.slice(0, BACKOFF_MINUTES.length), BACKOFF_MINUTES);
  // Past the end of the ladder it holds at the longest rung rather than growing.
  const last = BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
  assert.deepEqual(waits.slice(BACKOFF_MINUTES.length), [last, last]);
});

test('one failure does not cost the next hourly firing', () => {
  // The case this is built from: 09:20 was refused, 10:20 succeeded on its own.
  // An hour-long first rung armed at 09:20:06 would land six seconds after the
  // 10:20 firing and silently push recovery to 11:20.
  const failedAt = new Date('2026-08-13T09:20:06-07:00');
  const { retryAfter } = nextBackoff(null, 'failed', { now: failedAt });
  assert.ok(new Date(retryAfter) < new Date('2026-08-13T10:20:00-07:00'));
});

test('a failure that needs a person waits at least the attention floor', () => {
  // A dead cookie does not heal in an hour: nothing changes until someone
  // re-pastes one, so an earlier attempt is a knock with no question behind it.
  const first = nextBackoff(null, 'failed', { code: 2, now: NOW });
  assert.equal(first.failures, 1);
  assert.equal(minutesBetween(first.retryAfter), ATTENTION_MIN_MINUTES);
});

test('a long ladder rung still wins over the attention floor', () => {
  const prev = { failures: 4 };
  const out = nextBackoff(prev, 'failed', { code: 2, now: NOW });
  assert.equal(minutesBetween(out.retryAfter), BACKOFF_MINUTES[4]);
});

test('success clears the hold', () => {
  assert.deepEqual(nextBackoff({ failures: 3, retryAfter: NOW.toISOString() }, 'ok', { now: NOW }), {
    failures: 0,
    retryAfter: null,
  });
});

test('a git failure does not back off Instagram', () => {
  // "unpublished" means the read worked and the commit didn't. Holding off
  // Instagram for that would punish the wrong end.
  const out = nextBackoff({ failures: 2 }, 'unpublished', { now: NOW });
  assert.deepEqual(out, { failures: 0, retryAfter: null });
});

test('a skip or a cancel carries the existing hold through untouched', () => {
  const prev = { failures: 2, retryAfter: '2026-08-12T20:00:00.000Z' };
  for (const outcome of ['skipped', 'cancelled']) {
    assert.deepEqual(nextBackoff(prev, outcome, { now: NOW }), {
      failures: 2,
      retryAfter: prev.retryAfter,
    });
  }
});

test('coolingOff reports a hold that is still in force', () => {
  const held = coolingOff(
    { retryAfter: '2026-08-12T21:00:00.000Z', failures: 2, reason: 'Instagram declined: “wait”' },
    NOW,
  );
  assert.equal(held.until.toISOString(), '2026-08-12T21:00:00.000Z');
  assert.equal(held.failures, 2);
  // The reason travels with it: "held until 9pm — Instagram asked us to wait"
  // is a useful line, and "held" on its own is not.
  assert.match(held.reason, /wait/);
});

test('coolingOff lets the job run once the hold expires', () => {
  assert.equal(coolingOff({ retryAfter: '2026-08-12T17:59:59.000Z' }, NOW), null);
  assert.equal(coolingOff({ retryAfter: NOW.toISOString() }, NOW), null);
});

test('a record with no hold in it never blocks a run', () => {
  // Includes the shape written before backoff existed: an older file must read
  // as "free to run", not as an unreadable hold that stops the job forever.
  for (const attempt of [null, undefined, {}, { outcome: 'failed' }, { retryAfter: 'never' }]) {
    assert.equal(coolingOff(attempt, NOW), null);
  }
});
