// ===== Timeline markers: named points on the output clock =====
//
// A marker is a labelled instant used to note a beat, a chapter, or a spot to
// come back to. It draws nothing into the video and never affects the render —
// it is purely an editing aid, which is why it lives on the Project next to the
// layers rather than as a Layer kind of its own (it has no z, no span, and no
// draw function).
//
// `t` is OUTPUT seconds, the same clock every overlay layer is timed on. That
// means a marker sits at a fixed point of the FINISHED video, and — exactly like
// every caption, sticker, and sketch — it slides when something upstream changes
// the output length (a banner freeze, a Time Machine warp, a clip trim). This is
// deliberate: markers are placed against what you see in the preview.
//
// Beyond the visible pins, markers feed two things: the temporal snap engine
// (drag a layer edge onto a marker) and prev/next playhead navigation.

/** A labelled instant on the output timeline. */
export interface Marker {
  id: string;
  /** Position in OUTPUT seconds. */
  t: number;
  /** Short human label shown on the pin and in the markers list. May be empty. */
  label: string;
  /** Pin colour (hex) — lets a project separate e.g. beats from chapters. */
  color: string;
}

/** Palette offered in the marker panel. New markers cycle through it in order,
 *  so a run of quickly-added markers is visually distinguishable by default. */
export const MARKER_COLORS = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#c77dff', '#ff9f1c'];

/** Longest label a pin will store — beyond this the list becomes unreadable. */
export const MARKER_LABEL_MAX = 40;

let uid = 0;

/**
 * A new marker at `t`. `index` is used only to pick the next palette colour, so
 * passing the current marker count gives a rotating palette; the label defaults
 * to a 1-based ordinal that the user can overwrite.
 */
export function createMarker(t: number, index = 0, overrides: Partial<Marker> = {}): Marker {
  uid += 1;
  return {
    id: `mk-${Date.now().toString(36)}-${uid}`,
    t: Math.max(0, t),
    label: `Marker ${index + 1}`,
    color: MARKER_COLORS[index % MARKER_COLORS.length],
    ...overrides,
  };
}

/** Markers ordered by time (stable copy — never mutates the input). */
export function sortedMarkers(markers: Marker[]): Marker[] {
  return markers.slice().sort((a, b) => a.t - b.t);
}

/** How close (seconds) two markers may sit before "add" is treated as a duplicate. */
const DUP_EPS = 0.02;

/** True when a marker already sits (within a frame or so) at `t`. */
export function markerAt(markers: Marker[], t: number): Marker | null {
  return markers.find((m) => Math.abs(m.t - t) <= DUP_EPS) ?? null;
}

/**
 * The next marker strictly after `t` (dir 1) or strictly before it (dir -1), or
 * null when there is none in that direction. "Strictly" so repeated presses walk
 * the list instead of sticking on the marker the playhead is parked on.
 */
export function stepMarker(markers: Marker[], t: number, dir: 1 | -1): Marker | null {
  const sorted = sortedMarkers(markers);
  if (dir === 1) return sorted.find((m) => m.t > t + DUP_EPS) ?? null;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].t < t - DUP_EPS) return sorted[i];
  return null;
}
