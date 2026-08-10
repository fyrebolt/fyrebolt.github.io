// Tests for the record every pull leaves behind — scripts/lib/instagram-attempt.mjs.
//
// Two things carry the weight here. One is trigger inference: a LaunchAgent
// installed months ago passes no --trigger, and the panel still has to say "the
// daily job" rather than blaming whoever last opened the page. The other is that
// this file is read by a long-running server at boot, so a hand-edited or
// half-written record has to come back as "nothing on file" and never as a throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attemptPath,
  normalizeAttempt,
  readAttempt,
  triggerFrom,
  writeAttempt,
} from '../scripts/lib/instagram-attempt.mjs';

const AT = '2026-08-10T16:20:00.000Z';
const ok = (extra = {}) => ({ at: AT, outcome: 'ok', ...extra });
const scratch = () => mkdtempSync(join(tmpdir(), 'ig-attempt-'));

// ===== Who asked for the run =====

test('an explicit --trigger wins', () => {
  assert.equal(triggerFrom(['--commit', '--trigger=scheduled']), 'scheduled');
  assert.equal(triggerFrom(['--trigger=manual', '--once-daily']), 'manual');
});

test('--once-daily means the daily job, with no flag to add', () => {
  // The installed plist passes exactly this and nothing else. Inferring from it
  // is what keeps an existing install reporting itself correctly.
  assert.equal(triggerFrom(['--commit', '--once-daily']), 'automatic');
});

test('a bare run is a manual one', () => {
  assert.equal(triggerFrom([]), 'manual');
  assert.equal(triggerFrom(['--dry-run']), 'manual');
});

test('a --trigger nobody recognises falls back rather than being believed', () => {
  assert.equal(triggerFrom(['--trigger=cron']), 'manual');
  assert.equal(triggerFrom(['--trigger=cron', '--once-daily']), 'automatic');
});

// ===== What counts as a record =====

test('a full record survives the round trip', () => {
  const record = normalizeAttempt({
    at: AT,
    finishedAt: '2026-08-10T16:24:00.000Z',
    trigger: 'automatic',
    outcome: 'failed',
    reason: 'Session cookie expired (HTTP 401)',
    hint: 'Re-paste it with instagram-setup.mjs',
    summary: null,
  });
  assert.deepEqual(record, {
    at: AT,
    finishedAt: '2026-08-10T16:24:00.000Z',
    trigger: 'automatic',
    outcome: 'failed',
    reason: 'Session cookie expired (HTTP 401)',
    hint: 'Re-paste it with instagram-setup.mjs',
    summary: null,
  });
});

test('an unfinished record is treated as finishing when it started', () => {
  assert.equal(normalizeAttempt(ok()).finishedAt, AT);
});

test('a record with no usable time or outcome is not a record', () => {
  for (const bad of [null, undefined, 'nope', 42, {}, { at: AT }, { outcome: 'ok' }]) {
    assert.equal(normalizeAttempt(bad), null, `expected ${JSON.stringify(bad)} to be refused`);
  }
  assert.equal(normalizeAttempt({ at: 'half past four', outcome: 'ok' }), null);
  assert.equal(normalizeAttempt({ at: AT, outcome: 'exploded' }), null);
});

test('an unknown trigger reads as manual rather than sinking the record', () => {
  // The outcome is the part worth keeping; who started it is a label.
  assert.equal(normalizeAttempt({ at: AT, outcome: 'ok', trigger: 'cron' }).trigger, 'manual');
});

test('blank text is dropped, and a runaway reason is capped', () => {
  const record = normalizeAttempt({ at: AT, outcome: 'failed', reason: '   ', hint: 'x'.repeat(900) });
  assert.equal(record.reason, null);
  assert.equal(record.hint.length, 400);
  assert.ok(record.hint.endsWith('…'));
});

// ===== On disk =====

test('a written record reads back as it was written', () => {
  const path = attemptPath(scratch());
  const written = writeAttempt(path, ok({ trigger: 'scheduled', summary: 'followers 812' }));
  assert.equal(written.outcome, 'ok');
  assert.deepEqual(readAttempt(path), written);
});

test('a later attempt replaces the one before it', () => {
  const path = attemptPath(scratch());
  writeAttempt(path, ok());
  writeAttempt(path, { at: '2026-08-10T17:20:00.000Z', outcome: 'failed', reason: 'throttled' });
  const back = readAttempt(path);
  assert.equal(back.outcome, 'failed');
  assert.equal(back.reason, 'throttled');
});

test('no file, or a file full of nonsense, is simply no attempt on record', () => {
  const dir = scratch();
  assert.equal(readAttempt(attemptPath(dir)), null);
  writeFileSync(attemptPath(dir), '{ this is not json');
  assert.equal(readAttempt(attemptPath(dir)), null);
  writeFileSync(attemptPath(dir), JSON.stringify({ at: AT, outcome: 'whatever' }));
  assert.equal(readAttempt(attemptPath(dir)), null);
});

test('a record that cannot be stored is dropped, not thrown', () => {
  // This runs on the way out of a pull that has already decided its exit code;
  // an unwritable file must not turn a good run into a crash.
  const dir = scratch();
  chmodSync(dir, 0o500);
  try {
    assert.equal(writeAttempt(attemptPath(dir), ok()), null);
  } finally {
    chmodSync(dir, 0o700);
  }
});

test('something that was never a record is refused before it reaches the disk', () => {
  const path = attemptPath(scratch());
  assert.equal(writeAttempt(path, { outcome: 'ok' }), null);
  assert.equal(readAttempt(path), null);
});
