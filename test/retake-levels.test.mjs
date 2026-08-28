// Tests for src/retake/levels.ts and src/retake/sim.ts — the shot list, and
// whether it can actually be shot.
//
// The headline test here plays the whole game. Every level is solved by a
// scripted campaign of takes, driven through exactly the same `stepSim` the
// browser calls, and the level is only considered good if the performer ends
// up standing on the mark. That is worth the trouble: a puzzle platformer whose
// levels are impossible is not a hard game, it is a broken one, and nothing
// short of playing them proves they are not — least of all a screenshot.
//
// The other headline is determinism. A take is replayed from a recorded path
// and the player stands on that path, so if the same inputs could produce two
// different runs, ghosts would drift out from under people's feet.
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

const { LEVELS, parseLevel, cellAt } = await import('../src/retake/levels.ts');
const { createSim, stepSim, cutTake, bankTake } = await import('../src/retake/sim.ts');
const { Cell, PLAYER_W, PLAYER_H, FIXED_DT, sampleTake } = await import('../src/retake/types.ts');

const key = (s = '') => ({ left: s.includes('L'), right: s.includes('R'), jump: s.includes('J') });

/** Drive `st` with `keys` held until `done`, or for at most `max` steps. */
function hold(st, keys, done, max = 1500) {
  for (let i = 0; i < max; i++) {
    if (st.ending) return;
    if (done && done(st.body, st)) return;
    stepSim(st, key(keys));
  }
}

// ===== The moves a solution is written in =====
const wait = (n) => (st) => hold(st, '', null, n);
const walkTo = (x) => (st) => hold(st, 'R', (b) => b.x >= x);
const settle = () => (st) => {
  hold(st, '', (b) => Math.abs(b.vx) < 0.001, 300);
  hold(st, '', null, 15);
};
/** Approach to `d` short of `x`, hop with jump held `jh` steps, land on top. */
const hopOnto = (x, { d = 2.0, jh = 8 } = {}) => (st) => {
  hold(st, 'R', (b) => b.x >= x - d);
  for (let i = 0; i < jh; i++) { if (st.ending) return; stepSim(st, key('RJ')); }
  hold(st, '', (b) => b.onGround, 400);
  hold(st, '', (b) => Math.abs(b.vx) < 0.01, 120);
};
/** A standing full jump to the right, ridden until it lands. */
const leap = () => (st) => {
  hold(st, '', null, 4);
  for (let i = 0; i < 45; i++) { if (st.ending) return; stepSim(st, key('RJ')); }
  hold(st, 'R', (b) => b.onGround, 500);
};
/** A running jump from `x` — the way a pit gets crossed. */
const runJump = (x) => (st) => {
  hold(st, 'R', (b) => b.x >= x);
  for (let i = 0; i < 45; i++) { if (st.ending) return; stepSim(st, key('RJ')); }
  hold(st, 'R', (b) => b.onGround, 400);
};

function runTake(level, ghosts, moves) {
  const st = createSim(level, ghosts);
  for (const m of moves) { if (st.ending) break; m(st); }
  if (!st.ending) cutTake(st);
  return { take: bankTake(st), st };
}
/** Play a level as a sequence of takes; returns the final take's state. */
function playCampaign(level, plan) {
  const ghosts = [];
  let last = null;
  for (const moves of plan) {
    last = runTake(level, ghosts, moves);
    ghosts.push(last.take);
  }
  return last;
}
/** Where a banked take came to rest — the stand-in's mark. */
const restX = (t) => t.path[(t.steps - 1) * 2];

// ===== Structure =====

test('every level is rectangular, and has exactly one spawn and a mark', () => {
  for (const level of LEVELS) {
    assert.equal(level.cells.length, level.w * level.h, `${level.id} cell count`);
    assert.ok(level.w > 0 && level.h > 0, `${level.id} size`);
    let marks = 0;
    for (const c of level.cells) if (c === Cell.Mark) marks++;
    assert.ok(marks >= 1, `${level.id} has no mark`);
    assert.ok(level.spawn, `${level.id} has no spawn`);
    assert.ok(level.takes >= 1 && level.seconds > 0, `${level.id} budget`);
    assert.ok(level.hint.length > 0, `${level.id} should teach something`);
  }
});

