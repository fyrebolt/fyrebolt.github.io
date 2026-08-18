// Tests for src/game/warps.ts — the transform that sits between your hand and
// the cursor in Drift.
//
// This is the one part of the game that has to be exactly right rather than
// merely fun: the renderer draws the floor grid through `warpBasis`, so if the
// basis and the transform ever disagree the game shows you one lie while
// telling another, which is unplayable rather than hard. Everything else in the
// engine is verified by looking at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WARPS, WARP_BY_ID, transformDelta, warpBasis } from '../src/game/warps.ts';

const D = { x: 0.3, y: -0.2 };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const eq = (v, x, y, msg) => {
  close(v.x, x, `${msg} x`);
  close(v.y, y, `${msg} y`);
};

test('no active warps is the identity', () => {
  eq(transformDelta(D, new Set(), 1.234), D.x, D.y, 'identity');
});

test('mirror and flip negate one axis each', () => {
  eq(transformDelta(D, new Set(['mirror']), 0), -D.x, D.y, 'mirror');
  eq(transformDelta(D, new Set(['flip']), 0), D.x, -D.y, 'flip');
  eq(transformDelta(D, new Set(['mirror', 'flip']), 0), -D.x, -D.y, 'both = half turn');
});

test('swap exchanges the axes and is its own inverse', () => {
  const once = transformDelta(D, new Set(['swap']), 0);
  eq(once, D.y, D.x, 'swap');
  eq(transformDelta(once, new Set(['swap']), 0), D.x, D.y, 'swap twice');
});

test('spin rotates by the given angle without changing length', () => {
  const a = Math.PI / 2;
  const out = transformDelta(D, new Set(['spin']), a);
  eq(out, -D.y, D.x, 'quarter turn');
  close(Math.hypot(out.x, out.y), Math.hypot(D.x, D.y), 'length preserved');
});

test('twitch scales both axes equally, so only the gain changes', () => {
  const out = transformDelta(D, new Set(['zoom']), 0);
  close(out.x / D.x, out.y / D.y, 'uniform gain');
  assert.ok(out.x / D.x > 1, 'gain is above 1');
});

test('the force and integration warps leave the delta alone', () => {
  // Ice, Syrup, Tide and Wells act in the engine's integration step, not here.
  for (const id of ['ice', 'syrup', 'tide', 'wells']) {
    eq(transformDelta(D, new Set([id]), 1.1), D.x, D.y, id);
  }
});

test('warpBasis is the matrix transformDelta actually applies', () => {
  // The grid is drawn from the basis; if these drift apart the picture stops
  // describing the controls.
  const active = new Set(['spin', 'mirror', 'zoom']);
  const angle = 0.83;
  const { e1, e2 } = warpBasis(active, angle);
  const out = transformDelta(D, active, angle);
  eq(out, e1.x * D.x + e2.x * D.y, e1.y * D.x + e2.y * D.y, 'basis reproduces transform');
});

test('every warp exclusion names a real warp and is mutual', () => {
  for (const w of WARPS) {
    for (const other of w.excludes) {
      assert.ok(WARP_BY_ID[other], `${w.id} excludes unknown warp ${other}`);
      assert.ok(
        WARP_BY_ID[other].excludes.includes(w.id),
        `${other} does not exclude ${w.id} back`,
      );
    }
  }
});

test('the catalogue has no duplicate ids', () => {
  assert.equal(new Set(WARPS.map((w) => w.id)).size, WARPS.length);
});
