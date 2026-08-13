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
  ATTENTION_MIN_HOURS,
  BACKOFF_HOURS,
  coolingOff,
  nextBackoff,
} from '../scripts/lib/instagram-backoff.mjs';

const NOW = new Date('2026-08-12T18:00:00Z');
const hoursBetween = (iso) => (new Date(iso).getTime() - NOW.getTime()) / 3_600_000;

test('the ladder lengthens with each failure in a row', () => {
  let prev = null;
  const waits = [];
  for (let i = 0; i < BACKOFF_HOURS.length + 2; i++) {
    prev = nextBackoff(prev, 'failed', { now: NOW });
    waits.push(hoursBetween(prev.retryAfter));
  }
  assert.deepEqual(waits.slice(0, BACKOFF_HOURS.length), BACKOFF_HOURS);
  // Past the end of the ladder it holds at the longest rung rather than growing.
  const last = BACKOFF_HOURS[BACKOFF_HOURS.length - 1];
  assert.deepEqual(waits.slice(BACKOFF_HOURS.length), [last, last]);
});

test('a failure that needs a person waits at least the attention floor', () => {
  // A dead cookie does not heal in an hour: nothing changes until someone
  // re-pastes one, so an earlier attempt is a knock with no question behind it.
  const first = nextBackoff(null, 'failed', { code: 2, now: NOW });
  assert.equal(first.failures, 1);
  assert.equal(hoursBetween(first.retryAfter), ATTENTION_MIN_HOURS);
});

test('a long ladder rung still wins over the attention floor', () => {
  const prev = { failures: 4 };
  const out = nextBackoff(prev, 'failed', { code: 2, now: NOW });
  assert.equal(hoursBetween(out.retryAfter), BACKOFF_HOURS[4]);
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
