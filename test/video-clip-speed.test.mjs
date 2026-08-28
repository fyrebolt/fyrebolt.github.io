// Tests for per-clip speed in src/video/project/clips.ts.
//
// The editor's base clock is stitched from clips, and speed is the mapping from
// a clip's slice of that clock onto its own source. It sits BELOW the base
// clock, where the Time Machine layer sits above it, so the two compose without
// either knowing about the other.
//
// Two things make this worth testing rather than eyeballing in the preview.
// First, every existing project must lay out bit-for-bit as before — a clip
// with no `speed` has to be indistinguishable from one at 1×, and a regression
// there silently re-times footage somebody already cut. Second, the arithmetic
// runs in two directions (how long does this clip become; which source second
// is showing) and they have to agree, or the picture and the timeline disagree
// about where you are.
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

const {
  MIN_CLIP_LEN,
  SPEED_MIN,
  SPEED_MAX,
  DEFAULT_HOLD,
  HOLD_MAX,
  clampSpeed,
  clampHold,
  clipSpeed,
  clipHold,
  clipLen,
  clipSourceSpan,
  clipSourceAt,
  isFrozen,
  layoutClips,
  baseDuration,
  resolveBase,
  activeClipsAt,
  splitClip,
} = await import('../src/video/project/clips.ts');

/** A plain video clip: 10s of source, used whole. */
const clip = (over = {}) => ({
  id: 'c1',
  srcId: 's1',
  kind: 'video',
  name: 'a.mp4',
  srcDuration: 10,
  in: 0,
  out: 10,
  w: 1920,
  h: 1080,
  ...over,
});

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ===== Nothing changes for a clip nobody has re-timed =====

test('a clip with no speed is exactly what it always was', () => {
  const c = clip({ in: 2, out: 7 });
  assert.equal(clipSpeed(c), 1);
  assert.equal(isFrozen(c), false);
  // The old definition of clipLen, verbatim.
  assert.equal(clipLen(c), c.out - c.in);
  // The old resolver, verbatim: sourceT = in + local.
  for (const local of [0, 0.5, 2.5, 5]) {
    assert.ok(near(clipSourceAt(c, local), c.in + local), `local ${local}`);
  }
});

test('an explicit 1x is indistinguishable from no speed at all', () => {
  const a = clip();
  const b = clip({ speed: 1 });
  assert.equal(clipLen(a), clipLen(b));
  assert.equal(clipSourceAt(a, 3), clipSourceAt(b, 3));
});

// ===== Rate =====

test('doubling the rate halves the time the clip takes', () => {
  const c = clip({ speed: 2 });
  assert.equal(clipSourceSpan(c), 10, 'the source it uses is unchanged');
  assert.equal(clipLen(c), 5, 'but it occupies half the timeline');
});

test('halving the rate doubles it', () => {
  assert.equal(clipLen(clip({ speed: 0.5 })), 20);
});

test('source advances at the rate, and the two directions agree', () => {
  for (const speed of [0.25, 0.5, 1, 2, 4]) {
    const c = clip({ in: 1, out: 9, speed });
    const len = clipLen(c);
    assert.ok(near(len, 8 / speed), `length at ${speed}x`);
    // Start of the slot shows the in-point; the end shows the out-point.
    assert.ok(near(clipSourceAt(c, 0), 1), `start at ${speed}x`);
    assert.ok(near(clipSourceAt(c, len), 9), `end at ${speed}x`);
    // And the middle is the middle.
    assert.ok(near(clipSourceAt(c, len / 2), 5), `middle at ${speed}x`);
  }
});

test('the source position never runs past the clip out-point', () => {
  const c = clip({ in: 1, out: 4, speed: 4 });
  for (const local of [0, 1, 5, 50, 1e6]) {
    const t = clipSourceAt(c, local);
    assert.ok(t >= c.in - 1e-9 && t <= c.out + 1e-9, `local ${local} -> ${t}`);
  }
});

test('a rate outside the editable range is clamped, not obeyed', () => {
  assert.equal(clampSpeed(99), SPEED_MAX);
  assert.equal(clampSpeed(0.0001), SPEED_MIN);
  assert.equal(clampSpeed(NaN), 0, 'nonsense reads as a freeze rather than a crash');
  assert.equal(clampSpeed(-3), 0, 'so does a negative rate');
  assert.equal(clipSpeed(clip({ speed: 1000 })), SPEED_MAX);
});

