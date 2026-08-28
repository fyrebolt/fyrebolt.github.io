// Tests for src/video/project/timeMap.ts — the output→source time-warp.
//
// The warp is what the whole editor's clock runs on: overlays are authored in
// output time, the preview loop and the exporter both walk it, and every source
// frame is found through it. It is also the piece with a genuinely hard job —
// integrating a free-form speed curve, including freezes, into a monotonic
// mapping — and when it gets it wrong the symptom is not a wrong pixel, it is
// footage that no longer exists anywhere on the timeline.
//
// The headline here is one invariant: **a speed curve must never be able to
// swallow the clip.** Whatever curve is authored, every source second has to
// have some output time that shows it. A regression there loses work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { compileWarp } = await import('../src/video/project/timeMap.ts');
const { applySpeedRegion, REGION_HOLD, REGION_RAMP, FREEZE_RAMP, FREEZE_EPS } = await import(
  '../src/video/timemachine/types.ts'
);

const DUR = 30;
const CLIP = {
  id: 'c1', srcId: 's1', kind: 'video', name: 'rec.mp4',
  srcDuration: DUR, in: 0, out: DUR, w: 1920, h: 1080,
};
const project = (points) => ({
  clips: [CLIP],
  layers: points ? [{ id: 'tm1', kind: 'timemachine', z: 99, points }] : [],
});
const warpOf = (points) => compileWarp(project(points), DUR, true);
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

/** The property every warp must have, whatever curve produced it. */
function assertReachable(w, label) {
  assert.ok(w.totalOutput > 0, `${label}: the timeline collapsed to ${w.totalOutput}`);
  assert.ok(
    near(w.sourceAt(w.totalOutput), DUR, 0.1),
    `${label}: the last frame reachable is ${w.sourceAt(w.totalOutput).toFixed(2)}s of ${DUR}s — the rest of the footage is unreachable`,
  );
  // And the mapping has to be monotonic, or scrubbing goes backwards.
  let prev = -1;
  for (let t = 0; t <= w.totalOutput; t += w.totalOutput / 200) {
    const s = w.sourceAt(t);
    assert.ok(s >= prev - 1e-6, `${label}: source went backwards at output ${t.toFixed(2)}`);
    assert.ok(s <= DUR + 1e-6, `${label}: source ran past the clip at output ${t.toFixed(2)}`);
    prev = s;
  }
}

// ===== The identity =====

test('with no Time Machine the warp is the identity', () => {
  const w = warpOf(null);
  // Not strict equality: the integrator walks the clock in 1/240 steps, so an
  // exactly-30s timeline lands a float hair under 30.
  assert.ok(near(w.totalOutput, DUR), `identity length ${w.totalOutput}`);
  for (const t of [0, 1, 7.5, 15, 29.9]) assert.ok(near(w.sourceAt(t), t));
  assert.equal(w.frozen(0), false);
});

test('a Time Machine with an empty curve is also the identity', () => {
  const w = warpOf([]);
  assert.ok(near(w.totalOutput, DUR), `empty-curve length ${w.totalOutput}`);
  assert.ok(near(w.sourceAt(12), 12));
});

// ===== An ordinary freeze region still works =====

test('the "+ Freeze" preset holds the frame and gives the time back', () => {
  const pts = applySpeedRegion([], { start: 10, speed: 0, ramp: FREEZE_RAMP, hold: REGION_HOLD });
  const w = warpOf(pts);
  // The hold lengthens the output without consuming source.
  assert.ok(w.totalOutput > DUR, `a freeze should lengthen the output, got ${w.totalOutput}`);
  // Somewhere inside the region the clip is genuinely frozen.
  const mid = 10 + FREEZE_RAMP + REGION_HOLD / 2;
  assert.equal(w.frozen(mid), true, 'the middle of a freeze region must be frozen');
  // And it still plays out to the end.
  assertReachable(w, 'freeze region');
});

test('a slow-mo region stretches the output and still reaches the end', () => {
  const pts = applySpeedRegion([], { start: 5, speed: 0.4, ramp: REGION_RAMP, hold: REGION_HOLD });
  const w = warpOf(pts);
  assert.ok(w.totalOutput > DUR);
  assert.ok(w.speedAt(5 + REGION_RAMP + REGION_HOLD / 2) < 0.6, 'the region should be slow');
  assertReachable(w, 'slow-mo region');
});

// ===== Regressions: curves that used to truncate the timeline =====
//
// Each of these made part of the clip permanently unreachable. Because the
// preview loop restarts when it reaches the end, the visible symptom was a
// transport that appeared to freeze and replay the same fragment forever — the
// play button looking broken, and the footage looking lost.

test('a curve that ends frozen does not swallow the rest of the clip', () => {
  const w = warpOf([{ t: 0, speed: 1 }, { t: 5, speed: 0 }]);
  assertReachable(w, 'trailing freeze');
});

test('a curve that is 0 everywhere does not collapse the timeline', () => {
  const w = warpOf([{ t: 0, speed: 0 }, { t: 5, speed: 0 }]);
  assertReachable(w, 'all-zero curve');
});

test('a single 0-speed point does not collapse the timeline', () => {
  // One stray point, which is what a mis-drag leaves behind.
  const w = warpOf([{ t: 0, speed: 0 }]);
  assertReachable(w, 'single zero point');
});

test('a freeze at the very start still lets the clip play', () => {
  const w = warpOf([{ t: 0, speed: 0 }, { t: 0.5, speed: 0 }, { t: 30, speed: 0 }]);
  assertReachable(w, 'frozen from the start');
});

test('deleting the Time Machine restores the timeline exactly', () => {
  const broken = warpOf([{ t: 0, speed: 1 }, { t: 5, speed: 0 }]);
  const fixed = warpOf(null);
  assert.ok(near(fixed.totalOutput, DUR), 'removing the layer must give the full length back');
  assert.ok(broken.totalOutput > 0, 'and the broken one should not have been fatal either');
});

// ===== The invariant, over curves nobody thought to write down =====

test('no speed curve can make footage unreachable', () => {
  // A deterministic sweep of shapes: freezes, stalls, spikes, trailing zeros,
  // out-of-order points, duplicated times, and negative/absurd speeds.
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  for (let i = 0; i < 250; i++) {
    const n = 1 + Math.floor(rnd() * 6);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const t = rnd() * DUR * 1.2;
      // Weighted toward the awkward values: 0, tiny, huge, negative, NaN-ish.
      const r = rnd();
      const speed =
        r < 0.35 ? 0 : r < 0.45 ? FREEZE_EPS / 2 : r < 0.6 ? rnd() * 0.5 : r < 0.85 ? rnd() * 4 : -rnd() * 3;
      pts.push({ t, speed });
    }
    const w = warpOf(pts);
    assertReachable(w, `curve #${i}: ${JSON.stringify(pts.map((p) => [+p.t.toFixed(2), +p.speed.toFixed(2)]))}`);
  }
});

test('the warp stays finite even for a curve that asks it not to be', () => {
  const w = warpOf([{ t: 0, speed: 0.0001 }, { t: 1000, speed: 0.0001 }]);
  assert.ok(isFinite(w.totalOutput), 'total output must be finite');
  assert.ok(w.totalOutput > 0);
});
