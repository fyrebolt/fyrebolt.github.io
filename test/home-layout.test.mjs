// Tests for src/home/layout.ts — how the home screen decides what fits.
//
// The bug these exist to prevent is a specific one: the home screen used to lay
// out every app in one column-pair and let the result run off the bottom of the
// iPad, taking the dock with it. Nothing scrolled, so the dock's apps were
// simply unreachable on a short window. The fix is that the grid is now sized
// from the space it has, and the overflow goes sideways onto another page — so
// what's worth asserting is that the capacity never claims more room than it
// was given, and that paging conserves every app exactly once.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  capacityFor,
  cellHeight,
  cellWidth,
  paginate,
  COL_GAP,
  ROW_GAP,
} from '../src/home/layout.ts';

/** The space a cols x rows grid of `tile`-sized icons actually occupies. */
function used({ cols, rows, tile }) {
  return {
    width: cols * cellWidth(tile) + (cols - 1) * COL_GAP,
    height: rows * cellHeight(tile) + (rows - 1) * ROW_GAP,
  };
}

// A spread of boxes: a roomy desktop frame, the portrait iPad at a laptop
// height, a phone, and two deliberately mean ones.
const BOXES = [
  [800, 700],
  [420, 380],
  [335, 535],
  [176, 125],
  [90, 80],
];

test('a page never asks for more room than it was given', () => {
  for (const [w, h] of BOXES) {
    const cap = capacityFor(w, h);
    const box = used(cap);
    assert.ok(
      box.width <= w || cap.cols === 1,
      `${w}x${h}: grid is ${box.width}px wide in a ${w}px box`,
    );
    assert.ok(
      box.height <= h || cap.rows === 1,
      `${w}x${h}: grid is ${box.height}px tall in a ${h}px box`,
    );
  }
});

test('every box holds at least one icon, so no page is empty', () => {
  for (const [w, h] of BOXES) {
    const cap = capacityFor(w, h);
    assert.ok(cap.cols >= 1 && cap.rows >= 1, `${w}x${h} produced ${cap.cols}x${cap.rows}`);
    assert.ok(cap.tile > 0);
  }
});

test('a roomy frame keeps the full-size icons', () => {
  assert.equal(capacityFor(800, 700).tile, 96);
});

test('a taller frame is never a smaller grid, once the icons stop resizing', () => {
  // Capacity is allowed to jump around while the frame is small enough that
  // the tile size is still changing — a bigger icon can mean fewer of them.
  // Once the full-size tile has won, though, growing the window may only ever
  // add rows.
  let prev = 0;
  for (let h = 340; h <= 1200; h += 20) {
    const cap = capacityFor(600, h);
    assert.equal(cap.tile, 96, `${h}px tall unexpectedly shrank the icons`);
    const perPage = cap.cols * cap.rows;
    assert.ok(perPage >= prev, `${h}px tall fits ${perPage}, but ${h - 20}px fit ${prev}`);
    prev = perPage;
  }
});

test('a cramped frame prefers more icons over bigger ones', () => {
  // Wide enough for two small tiles side by side, but nowhere near two rows.
  const cap = capacityFor(260, 130);
  assert.equal(cap.rows, 1);
  assert.equal(cap.cols, 2);
  assert.ok(cap.tile < 96, `expected a shrunken tile, got ${cap.tile}`);
});

test('paging keeps every app, once, in order', () => {
  const apps = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  for (const perPage of [1, 2, 3, 4, 6, 7, 9]) {
    const pages = paginate(apps, perPage);
    assert.deepEqual(pages.flat(), apps, `perPage=${perPage}`);
    assert.equal(pages.length, Math.ceil(apps.length / perPage));
    for (const page of pages) assert.ok(page.length <= perPage);
  }
});

test('paging survives a nonsense page size', () => {
  assert.deepEqual(paginate(['a', 'b'], 0), [['a'], ['b']]);
  assert.deepEqual(paginate([], 4), [[]]);
});
