// Tests for src/feed/engine.ts — the Doomscroll loop itself.
//
// The game can't be watched in an automated browser (a hidden document gets no
// animation frames, so the loop never turns over), and the mechanics that
// matter are invisible in a screenshot anyway: whether *slowing down* is really
// what makes a card land on you. So the engine is driven headlessly here —
// stub canvas, stub clock, one frame at a time — and asked the questions a
// playthrough would ask.
//
// The stubs below are the entire browser surface the engine touches. If this
// file starts failing with "not a function", something in the engine reached
// for a new piece of the platform, which is worth knowing about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The engine imports its siblings the way the rest of the app does — './scroll',
// not './scroll.ts' — because Vite resolves extensions and TypeScript expects
// it. Node does not, so teach it the same trick before pulling the module in.
// Nothing else in the test suite needs this: the other tests reach for leaf
// modules that import nothing but types.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const VIEW_W = 800;
const VIEW_H = 500;

let now = 0;
let pendingFrame = null;

function stubContext() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return {
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    fillText: noop,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: (t) => ({ width: t.length * 7 }),
  };
}

function stubCanvas() {
  const handlers = new Map();
  return {
    width: 0,
    height: 0,
    handlers,
    getContext: () => stubContext(),
    getBoundingClientRect: () => ({ width: VIEW_W, height: VIEW_H }),
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  };
}

