// Tests for src/game/tutorial.ts — the guided run-through of every warp.
//
// The lesson catalogue is data, and the one way it can rot is silently: someone
// adds a warp to WARPS, the scheduler starts throwing it at players, and the
// tutorial never mentions it. That is exactly the failure a test can catch and
// a playthrough can't, because the tutorial would still look complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS } from '../src/game/tutorial.ts';
import { WARPS, WARP_BY_ID } from '../src/game/warps.ts';

const taught = LESSONS.map((l) => l.warp).filter((w) => w !== null);

test('every warp in the catalogue is taught exactly once', () => {
  for (const w of WARPS) {
    const times = taught.filter((id) => id === w.id).length;
    assert.equal(times, 1, `${w.id} is taught ${times} times — see src/game/tutorial.ts`);
  }
  assert.equal(taught.length, WARPS.length, 'a lesson names a warp that is not in the catalogue');
});

test('every taught id is a real warp', () => {
  for (const id of taught) assert.ok(WARP_BY_ID[id], `unknown warp ${id}`);
});

test('the run-through opens on the plain controls', () => {
  // Meeting a warp before you have moved the honest cursor once teaches you
  // nothing: you have no baseline to notice the lie against.
  assert.equal(LESSONS[0].warp, null, 'the first lesson must have no warp');
});

test('lessons about the plain game carry their own card copy', () => {
  for (const l of LESSONS) {
    if (l.warp !== null) continue;
    for (const field of ['title', 'hint', 'color']) {
      assert.ok(l[field], `a warp-less lesson is missing ${field}`);
    }
    assert.match(l.color, /^#[0-9a-f]{6}$/i, 'colour must be a hex literal like the warp catalogue');
  }
});

test('every lesson says what to do about it', () => {
  for (const l of LESSONS) {
    const label = l.warp ?? l.title;
    assert.ok(l.body && l.body.length > 40, `${label} has no real teaching line`);
  }
});