// ===== Freeze =====

test('speed 0 is a freeze: one frame, held for the stated time', () => {
  const c = clip({ in: 3, out: 8, speed: 0, hold: 2 });
  assert.equal(isFrozen(c), true);
  assert.equal(clipLen(c), 2, 'the hold is the length — the source span is irrelevant');
  for (const local of [0, 0.4, 1, 1.999, 2, 99]) {
    assert.equal(clipSourceAt(c, local), 3, `every instant shows the in-point (local ${local})`);
  }
});

test('a freeze holds for a sensible time before anyone sets one', () => {
  const c = clip({ speed: 0 });
  assert.equal(clipHold(c), DEFAULT_HOLD);
  assert.equal(clipLen(c), DEFAULT_HOLD);
});

test('the hold is clamped to something playable', () => {
  assert.equal(clampHold(1e9), HOLD_MAX);
  assert.equal(clampHold(0), MIN_CLIP_LEN);
  assert.equal(clampHold(NaN), DEFAULT_HOLD);
});

test('trimming a frozen clip picks WHICH frame is held, not how long', () => {
  const a = clip({ in: 3, out: 8, speed: 0, hold: 2 });
  const b = { ...a, in: 6 };
  assert.equal(clipLen(a), clipLen(b), 'the trim must not change the hold');
  assert.equal(clipSourceAt(b, 1), 6, 'but it does change the frame');
});

// ===== Stills =====

test('speed means nothing to a still, whatever is stored on it', () => {
  for (const kind of ['image', 'blank']) {
    const c = clip({ kind, in: 0, out: 4, speed: 2 });
    assert.equal(clipSpeed(c), 1, `${kind} should ignore speed`);
    assert.equal(isFrozen(c), false, `${kind} cannot be frozen — it is already still`);
    assert.equal(clipLen(c), 4, `${kind} keeps its set length`);
  }
});

// ===== The sequence =====

test('the timeline lays out on re-timed lengths, not source lengths', () => {
  const clips = [
    clip({ id: 'a', out: 4 }),               // 4s at 1x  -> 4s
    clip({ id: 'b', out: 4, speed: 2 }),     // 4s at 2x  -> 2s
    clip({ id: 'c', out: 4, speed: 0, hold: 3 }), // frozen -> 3s
  ];
  const lay = layoutClips(clips);
  assert.deepEqual(lay.map((p) => [p.start, p.end]), [[0, 4], [4, 6], [6, 9]]);
  assert.equal(baseDuration(clips), 9);
});

test('a seek lands on the right clip and the right source second', () => {
  const clips = [
    clip({ id: 'a', out: 4 }),
    clip({ id: 'b', in: 0, out: 4, speed: 2 }),
    clip({ id: 'c', in: 5, out: 9, speed: 0, hold: 3 }),
  ];
  // 2s in: first clip, 2s of source.
  let hit = resolveBase(clips, 2);
  assert.equal(hit.clip.id, 'a');
  assert.ok(near(hit.sourceT, 2));

  // 5s in: 1s into the 2x clip, so 2s of ITS source.
  hit = resolveBase(clips, 5);
  assert.equal(hit.clip.id, 'b');
  assert.ok(near(hit.local, 1));
  assert.ok(near(hit.sourceT, 2));

  // 7.5s in: inside the freeze, which shows its in-point whenever you look.
  hit = resolveBase(clips, 7.5);
  assert.equal(hit.clip.id, 'c');
  assert.ok(near(hit.sourceT, 5));
});

test('every clip in a re-timed sequence is reachable', () => {
  const clips = [
    clip({ id: 'a', out: 4, speed: 4 }),
    clip({ id: 'b', out: 4, speed: 0.5 }),
    clip({ id: 'c', out: 4, speed: 0 }),
  ];
  const seen = new Set();
  const total = baseDuration(clips);
  for (let t = 0; t < total; t += 0.05) {
    const stack = activeClipsAt(clips, t);
    for (const h of stack) seen.add(h.clip.id);
  }
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
});

// ===== The razor =====

