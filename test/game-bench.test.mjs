// Tests that the console's cheat actually reaches the warp scheduler.
//
// `game-cheats.test.mjs` pins the command and the eligibility rule; this file
// checks the three lines of wiring between them, by running real games. The
// engine is driven headlessly — stub canvas, stub clock, one frame at a time —
// and every warp it engages is collected through the `onEvent` callback the
// app already listens to, so nothing here reaches inside the engine.
//
// The wiring is small and exactly the kind that breaks quietly: a cheat that
// silently stops working looks identical to a cheat nobody typed correctly.
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

// ===== The browser surface the engine touches, and nothing more =====
let now = 0;
let pendingFrame = null;

const listeners = () => ({ addEventListener() {}, removeEventListener() {} });

function installGlobals() {
  now = 0;
  pendingFrame = null;
  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = (cb) => { pendingFrame = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { pendingFrame = null; };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    ...listeners(),
  };
  globalThis.document = {
    hidden: false,
    pointerLockElement: null,
    exitPointerLock() {},
    ...listeners(),
  };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    // Each game reads the stored best on creation, so a test that cares about
    // the record has to start from a known one rather than the last test's.
    clear: () => store.clear(),
  };
}

function stubCanvas() {
  const grad = { addColorStop() {} };
  const canvas = {
    width: 960,
    height: 600,
    style: {},
    getBoundingClientRect: () => ({ width: 960, height: 600, left: 0, top: 0 }),
    requestPointerLock: () => undefined,
    ...listeners(),
  };
  // Anything the renderer reaches for is a no-op; the drawing isn't under test.
  const ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key === 'canvas') return canvas;
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => grad;
        if (key === 'measureText') return (s) => ({ width: String(s).length * 7 });
        if (key in target) return target[key];
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  canvas.getContext = () => ctx;
  return canvas;
}

/** Advance one animation frame. dt is clamped to 50ms inside the engine. */
function frame(ms = 50) {
  now += ms;
  const cb = pendingFrame;
  pendingFrame = null;
  if (cb) cb(now);
}

installGlobals();
const { createGame } = await import('../src/game/engine.ts');
const { HARD_WARPS, WARPS } = await import('../src/game/warps.ts');
const { LESSONS } = await import('../src/game/tutorial.ts');

const HARD = new Set(HARD_WARPS);

/**
 * Play `runs` complete games and report every warp the scheduler engaged.
 * `bench` is handed to the engine before each run starts.
 *
 * The wave is pushed to 8 once the run is going, because `warpSlots()` hands
 * out no warps at all before wave 2 and only reaches three at wave 8 — and a
 * headless harness has no hand on the mouse, so it never banks an orb and
 * never leaves wave 1. Setting the wave stages the late game; which warps the
 * scheduler then picks is still entirely the engine's decision, and that is
 * the thing under test.
 */
function collectWarps({ bench, runs = 8, benchDuringRun = null }) {
  const seen = [];
  const canvas = stubCanvas();
  const game = createGame(canvas, {
    onHud() {},
    onTick() {},
    onEvent(e) {
      if (e.kind === 'warp') seen.push(e.warp.id);
    },
  });

  for (let r = 0; r < runs; r++) {
    game.benchWarps(bench);
    game.start();
    game.state().wave = 8;
    if (benchDuringRun) game.benchWarps(benchDuringRun);
    // A run is 20s of clock unless orbs are banked; 800 frames is far past it.
    for (let i = 0; i < 800; i++) {
      frame();
      if (game.state().phase === 'over') break;
    }
    game.toMenu();
  }
  game.destroy();
  return seen;
}

test('a plain run draws from the whole catalogue, hard warps included', () => {
  const seen = collectWarps({ bench: [], runs: 10 });
  assert.ok(seen.length > 10, `only ${seen.length} warps engaged — the harness isn't playing`);
  const hard = seen.filter((id) => HARD.has(id));
  assert.ok(hard.length > 0, 'the hard warps must appear normally, or the next test proves nothing');
});

