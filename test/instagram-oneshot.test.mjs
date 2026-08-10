// Tests for the one-off "pull at this time" the app's Schedule… button arms —
// scripts/lib/instagram-oneshot.mjs.
//
// The interesting cases aren't the happy path: they're a time typed wrong, a
// slot the Mac slept through, and a stored file that a hand edit (or an older
// version of the agent) left in a shape the boot path has to survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRACE_MS,
  MAX_AHEAD_MS,
  isDue,
  isStale,
  normalize,
  parseRequested,
} from '../scripts/lib/instagram-oneshot.mjs';

const NOW = new Date('2026-08-09T21:00:00Z');
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();

test('accepts a time in the future', () => {
  const res = parseRequested(at(90 * 60_000), NOW);
  assert.equal(res.error, undefined);
  assert.equal(res.at.toISOString(), at(90 * 60_000));
});

test('rejects a time that has passed', () => {
  assert.match(parseRequested(at(-10 * 60_000), NOW).error, /already passed/);
});

test('tolerates a moment in the past, for clock skew between page and agent', () => {
  // The browser's "now" and the agent's are not the same clock; a request for
  // "right now" must not lose a race with the few ms it takes to arrive.
  assert.equal(parseRequested(at(-5_000), NOW).error, undefined);
});

test('rejects a time further out than the cap', () => {
  assert.equal(parseRequested(at(MAX_AHEAD_MS - 60_000), NOW).error, undefined);
  assert.match(parseRequested(at(MAX_AHEAD_MS + 60_000), NOW).error, /30 days/);
});

test('rejects things that are not times', () => {
  for (const bad of ['', '   ', 'tomorrow-ish', null, undefined, 42, {}]) {
    assert.ok(parseRequested(bad, NOW).error, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test('is due only once the moment arrives', () => {
  assert.equal(isDue({ at: at(60_000) }, NOW), false);
  assert.equal(isDue({ at: at(0) }, NOW), true);
  assert.equal(isDue({ at: at(-60_000) }, NOW), true);
});

test('a slot missed by less than the grace window still fires', () => {
  const missed = { at: at(-(GRACE_MS - 60_000)) };
  assert.equal(isDue(missed, NOW), true);
  assert.equal(isStale(missed, NOW), false);
});

test('a slot missed by more than the grace window is dropped, not run late', () => {
  // The Mac slept through the evening: waking up at 4am is not a reason to pull.
  const longGone = { at: at(-(GRACE_MS + 60_000)) };
  assert.equal(isStale(longGone, NOW), true);
});

test('normalize keeps a usable entry and canonicalises its time', () => {
  const entry = normalize({ at: '2026-08-09T21:30:00.000Z', createdAt: '2026-08-09T20:00:00.000Z' });
  assert.deepEqual(entry, {
    at: '2026-08-09T21:30:00.000Z',
    createdAt: '2026-08-09T20:00:00.000Z',
  });
});

test('normalize supplies a missing createdAt rather than dropping the entry', () => {
  const entry = normalize({ at: '2026-08-09T21:30:00.000Z' });
  assert.equal(entry.at, '2026-08-09T21:30:00.000Z');
  assert.ok(!Number.isNaN(new Date(entry.createdAt).getTime()));
});

test('normalize reads an unusable file as nothing armed', () => {
  for (const bad of [null, undefined, {}, { at: null }, { at: 'never' }, 'nope', []]) {
    assert.equal(normalize(bad), null, `expected ${JSON.stringify(bad)} to normalise to null`);
  }
});