test('splitting a re-timed clip cuts the source where the timeline was cut', () => {
  // 8s of source at 2x = 4s on the timeline. Cutting at 1s of timeline is 2s of
  // source, not 1 — this is the arithmetic the razor gets wrong if speed is
  // ignored, and the symptom is a jump at the cut.
  const c = clip({ in: 0, out: 8, speed: 2 });
  assert.equal(clipLen(c), 4);
  const [a, b] = splitClip(c, 1);
  assert.ok(near(a.out, 2), `first half should end at 2s of source, got ${a.out}`);
  assert.ok(near(b.in, 2), `second half should start at 2s of source, got ${b.in}`);
  assert.equal(a.speed, 2, 'both halves keep the rate');
  assert.equal(b.speed, 2);
});

test('a split conserves the clip length on the timeline', () => {
  for (const speed of [0.5, 1, 2, 4]) {
    const c = clip({ in: 0, out: 8, speed });
    const len = clipLen(c);
    const [a, b] = splitClip(c, len / 2);
    assert.ok(near(clipLen(a) + clipLen(b), len), `${speed}x: ${clipLen(a)} + ${clipLen(b)} != ${len}`);
  }
});

test('splitting a freeze splits the hold, and both halves hold the same frame', () => {
  const c = clip({ in: 3, out: 8, speed: 0, hold: 4 });
  const [a, b] = splitClip(c, 1.5);
  assert.ok(near(clipLen(a), 1.5));
  assert.ok(near(clipLen(b), 2.5));
  assert.equal(a.in, 3);
  assert.equal(b.in, 3, 'the second half must not advance into the source');
  assert.equal(clipSourceAt(b, 1), 3);
});

test('a split still redistributes the volume curve on timeline time', () => {
  const c = clip({
    in: 0,
    out: 8,
    speed: 2,                       // 4s on the timeline
    volume: [{ t: 0.5, level: 0.2 }, { t: 3, level: 0.9 }],
  });
  const [a, b] = splitClip(c, 2);
  assert.deepEqual(a.volume, [{ t: 0.5, level: 0.2 }]);
  assert.deepEqual(b.volume, [{ t: 1, level: 0.9 }], 'rebased onto the new clip');
});

test('a split too close to either end is refused', () => {
  const c = clip({ in: 0, out: 8, speed: 2 });   // 4s on the timeline
  assert.equal(splitClip(c, MIN_CLIP_LEN / 2), null);
  assert.equal(splitClip(c, 4 - MIN_CLIP_LEN / 2), null);
  assert.ok(splitClip(c, 2), 'but the middle is fine');
});

test('splitting an untimed clip behaves exactly as it always did', () => {
  const c = clip({ in: 1, out: 9, volume: [{ t: 2, level: 0.5 }] });
  const [a, b] = splitClip(c, 3);
  assert.equal(a.out, 4);
  assert.equal(b.in, 4);
  assert.equal(b.out, 9);
  assert.deepEqual(a.volume, [{ t: 2, level: 0.5 }]);
  assert.equal(b.volume, undefined);
});

// ===== The transport clock =====
//
// Not strictly part of speed, but it is what a two-second hold is READ through,
// and it was rounding one off to "0:01". The time-warp integrates the output
// clock in 1/240 steps, so an exactly-N-second timeline arrives as N − 1e-13,
// and flooring that loses a whole second. Worth pinning: the symptom looks
// exactly like a freeze that is holding for the wrong length.
const { clockTime } = await import('../src/video/project/constants.ts');

test('a duration a hair under a whole second still reads as that second', () => {
  assert.equal(clockTime(1.9999999999999942), '0:02', 'a 2s hold must not read 0:01');
  assert.equal(clockTime(7.999999999999866), '0:08');
  assert.equal(clockTime(4), '0:04');
});

test('but a genuinely fractional duration is not rounded up', () => {
  assert.equal(clockTime(3.99), '0:03');
  assert.equal(clockTime(7.98), '0:07');
  assert.equal(clockTime(0.4), '0:00');
});

test('the clock formats minutes, and refuses nonsense', () => {
  assert.equal(clockTime(0), '0:00');
  assert.equal(clockTime(65.5), '1:05');
  assert.equal(clockTime(120), '2:00');
  assert.equal(clockTime(-5), '0:00');
  assert.equal(clockTime(NaN), '0:00');
  assert.equal(clockTime(Infinity), '0:00');
});
