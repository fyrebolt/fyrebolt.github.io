// ===== Home-screen page layout =====
//
// The home screen never scrolls vertically: the dock has to stay reachable at
// the bottom of the frame on every screen, exactly like a real iPad. So rather
// than letting the grid grow until it pushes the dock out of the display, we
// measure the space the grid actually has and ask how many icons fit inside
// it. Whatever doesn't fit spills onto the next page, one swipe to the right.
//
// The math lives here, apart from React, because it is the part that decides
// whether the dock is visible — worth being able to test directly.

export interface GridCapacity {
  /** Icons per row. */
  cols: number;
  /** Rows per page. */
  rows: number;
  /** Icon tile size, shrunk on cramped frames so a real grid still fits. */
  tile: number;
}

/** Tile sizes we're willing to draw, largest first. */
const TILE_SIZES = [96, 84, 72, 60];

/** Space between icons. */
export const COL_GAP = 40;
export const ROW_GAP = 28;

/** Room a label needs beside/below its tile. */
const LABEL_WIDTH = 26;
const LABEL_HEIGHT = 28;

/** More than four across stops reading as an iPad home screen. */
const MAX_COLS = 4;

/** A cell is the tile plus the room its label needs. */
export const cellWidth = (tile: number) => tile + LABEL_WIDTH;
export const cellHeight = (tile: number) => tile + LABEL_HEIGHT;

/** How many `cell`-sized things fit in `span`, separated by `gap`. */
const fits = (span: number, cell: number, gap: number) =>
  Math.floor((span + gap) / (cell + gap));

const capacityAt = (tile: number, width: number, height: number): GridCapacity => ({
  cols: Math.min(MAX_COLS, fits(width, cellWidth(tile), COL_GAP)),
  rows: fits(height, cellHeight(tile), ROW_GAP),
  tile,
});

/**
 * The biggest grid that fits in a `width` x `height` box. Prefers the largest
 * tile that still gives a proper grid (at least 2x2). On a frame too cramped
 * for that it stops caring about tile size and takes whichever size holds the
 * most icons per page, so a short window pages twice rather than fourteen
 * times — but never fewer than one icon, since a page has to hold something.
 */
export function capacityFor(width: number, height: number): GridCapacity {
  for (const tile of TILE_SIZES) {
    const cap = capacityAt(tile, width, height);
    if (cap.cols >= 2 && cap.rows >= 2) return cap;
  }
  let best: GridCapacity = { cols: 1, rows: 1, tile: TILE_SIZES[TILE_SIZES.length - 1] };
  let bestPerPage = 0;
  for (const tile of TILE_SIZES) {
    const cap = capacityAt(tile, width, height);
    const perPage = cap.cols * cap.rows;
    // Largest tile first, so a tie keeps the bigger icons.
    if (perPage > bestPerPage) {
      best = cap;
      bestPerPage = perPage;
    }
  }
  return bestPerPage > 0 ? best : { cols: 1, rows: 1, tile: TILE_SIZES[TILE_SIZES.length - 1] };
}

/** Split `items` into pages of at most `perPage`. Always at least one page. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length ? pages : [[]];
}
