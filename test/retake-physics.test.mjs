// Tests for src/retake/physics.ts — the movement model Retake is designed around.
//
// Two kinds of thing are asserted here. The first is ordinary correctness: a
// body must never finish a step inside a wall, must land exactly on top of what
// it lands on, and must not tunnel through a floor at full falling speed.
//
// The second is the *design contract*. Every level in the game is drawn against
// two numbers — a jump rises about 2.5 tiles and carries about 5.7 — and the
// puzzles work only because a 3-tile shelf is out of reach and a 4-tile gap is
// not. Those numbers are asserted below, so retuning the feel can't silently
// make five levels trivial or impossible without a test saying so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The modules import each other extensionless, the way Vite resolves them.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { stepBody, GRAVITY, JUMP_V, MAX_FALL, RUN_SPEED, COYOTE, JUMP_BUFFER } = await import(
  '../src/retake/physics.ts'
);
const { makeBody, PLAYER_W, PLAYER_H, FIXED_DT } = await import('../src/retake/types.ts');

const DT = FIXED_DT;
const key = (s = '') => ({ left: s.includes('L'), right: s.includes('R'), jump: s.includes('J') });

/** A collider from ASCII rows: '#' is solid, the sides are walls, top/bottom open. */
function grid(rows, movers = []) {
  return {
    solidAt(tx, ty) {
      if (tx < 0 || tx >= rows[0].length) return true;
      if (ty < 0 || ty >= rows.length) return false;
      return rows[ty][tx] === '#';
    },
    movers,
  };
}

const FLAT = grid(['..........', '..........', '..........', '##########']);
/** Feet rest on y=3 (the top of the floor row). */
const onFloor = () => makeBody(2, 3 - PLAYER_H);

function run(body, world, keys, steps) {
  for (let i = 0; i < steps; i++) stepBody(body, key(keys), world, DT);
  return body;
}

test('a body at rest on the floor stays exactly on it', () => {
  const b = onFloor();
  run(b, FLAT, '', 240);
  assert.equal(b.onGround, true);
  assert.ok(Math.abs(b.y + PLAYER_H - 3) < 1e-6, `feet at ${b.y + PLAYER_H}`);
  assert.equal(b.vy, 0);
});

test('a full jump rises about 2.5 tiles — so a 3-tile shelf is out of reach alone', () => {
  const b = onFloor();
  const start = b.y;
  let apex = start;
  for (let i = 0; i < 200; i++) {
    stepBody(b, key('J'), FLAT, DT);
    apex = Math.min(apex, b.y);
  }
  const height = start - apex;
  assert.ok(height > 2.4 && height < 2.7, `jump height ${height.toFixed(3)}`);
  // The whole level set depends on this being true.
  assert.ok(height < 3, 'a 3-tile shelf must be unreachable without a stand-in');
  assert.ok(height > 2, 'a 2-tile step must stay reachable');
});

test('a running jump carries about 5.7 tiles — so a 4-tile pit is crossable', () => {
  // A long floor: the body needs room to reach top speed and then land again.
  const long = grid(['.'.repeat(40), '.'.repeat(40), '.'.repeat(40), '#'.repeat(40)]);
  const b = makeBody(2, 3 - PLAYER_H);
  run(b, long, 'R', 120);
  const x0 = b.x;
  let airborne = false;
  let landed = null;
  for (let i = 0; i < 400; i++) {
    stepBody(b, key(i < 45 ? 'RJ' : 'R'), long, DT);
    if (!airborne && !b.onGround) airborne = true;
    else if (airborne && b.onGround) { landed = b.x; break; }
  }
  const span = landed - x0;
  assert.ok(span > 5.4 && span < 6.0, `jump span ${span.toFixed(3)}`);
  assert.ok(span > 4.5, 'a 4-tile pit must stay crossable');
});

test('releasing jump early gives a lower apex than holding it', () => {
  const apexOf = (holdSteps) => {
    const b = onFloor();
    let apex = b.y;
    for (let i = 0; i < 200; i++) {
      stepBody(b, key(i < holdSteps ? 'J' : ''), FLAT, DT);
      apex = Math.min(apex, b.y);
    }
    return b.y === undefined ? 0 : onFloor().y - apex;
  };
  const short = apexOf(6);
  const long = apexOf(200);
  assert.ok(short < long, `short hop ${short.toFixed(2)} should be under full ${long.toFixed(2)}`);
  assert.ok(short > 0.4, 'a tap should still leave the ground meaningfully');
});

test('coyote time lets a jump land just after walking off a ledge', () => {
  // A floor that stops at x=4, so walking right runs out of ground.
  const world = grid(['..........', '..........', '..........', '#####.....']);
  const walkOff = (waitSteps) => {
    const b = makeBody(3, 3 - PLAYER_H);
    while (b.onGround || b.y < 3 - PLAYER_H + 0.001) {
      stepBody(b, key('R'), world, DT);
      if (!b.onGround) break;
    }
    for (let i = 0; i < waitSteps; i++) stepBody(b, key('R'), world, DT);
    const before = b.vy;
    stepBody(b, key('RJ'), world, DT);
    return b.vy < before && b.vy < -JUMP_V * 0.8;
  };
  assert.equal(walkOff(1), true, 'a jump one step after the ledge must still fire');
  assert.equal(walkOff(Math.round(COYOTE / DT) + 12), false, 'but not forever');
});