test('no level spawns the performer inside solid rock, or on thin air', () => {
  for (const level of LEVELS) {
    const { x, y } = level.spawn;
    for (let ty = Math.floor(y); ty <= Math.floor(y + PLAYER_H - 1e-9); ty++) {
      for (let tx = Math.floor(x); tx <= Math.floor(x + PLAYER_W - 1e-9); tx++) {
        assert.notEqual(cellAt(level, tx, ty), Cell.Solid, `${level.id} spawn is inside rock`);
        assert.notEqual(cellAt(level, tx, ty), Cell.Spike, `${level.id} spawn is on spikes`);
      }
    }
    // Something has to hold the performer up.
    const feet = Math.floor(y + PLAYER_H + 0.01);
    let supported = false;
    for (let tx = Math.floor(x); tx <= Math.floor(x + PLAYER_W - 1e-9); tx++) {
      if (cellAt(level, tx, feet) === Cell.Solid) supported = true;
    }
    assert.ok(supported, `${level.id} spawns over a hole`);
  }
});

test('the parser refuses a ragged grid rather than padding it', () => {
  assert.throws(
    () => parseLevel({ id: 'x', name: 'x', hint: 'x', takes: 1, seconds: 5,
      rows: ['####', '###', '#@##'] }),
    /wide/,
  );
});

test('the parser refuses a level with no spawn, and one with two', () => {
  const base = { id: 'x', name: 'x', hint: 'x', takes: 1, seconds: 5 };
  assert.throws(() => parseLevel({ ...base, rows: ['..X.', '####'] }), /spawn/);
  assert.throws(() => parseLevel({ ...base, rows: ['@.X@', '####'] }), /spawn/);
  assert.throws(() => parseLevel({ ...base, rows: ['@...', '####'] }), /mark/);
  assert.throws(() => parseLevel({ ...base, rows: ['@.Z.', '####'] }), /unknown glyph/);
});

// ===== Determinism =====

test('the same inputs always produce the same run, exactly', () => {
  const script = (i) => key(i % 97 < 40 ? 'R' : i % 97 < 55 ? 'RJ' : i % 97 < 70 ? 'L' : '');
  const play = () => {
    const st = createSim(LEVELS[1]);
    for (let i = 0; i < 1200 && !st.ending; i++) stepSim(st, script(i));
    return bankTake(st);
  };
  const a = play();
  const b = play();
  assert.equal(a.steps, b.steps, 'run length must not vary');
  for (let i = 0; i < a.path.length; i++) {
    assert.equal(a.path[i], b.path[i], `position ${i} drifted between identical runs`);
  }
});

test('a replayed take stands exactly where it stood when recorded', () => {
  const st = createSim(LEVELS[1]);
  for (let i = 0; i < 400; i++) stepSim(st, key('R'));
  cutTake(st);
  const take = bankTake(st);
  for (const step of [0, 1, 50, 200, take.steps - 1]) {
    const box = sampleTake(take, step);
    assert.equal(box.x, take.path[step * 2], `step ${step} x`);
    assert.equal(box.y, take.path[step * 2 + 1], `step ${step} y`);
  }
});

test('a finished take freezes on its last frame instead of vanishing', () => {
  const st = createSim(LEVELS[1]);
  for (let i = 0; i < 300; i++) stepSim(st, key('R'));
  cutTake(st);
  const take = bankTake(st);
  const last = sampleTake(take, take.steps - 1);
  const wayLater = sampleTake(take, take.steps + 5000);
  assert.ok(wayLater, 'a held frame must still exist');
  assert.equal(wayLater.x, last.x, 'and hold its position');
  assert.equal(wayLater.y, last.y);
  assert.equal(wayLater.dx, 0, 'a held frame carries nothing along with it');
  assert.equal(wayLater.dy, 0);
});

// ===== Endings =====

test('spikes end a take, and the pit in Establishing Shot is real', () => {
  const st = createSim(LEVELS[0]);
  // Walk straight into the pit without jumping.
  for (let i = 0; i < 1200 && !st.ending; i++) stepSim(st, key('R'));
  assert.equal(st.ending, 'died', 'walking into the spikes must end the take');
  assert.equal(st.cleared, false);
});