globalThis.window = {
  matchMedia: () => ({ matches: false }),
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (cb) => {
  pendingFrame = cb;
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => now };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { createFeed } = await import('../src/feed/engine.ts');
const { ZONE_Y } = await import('../src/feed/types.ts');

/** A feed wired to a stub canvas, with a hand-cranked clock. */
function harness() {
  const canvas = stubCanvas();
  now = 0;
  pendingFrame = null;
  const feed = createFeed(canvas, { onHud: () => {}, onTick: () => {}, onEvent: () => {} });

  const step = (ms = 16) => {
    now += ms;
    const cb = pendingFrame;
    pendingFrame = null;
    cb(now);
  };

  return {
    feed,
    st: () => feed.state(),
    step,
    steps: (n, ms = 16) => {
      for (let i = 0; i < n; i++) step(ms);
    },
    /** One wheel event, in CSS pixels, exactly as a browser would deliver it. */
    wheel: (px) => canvas.handlers.get('wheel')({ deltaY: px, deltaMode: 0, preventDefault() {} }),
  };
}

/** Put the card under the read line into a known state for the test. */
function focused(st) {
  return st.cards[st.focus];
}

test('the menu fills the feed before anything has been played', () => {
  const h = harness();
  assert.ok(h.st().cards.length > 2, 'the title card should have a feed behind it');
  assert.equal(h.st().phase, 'menu');
  h.feed.destroy();
});

test('a wheel notch travels a fraction of the viewport, not a count of pixels', () => {
  const h = harness();
  h.feed.start();
  h.step();
  const before = h.st().y;
  // A fifth of the viewport in pixels is a fifth of the viewport in units, and
  // would be whatever a fifth of some other viewport happened to be too.
  h.wheel(VIEW_H * 0.2);
  h.step();
  assert.ok(
    Math.abs(h.st().y - before - 0.2) < 1e-6,
    `expected +0.2 units, got ${h.st().y - before}`,
  );
  h.feed.destroy();
});

test('one absurd wheel event is capped rather than teleporting the feed', () => {
  // Alt-tabbing back into a page, or a trackpad deciding a flick was worth ten
  // thousand pixels, must not fling the player through half a wave of cards.
  const h = harness();
  h.feed.start();
  h.step();
  const before = h.st().y;
  h.wheel(VIEW_H * 40);
  h.step();
  assert.ok(h.st().y - before < 0.5, `a single event moved ${h.st().y - before}`);
  h.feed.destroy();
});

test('a run opens with a post already on the line', () => {
  const h = harness();
  h.feed.start();
  h.step();
  const card = focused(h.st());
  assert.ok(card, 'something must be under the line');
  assert.equal(card.kind, 'post');
  h.feed.destroy();
});

test('stopping on a post banks it, and banking buys attention back', () => {
  const h = harness();
  h.feed.start();
  h.step();
  const att = h.st().attention;
  h.steps(70); // ~1.1s of standing still: longer than READ_TIME
  const st = h.st();
  assert.ok(st.score > 0, 'a post read at a standstill should score');
  assert.equal(st.read, 1, 'exactly one post, since the line never moved');
  assert.ok(st.attention > att, 'reading has to pay for the time it costs');
  h.feed.destroy();
});

test('flying past banks nothing — engagement is the whole mechanic', () => {
  const h = harness();
  h.feed.start();
  h.step();
  // Keep the feed well above the calm threshold for a second and a half.
  for (let i = 0; i < 90; i++) {
    h.wheel(VIEW_H * 0.03);
    h.step();
  }
  const st = h.st();
  assert.ok(st.y > 1, 'the feed should have travelled a long way');
  assert.equal(st.score, 0, 'nothing may bank at speed');
  assert.ok(st.engagement < 0.2, `engagement should be near zero, was ${st.engagement}`);
  h.feed.destroy();
});

test('bait drains attention while you look at it, and hooks you if you stay', () => {
  const h = harness();
  h.feed.start();
  h.step();
  const card = focused(h.st());
  card.kind = 'bait';
  card.done = false;
  card.meter = 0;

  const before = h.st().attention;
  h.steps(30); // ~0.5s, under the hook time
  const mid = h.st();
  assert.ok(mid.shields === 3, 'half a second of bait should not have hooked yet');
  // Base drain over half a second is ~0.5s of attention; bait must cost more.
  assert.ok(before - mid.attention > 1, `bait should bite: lost ${before - mid.attention}`);

  h.steps(90); // well past HOOK_TIME
  assert.equal(h.st().shields, 2, 'lingering on bait costs a hook');
  h.feed.destroy();
});

test('an ad takes the feed, holds it, and gives it back', () => {
  const h = harness();
  h.feed.start();
  h.step();
  const card = focused(h.st());
  card.kind = 'ad';
  card.done = false;
  card.meter = 0;

  h.steps(4);
  assert.ok(h.st().pin, 'standing still in front of an ad hands it the feed');
  const id = h.st().pin.id;

  // Scrolling during the hold is read and thrown away — that is the joke.
  const held = h.st().y;
  h.wheel(VIEW_H);
  h.step();
  assert.ok(Math.abs(h.st().y - held) < 0.2, 'the ad should keep the feed roughly where it is');

  h.steps(90);
  assert.equal(h.st().pin, null, 'the hold has to expire on its own');
  const played = h.st().cards.find((c) => c.id === id);
  assert.ok(played.done, 'a played-out ad must not be able to take the feed again');
  h.feed.destroy();
});

test('a flick coasts and then settles, rather than stopping dead', () => {
  const h = harness();
  h.feed.start();
  h.step();
  h.wheel(VIEW_H * 0.4);
  h.step();
  const afterFlick = h.st().y;

  h.steps(6); // no further input: this is pure momentum
  const coasted = h.st().y;
  assert.ok(coasted > afterFlick, 'the feed should still be travelling');

  h.steps(120); // ~2s
  assert.equal(h.st().v, 0, 'and it should come to rest');
  h.feed.destroy();
});

test('the algorithm holds off until wave two, then arms a quirk', () => {
  const h = harness();
  h.feed.start();
  h.steps(20);
  assert.equal(h.st().quirks.length, 0, 'wave one is deliberately clean');

  h.st().wave = 3;
  h.steps(4);
  assert.equal(h.st().quirks.length, 1, 'a later wave should draw a quirk');
  h.feed.destroy();
});

test('the read line decides focus, and only one card can ever hold it', () => {
  const h = harness();
  h.feed.start();
  h.steps(2);

  // A run opens with a card centred on the line, whatever height it drew.
  let st = h.st();
  let line = st.y + ZONE_Y;
  let holders = st.cards.filter((c) => c.top <= line && line < c.top + c.h);
  assert.equal(holders.length, 1, 'a run must not open on a gap between cards');
  assert.equal(holders[0].id, st.cards[st.focus].id, 'focus must be the card on the line');

  // From then on the line may fall in a gap — that is a legal, deliberate
  // nothing — but it can never be claimed by two cards at once.
  for (let i = 0; i < 200; i++) {
    h.wheel(VIEW_H * 0.02);
    h.step();
    st = h.st();
    line = st.y + ZONE_Y;
    holders = st.cards.filter((c) => c.top <= line && line < c.top + c.h);
    assert.ok(holders.length <= 1, 'cards must not overlap');
    if (holders.length) assert.equal(st.cards[st.focus].id, holders[0].id, 'focus disagrees');
    else assert.equal(st.focus, -1, 'a gap must report no focus');
  }
  h.feed.destroy();
});

test('the feed can be reversed to a card you overshot, but not into the void', () => {
  const h = harness();
  h.feed.start();
  h.steps(2);
  for (let i = 0; i < 60; i++) {
    h.wheel(-VIEW_H * 0.1);
    h.step();
  }
  const st = h.st();
  assert.ok(st.y >= st.cards[0].top - ZONE_Y - 1e-9, 'the top of the feed is a wall');
  assert.ok(st.v >= 0, 'and hitting it kills the momentum rather than grinding');
  h.feed.destroy();
});

test('running out of attention ends the run and keeps the score', () => {
  const h = harness();
  h.feed.start();
  h.step();
  h.st().attention = 0.05;
  h.st().score = 250;
  h.steps(3);
  assert.equal(h.st().phase, 'over');
  assert.equal(h.st().best, 250, 'the best has to survive the run that set it');
  h.feed.destroy();
});
