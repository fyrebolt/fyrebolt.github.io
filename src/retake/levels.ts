// ===== The shot list =====
//
// Levels are ASCII so they can be read, diffed and argued with in the editor
// rather than in a level tool. Every row must be the same width; the parser
// refuses anything else rather than quietly padding, because a ragged grid
// produces a level that is subtly wrong instead of obviously broken.
//
//   .  empty        #  solid        ^  spike (kills, not solid)
//   X  the mark     @  where every take begins
//
// Designed against one number: a standing jump rises about 2.6 tiles and
// clears about 5.7 horizontally. So a 3-tile shelf is impossible alone and
// possible standing on one past take (+0.9); a 4-tile shelf needs two, stacked.
// If you retune physics.ts, you have re-designed all of these at once.

import { Cell, PLAYER_H, PLAYER_W, type Level } from './types';

interface LevelSpec {
  id: string;
  name: string;
  hint: string;
  takes: number;
  seconds: number;
  rows: string[];
}

const SPECS: LevelSpec[] = [
  {
    id: 'establishing',
    name: 'Establishing Shot',
    hint: 'Arrows or A/D to move, Space to jump. Stand on the mark.',
    takes: 3,
    seconds: 30,
    rows: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..@......................X....',
      '##########^^^^################',
      '##############################',
      '##############################',
    ],
  },
  {
    id: 'second-take',
    name: 'Second Take',
    hint: 'That shelf is too high to reach alone. Press R to cut — your last take keeps playing, and you can stand on it.',
    takes: 4,
    seconds: 30,
    rows: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '.....................X........',
      '....................##########',
      '..............................',
      '..@...........................',
      '##############################',
      '##############################',
      '##############################',
    ],
  },
  {
    id: 'stunt-double',
    name: 'Stunt Double',
    hint: 'Each stand-in buys you exactly one storey. This is two storeys.',
    takes: 6,
    seconds: 30,
    rows: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..........................X...',
      '......................########',
      '..............................',
      '..............................',
      '..............#######.........',
      '..............................',
      '..@...........................',
      '##############################',
      '##############################',
      '##############################',
    ],
  },
  {
    id: 'continuity',
    name: 'Continuity',
    hint: 'The stand-in has to be on the far side of the pit. Which means crossing it every take.',
    takes: 5,
    seconds: 30,
    rows: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '.....................X........',
      '....................##########',
      '..............................',
      '..@...........................',
      '##########^^^^################',
      '##############################',
      '##############################',
    ],
  },
  {
    id: 'final-cut',
    name: 'Final Cut',
    hint: 'Everything at once. Take your time — a take you cut early still counts.',
    takes: 7,
    seconds: 30,
    rows: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..........................X...',
      '......................########',
      '..............................',
      '..............................',
      '...............#######........',
      '..............................',
      '..@...........................',
      '######^^^^####################',
      '##############################',
      '##############################',
    ],
  },
];

const CELL_OF: Record<string, Cell> = {
  '.': Cell.Empty,
  ' ': Cell.Empty,
  '#': Cell.Solid,
  '^': Cell.Spike,
  X: Cell.Mark,
};

/**
 * Turn one spec into a playable level.
 *
 * `@` is a cell, not a coordinate: the body is placed standing on the floor of
 * that cell and centred in it, so a spawn marker always means "here, on the
 * ground" no matter what the body's dimensions become later.
 */
export function parseLevel(spec: LevelSpec): Level {
  const h = spec.rows.length;
  const w = spec.rows[0]?.length ?? 0;
  if (!w || !h) throw new Error(`Level ${spec.id} is empty`);

  const cells = new Uint8Array(w * h);
  let spawn: { x: number; y: number } | null = null;
  let marks = 0;

  for (let y = 0; y < h; y++) {
    const row = spec.rows[y];
    if (row.length !== w) {
      throw new Error(`Level ${spec.id} row ${y} is ${row.length} wide, expected ${w}`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '@') {
        if (spawn) throw new Error(`Level ${spec.id} has more than one spawn`);
        spawn = { x: x + (1 - PLAYER_W) / 2, y: y + 1 - PLAYER_H };
        continue; // the spawn cell itself is empty
      }
      const cell = CELL_OF[ch];
      if (cell === undefined) {
        throw new Error(`Level ${spec.id} row ${y} has an unknown glyph ${JSON.stringify(ch)}`);
      }
      if (cell === Cell.Mark) marks++;
      cells[y * w + x] = cell;
    }
  }

  if (!spawn) throw new Error(`Level ${spec.id} has no spawn`);
  if (!marks) throw new Error(`Level ${spec.id} has no mark`);

  return {
    id: spec.id,
    name: spec.name,
    hint: spec.hint,
    w,
    h,
    cells,
    spawn,
    takes: spec.takes,
    seconds: spec.seconds,
  };
}

export const LEVELS: Level[] = SPECS.map(parseLevel);

export const cellAt = (level: Level, tx: number, ty: number): Cell =>
  tx < 0 || ty < 0 || tx >= level.w || ty >= level.h
    ? Cell.Empty
    : (level.cells[ty * level.w + tx] as Cell);
