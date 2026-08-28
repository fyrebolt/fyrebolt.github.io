// Tests for src/game/cheats.ts and the warp-eligibility rule it drives.
//
// The console is deliberately undiscoverable, which means nobody is going to
// find a broken one by accident: there is no button that stops working and no
// screen that looks wrong. So the parsing and the consequence are both pinned
// here — that the code is recognised the way somebody would actually type it,
// and that arming it really does take the four hardest warps out of the pool
// without emptying that pool or touching anything else.
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

const { execute, normalise, statusLines, NO_CHEATS } = await import('../src/game/cheats.ts');
const { WARPS, WARP_BY_ID, HARD_WARPS, eligibleWarps } = await import('../src/game/warps.ts');

const ids = (list) => list.map((w) => w.id).sort();
const set = (...xs) => new Set(xs);

// ===== The command =====

test('--yolo arms the flag, and entering it again disarms it', () => {
  const on = execute('--yolo', NO_CHEATS);
  assert.equal(on.state.yolo, true);
  const off = execute('--yolo', on.state);
  assert.equal(off.state.yolo, false);
});

test('the code is recognised however it was realistically typed', () => {
  // Copied out of a chat window, shouted, or padded with spaces.
  for (const raw of ['--yolo', '  --yolo  ', '--YOLO', '--Yolo\t', '—yolo', '–yolo']) {
    assert.equal(execute(raw, NO_CHEATS).state.yolo, true, `${JSON.stringify(raw)} should arm`);
  }
});

test('near-misses are not the code', () => {
  for (const raw of ['yolo', '--yol', '--yoloo', 'yolo --', '--yolo --yolo', 'yo lo']) {
    assert.equal(execute(raw, NO_CHEATS).state.yolo, false, `${JSON.stringify(raw)} should not arm`);
  }
});

test('an unknown command is refused, and says what it refused', () => {
  const r = execute('sudo win', NO_CHEATS);
  assert.equal(r.state.yolo, false);
  const err = r.out.find((l) => l.kind === 'err');
  assert.ok(err, 'an unknown command should print an error');
  assert.match(err.text, /command not found/);
  assert.match(err.text, /sudo win/, 'and echo what was typed');
});

test('an empty line prints nothing at all', () => {
  const r = execute('   ', NO_CHEATS);
  assert.deepEqual(r.out, []);
  assert.equal(r.state, NO_CHEATS, 'and changes nothing');
});

test('the prompt refuses to explain itself', () => {
  // The whole conceit is that somebody told you. A help listing would give it
  // away to anyone who opened the box by accident.
  for (const raw of ['help', '?', 'man', 'ls']) {
    const out = execute(raw, NO_CHEATS).out.map((l) => l.text).join(' ');
    assert.ok(!/yolo/i.test(out), `${raw} must not name the code`);
  }
});

test('arming echoes what it benched, and warns the score will not count', () => {
  const out = execute('--yolo', NO_CHEATS).out.map((l) => l.text).join(' ').toLowerCase();
  for (const id of HARD_WARPS) {
    assert.match(out, new RegExp(WARP_BY_ID[id].name.toLowerCase()), `should name ${id}`);
  }
  assert.match(out, /next run/, 'and say when it applies');
  assert.match(out, /bank|score/, 'and that a benched run is not a record');
});

test('an armed flag is shown when the box is opened, not hidden from its owner', () => {
  assert.deepEqual(statusLines({ yolo: false }), []);
  assert.equal(statusLines({ yolo: true }).length, 1);
});

test('normalise folds case, padding and dash flavours', () => {
  assert.equal(normalise('  --YoLo '), '--yolo');
  assert.equal(normalise('a   b'), 'a b');
});

// ===== The consequence =====

test('yolo benches exactly mirror, flip, swap and spin', () => {
  assert.deepEqual([...HARD_WARPS].sort(), ['flip', 'mirror', 'spin', 'swap']);
});

test('every benched warp is a real warp, and a direction-lying one', () => {
  for (const id of HARD_WARPS) {
    const def = WARP_BY_ID[id];
    assert.ok(def, `${id} is not in the catalogue`);
    // The point of the set is that these break which way "right" is. The ones
    // left behind change the physics but not the mapping.
    assert.equal(def.kind, 'transform', `${id} should be a transform`);
  }
});

test('with yolo armed the scheduler can never draw a benched warp', () => {
  const benched = set(...HARD_WARPS);
  // Try it against every reachable combination of already-active warps.
  const all = WARPS.map((w) => w.id);
  for (let mask = 0; mask < 1 << all.length; mask++) {
    const active = set(...all.filter((_, i) => mask & (1 << i)));
    for (const w of eligibleWarps(active, benched)) {
      assert.ok(!benched.has(w.id), `${w.id} slipped through with active=${[...active]}`);
      assert.ok(!active.has(w.id), `${w.id} was already running`);
    }
  }
});

test('benching four warps still leaves the scheduler something to play', () => {
  const left = eligibleWarps(set(), set(...HARD_WARPS));
  assert.ok(left.length >= 4, `only ${left.length} warps left — the run would go quiet`);
  assert.deepEqual(ids(left), ['ice', 'syrup', 'tide', 'wells', 'zoom'].sort());
});

test('the remaining warps can still fill every slot the game asks for', () => {
  // The scheduler runs up to three at once; with the hard four benched there
  // must still be a legal trio, or late waves would stall.
  const benched = set(...HARD_WARPS);
  const active = set();
  for (let i = 0; i < 3; i++) {
    const next = eligibleWarps(active, benched)[0];
    assert.ok(next, `could not fill slot ${i + 1}`);
    active.add(next.id);
  }
  assert.equal(active.size, 3);
});

test('without a bench the pool is the whole catalogue', () => {
  assert.deepEqual(ids(eligibleWarps(set())), ids(WARPS));
});

test('eligibility still honours mutual exclusions, benched or not', () => {
  // Spin and Swap contradict each other; so do Ice and Syrup.
  assert.ok(!ids(eligibleWarps(set('spin'))).includes('swap'));
  assert.ok(!ids(eligibleWarps(set('swap'))).includes('spin'));
  assert.ok(!ids(eligibleWarps(set('ice'))).includes('syrup'));
  assert.ok(!ids(eligibleWarps(set('syrup'), set(...HARD_WARPS))).includes('ice'));
});