test('a jump pressed just before landing still fires on touchdown', () => {
  const b = makeBody(2, 0);          // dropped from above the floor
  let firedLate = false;
  let pressed = false;
  for (let i = 0; i < 400; i++) {
    // Press once, a few steps before we expect to land.
    const nearGround = b.y + PLAYER_H > 3 - 0.35 && !b.onGround;
    const jump = nearGround && !pressed;
    if (jump) pressed = true;
    const r = stepBody(b, key(jump ? 'J' : ''), FLAT, DT);
    if (r.jumped) { firedLate = true; break; }
  }
  assert.equal(firedLate, true, 'the buffered press must survive to the landing');
  assert.ok(JUMP_BUFFER > 0.05, 'and the window must be worth having');
});

test('holding jump through a landing does not re-fire it', () => {
  const b = onFloor();
  let jumps = 0;
  for (let i = 0; i < 600; i++) {
    const r = stepBody(b, key('J'), FLAT, DT);   // never released
    if (r.jumped) jumps++;
  }
  assert.equal(jumps, 1, 'a held button is one jump, not a bounce');
});

test('falling is capped, and a capped fall still cannot tunnel the floor', () => {
  const b = makeBody(2, -60);        // a very long way up
  for (let i = 0; i < 2000; i++) {
    stepBody(b, key(''), FLAT, DT);
    assert.ok(b.vy <= MAX_FALL + 1e-6, `vy ${b.vy} exceeded terminal velocity`);
    if (b.onGround) break;
  }
  assert.equal(b.onGround, true, 'it must land, not pass through');
  assert.ok(Math.abs(b.y + PLAYER_H - 3) < 1e-6, `feet at ${b.y + PLAYER_H}`);
});

test('a body never finishes a step overlapping solid rock', () => {
  const world = grid([
    '..........',
    '...##.....',
    '.....#....',
    '##########',
  ]);
  // A deterministic input storm — the point is that no sequence gets inside.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const b = makeBody(1, 0);
  for (let i = 0; i < 20000; i++) {
    const r = rnd();
    stepBody(b, { left: r < 0.3, right: r > 0.6, jump: rnd() < 0.25 }, world, DT);
    if (b.y > 10) { b.x = 1; b.y = 0; b.vx = 0; b.vy = 0; continue; }
    const x0 = Math.floor(b.x), x1 = Math.floor(b.x + PLAYER_W - 1e-9);
    const y0 = Math.floor(b.y), y1 = Math.floor(b.y + PLAYER_H - 1e-9);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        assert.equal(world.solidAt(tx, ty), false,
          `step ${i}: body at (${b.x.toFixed(3)}, ${b.y.toFixed(3)}) is inside tile ${tx},${ty}`);
      }
    }
  }
});

test('a body can stand on a mover, and is carried by it', () => {
  const mover = { x: 2, y: 2, w: PLAYER_W, h: PLAYER_H, dx: 0, dy: 0 };
  const world = grid(['..........', '..........', '..........', '##########'], [mover]);
  const b = makeBody(2, 2 - PLAYER_H);
  stepBody(b, key(''), world, DT);
  assert.equal(b.onGround, true, 'the mover is solid ground');
  const x0 = b.x;
  mover.dx = 0.05;                       // the mover slides right this step
  mover.x += 0.05;
  stepBody(b, key(''), world, DT);
  assert.ok(b.x > x0 + 0.04, `carried to ${b.x.toFixed(3)} from ${x0.toFixed(3)}`);
});

test('a body deeply inside a mover walks out instead of being ejected', () => {
  // Every take starts on the same mark, so a new performer begins life exactly
  // overlapping every past one. Ejecting there would shove each take backwards.
  const mover = { x: 2, y: 3 - PLAYER_H, w: PLAYER_W, h: PLAYER_H, dx: 0, dy: 0 };
  const world = grid(['..........', '..........', '..........', '##########'], [mover]);
  const b = makeBody(2, 3 - PLAYER_H);   // perfectly coincident
  const x0 = b.x;
  run(b, world, 'R', 30);
  assert.ok(b.x > x0, `must be able to walk out, got ${b.x.toFixed(3)} from ${x0.toFixed(3)}`);
});

test('a mover met from the side is solid', () => {
  const mover = { x: 6, y: 3 - PLAYER_H, w: PLAYER_W, h: PLAYER_H, dx: 0, dy: 0 };
  const world = grid(['..........', '..........', '..........', '##########'], [mover]);
  const b = makeBody(2, 3 - PLAYER_H);
  run(b, world, 'R', 300);
  assert.ok(b.x + PLAYER_W <= 6 + 1e-6, `should be stopped at the flank, got x=${b.x.toFixed(3)}`);
});

test('the tuning constants stay in the range the levels assume', () => {
  assert.ok(GRAVITY > 0 && JUMP_V > 0 && RUN_SPEED > 0);
  assert.ok(JUMP_V ** 2 / (2 * GRAVITY) < 3, 'apex under 3 tiles keeps a 3-tile shelf a puzzle');
});