test('a take is cut automatically when its time runs out', () => {
  const level = { ...LEVELS[1], seconds: 0.5 };
  const st = createSim(level);
  for (let i = 0; i < 5000 && !st.ending; i++) stepSim(st, key(''));
  assert.equal(st.ending, 'expired');
  assert.ok(st.step <= Math.round(0.5 / FIXED_DT) + 1);
});

test('a cut take stops simulating, however many frames still arrive', () => {
  const st = createSim(LEVELS[1]);
  for (let i = 0; i < 100; i++) stepSim(st, key('R'));
  cutTake(st);
  const { x, y } = st.body;
  const steps = st.step;
  for (let i = 0; i < 500; i++) stepSim(st, key('RJ'));
  assert.equal(st.body.x, x, 'a finished take must not keep moving');
  assert.equal(st.body.y, y);
  assert.equal(st.step, steps);
});

// ===== The whole game =====
//
// One scripted campaign per level. These are real solutions: if a change to the
// physics or the geometry makes a shot unplayable, the campaign stops reaching
// the mark and this fails.

const CAMPAIGNS = [
  {
    level: 0,
    takes: 1,
    plan: () => [[runJump(8.6), walkTo(26)]],
  },
  {
    level: 1,
    takes: 2,
    plan: (L) => {
      const g = restX(runTake(L, [], [walkTo(17), settle()]).take);
      return [
        [walkTo(17), settle()],
        [wait(90), hopOnto(g, { d: 2.0 }), leap(), walkTo(22)],
      ];
    },
  },
  {
    level: 2,
    takes: 3,
    plan: (L) => {
      const t1 = runTake(L, [], [walkTo(11.5), settle()]).take;
      const g1 = restX(t1);
      const climb = [wait(90), hopOnto(g1, { d: 0.6 }), leap()];
      const t2 = runTake(L, [t1], [...climb, walkTo(19.5), settle()]).take;
      const g2 = restX(t2);
      return [
        [walkTo(11.5), settle()],
        [...climb, walkTo(19.5), settle()],
        [...climb, hopOnto(g2, { d: 2.5 }), leap(), walkTo(27)],
      ];
    },
  },
  {
    level: 3,
    takes: 2,
    plan: (L) => {
      const cross = [runJump(9.0)];
      const g = restX(runTake(L, [], [...cross, walkTo(17), settle()]).take);
      return [
        [...cross, walkTo(17), settle()],
        [wait(90), ...cross, hopOnto(g, { d: 2.0 }), leap(), walkTo(22)],
      ];
    },
  },
  {
    level: 4,
    takes: 3,
    plan: (L) => {
      const cross = [runJump(5.0)];
      const t1 = runTake(L, [], [...cross, walkTo(12.5), settle()]).take;
      const g1 = restX(t1);
      const climb = [wait(90), ...cross, hopOnto(g1, { d: 0.6 }), leap()];
      const t2 = runTake(L, [t1], [...climb, walkTo(20.5), settle()]).take;
      const g2 = restX(t2);
      return [
        [...cross, walkTo(12.5), settle()],
        [...climb, walkTo(20.5), settle()],
        [...climb, hopOnto(g2, { d: 2.5 }), leap(), walkTo(27)],
      ];
    },
  },
];

for (const { level, takes, plan } of CAMPAIGNS) {
  const L = LEVELS[level];
  test(`${L.name} can actually be shot, in ${takes} take${takes > 1 ? 's' : ''}`, () => {
    const result = playCampaign(L, plan(L));
    assert.equal(result.st.ending, 'made',
      `${L.id}: ended "${result.st.ending}" at (${result.st.body.x.toFixed(2)}, ${result.st.body.y.toFixed(2)})`);
    assert.equal(result.st.cleared, true);
    assert.ok(takes <= L.takes,
      `${L.id} needs ${takes} takes but is budgeted ${L.takes}`);
  });
}

test('every level leaves slack in its take budget for a wasted take or two', () => {
  const needed = Object.fromEntries(CAMPAIGNS.map((c) => [LEVELS[c.level].id, c.takes]));
  for (const level of LEVELS) {
    assert.ok(level.takes >= needed[level.id] + 1,
      `${level.id}: budget ${level.takes} leaves no room over the ${needed[level.id]} needed`);
  }
});