test('with the hard warps benched, the scheduler never engages one', () => {
  const seen = collectWarps({ bench: HARD_WARPS, runs: 10 });
  assert.ok(seen.length > 10, `only ${seen.length} warps engaged — the harness isn't playing`);
  const leaked = seen.filter((id) => HARD.has(id));
  assert.deepEqual(leaked, [], `benched warps engaged anyway: ${[...new Set(leaked)].join(', ')}`);
});

test('the run still gets warps — benching four does not make it a walk', () => {
  const seen = collectWarps({ bench: HARD_WARPS, runs: 6 });
  const kinds = new Set(seen);
  assert.ok(kinds.size >= 3, `only ${kinds.size} distinct warps ever engaged`);
  for (const id of kinds) {
    assert.ok(WARPS.some((w) => w.id === id), `${id} is not a real warp`);
  }
});

test('benching mid-run does not rescue the run in progress', () => {
  // Armed after start(), so this run must still be the full-catalogue one.
  const seen = collectWarps({ bench: [], runs: 10, benchDuringRun: HARD_WARPS });
  const hard = seen.filter((id) => HARD.has(id));
  assert.ok(hard.length > 0, 'a bench applied after start() must not take effect until the next run');
});

/** Play one run to its end, having scored `score`. Returns the best after it. */
function runScoring(game, { bench, score }) {
  game.benchWarps(bench);
  game.start();
  const st = game.state();
  st.wave = 8;
  st.score = score;
  for (let i = 0; i < 800 && game.state().phase !== 'over'; i++) frame();
  return game.state().best;
}

test('an honest run takes the high score, and a benched one cannot', () => {
  localStorage.clear();
  const canvas = stubCanvas();
  const game = createGame(canvas, { onHud() {}, onTick() {}, onEvent() {} });

  const honest = runScoring(game, { bench: [], score: 500 });
  assert.equal(honest, 500, 'a normal run should set the record');
  game.toMenu();

  // A much better score, with four warps benched. The record must not move:
  // banking it would overwrite an honest best with an easier one, and leave no
  // way to tell afterwards which it was.
  const after = runScoring(game, { bench: HARD_WARPS, score: 9999 });
  assert.equal(after, 500, 'a benched run must not overwrite the best');
  assert.equal(localStorage.getItem('drift.best.v1'), '500');
  game.destroy();
});

test('quitting a benched run to the menu cannot bank it either', () => {
  localStorage.clear();
  const canvas = stubCanvas();
  const game = createGame(canvas, { onHud() {}, onTick() {}, onEvent() {} });
  runScoring(game, { bench: [], score: 300 });
  game.toMenu();

  game.benchWarps(HARD_WARPS);
  game.start();
  game.state().wave = 8;
  game.state().score = 8888;
  for (let i = 0; i < 40; i++) frame();
  game.toMenu();                       // the other door out of a run
  assert.equal(game.state().best, 300, 'toMenu must apply the same rule as game over');
  game.destroy();
});

test('the tutorial is not touched by a bench', () => {
  const canvas = stubCanvas();
  const game = createGame(canvas, { onHud() {}, onTick() {}, onEvent() {} });
  game.benchWarps(HARD_WARPS);
  game.startTutorial();
  for (let i = 0; i < 40; i++) frame();
  // A lesson is the real warp or it is nothing. The tutorial arms its warp
  // directly and the scheduler — the only thing a bench filters — is skipped
  // entirely while a lesson is running.
  assert.ok(game.state().tutorial, 'startTutorial should be in a lesson');
  assert.equal(game.state().warps.length <= 1, true, 'the scheduler must stay out of a lesson');
  game.destroy();
});

test('the lessons still cover the warps a benched run has taken away', () => {
  // Somebody who armed the cheat can still be taught Mirror; the catalogue the
  // tutorial teaches from is never filtered.
  const taught = new Set(LESSONS.map((l) => l.warp).filter(Boolean));
  for (const id of HARD_WARPS) {
    assert.ok(taught.has(id), `the tutorial no longer teaches ${id}`);
  }
});
