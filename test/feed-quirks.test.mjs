// Tests for src/feed/quirks.ts — the transform that sits between the wheel
// under your hand and the feed on screen in Doomscroll.
//
// This is the one part of the game that has to be exactly right rather than
// merely fun: the renderer draws the scrollbar rail through `scrollGain`, so if
// the gain and the transform ever disagree the rail promises one thing while
// the controls do another, which is unplayable rather than hard. Everything
// else in the engine is verified by looking at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUIRKS, QUIRK_BY_ID, STICKY_STEP, transformScroll, scrollGain } from '../src/feed/quirks.ts';

const D = 0.3;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('no active quirks is the identity', () => {
  close(transformScroll(D, new Set()), D, 'identity');
  close(transformScroll(-D, new Set()), -D, 'identity, upwards');
});

test('invert negates the scroll and is its own inverse', () => {
  const once = transformScroll(D, new Set(['invert']));
  close(once, -D, 'invert');
  close(transformScroll(once, new Set(['invert'])), D, 'invert twice');
});

test('firehose scales without changing direction', () => {
  const out = transformScroll(D, new Set(['firehose']));
  assert.ok(out / D > 1, 'gain is above 1');
  close(transformScroll(-D, new Set(['firehose'])) / -D, out / D, 'same gain both ways');
});

test('sticky swallows everything under its threshold and nothing over it', () => {
  const active = new Set(['sticky']);
  close(transformScroll(STICKY_STEP * 0.99, active), 0, 'just under');
  close(transformScroll(-STICKY_STEP * 0.99, active), 0, 'just under, upwards');
  close(transformScroll(STICKY_STEP * 1.01, active), STICKY_STEP * 1.01, 'just over');
});

test('sticky is judged before invert, so the dead band is what your hand did', () => {
  // If the order flipped, an inverted scroll would still pass the threshold
  // test — same magnitude — so this is really a guard on the *documented*
  // order surviving a refactor rather than on the arithmetic.
  const active = new Set(['sticky', 'invert']);
  close(transformScroll(STICKY_STEP * 0.5, active), 0, 'small scroll still dies');
  close(transformScroll(STICKY_STEP * 2, active), -STICKY_STEP * 2, 'large scroll inverts');
});

test('the integration and force quirks leave the distance alone', () => {
  // Slick, Molasses, Snap, Autoplay and Rubberband act in the engine's
  // integration step, not here.
  for (const id of ['slick', 'molasses', 'snap', 'autoplay', 'rubberband']) {
    close(transformScroll(D, new Set([id])), D, id);
  }
});

test('scrollGain is the gain transformScroll actually applies', () => {
  // The rail is drawn from the gain; if these drift apart the picture stops
  // describing the controls.
  for (const active of [
    new Set(),
    new Set(['invert']),
    new Set(['firehose']),
    new Set(['invert', 'firehose']),
    new Set(['sticky', 'invert', 'firehose']),
  ]) {
    const gain = scrollGain(active);
    for (const d of [0.2, 0.5, 1, -0.2, -0.75]) {
      // Only outside the dead band: inside it the map is deliberately not linear.
      if (Math.abs(d) < STICKY_STEP) continue;
      close(transformScroll(d, active), d * gain, `gain at ${d} with ${[...active]}`);
    }
  }
});

test('the catalogue is well formed', () => {
  const ids = new Set();
  for (const q of QUIRKS) {
    assert.ok(!ids.has(q.id), `duplicate quirk id ${q.id}`);
    ids.add(q.id);
    assert.match(q.color, /^#[0-9a-f]{6}$/i, `${q.id} needs a hex colour like the rest`);
    assert.ok(q.name && q.hint, `${q.id} needs a name and a hint for the banner`);
    assert.ok(
      ['transform', 'integration', 'force'].includes(q.kind),
      `${q.id} has an unknown kind`,
    );
    assert.equal(QUIRK_BY_ID[q.id], q, `${q.id} is missing from the lookup`);
  }
});

test('exclusions are mutual', () => {
  // The scheduler checks both directions, but only because they agree; a
  // one-sided exclusion would let the pair through depending on arrival order.
  for (const q of QUIRKS) {
    for (const other of q.excludes) {
      assert.ok(QUIRK_BY_ID[other], `${q.id} excludes unknown quirk ${other}`);
      assert.ok(
        QUIRK_BY_ID[other].excludes.includes(q.id),
        `${other} must exclude ${q.id} back`,
      );
    }
  }
});
