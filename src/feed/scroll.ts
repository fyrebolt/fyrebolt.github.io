// ===== Scroll input: the game takes the wheel, then hands it back quirked ====
//
// Three devices, one number. A wheel notch, a finger drag and an arrow key all
// arrive here as a distance down the feed, immediately divided by the
// viewport's on-screen height so that everyone downstream is talking about *a
// fraction of the screen* rather than a count of pixels. Nothing here knows
// what a card is, and nothing here interprets: it accumulates, and quirks.ts
// gets to lie about the total afterwards.
//
// The engine also needs to know whether that distance is still arriving, which
// is what `live` and `held` are for. A feed that keeps travelling after your
// hand stops is the entire feel of the thing, so "no input this frame" is a
// real signal, not the absence of one.

/** Per-event distance ceiling, in feed units. Kills trackpad and alt-tab spikes. */
const MAX_STEP = 0.35;

/** How far one arrow key and one page key travel, in feed units. */
const KEY_STEP = 0.09;
const PAGE_STEP = 0.42;

/** Assumed pixel height of a wheel "line" and, failing that, a "page". */
const LINE_PX = 16;

export interface ScrollReading {
  /** Distance accumulated since the last call, units. Positive = down the feed. */
  d: number;
  /** Did anything arrive in this window? False means the feed is coasting. */
  live: boolean;
  /** Is a finger or button still down? Held is live even when it isn't moving. */
  held: boolean;
}

export interface ScrollInput {
  consume(): ScrollReading;
  destroy(): void;
}

export interface ScrollOptions {
  /** Current viewport height in CSS pixels — the unit distances are divided by. */
  unitScale: () => number;
  /** Only accumulate while this is true, so a paused feed can't be nudged. */
  enabled: () => boolean;
}

export function createScrollInput(
  el: HTMLElement,
  { unitScale, enabled }: ScrollOptions,
): ScrollInput {
  let acc = 0;
  let touched = false;
  let held = false;
  let dragFrom: number | null = null;
  let pointerId: number | null = null;

  const push = (px: number) => {
    const s = Math.max(1, unitScale());
    acc += clamp(px / s, -MAX_STEP, MAX_STEP);
    touched = true;
  };

  const onWheel = (e: WheelEvent) => {
    // Always swallow the event: the feed is the scroller here, and letting the
    // page take a share would scroll the app shell out from under the game.
    e.preventDefault();
    if (!enabled()) return;
    const factor = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? unitScale() : 1;
    push(e.deltaY * factor);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!enabled() || pointerId !== null) return;
    pointerId = e.pointerId;
    dragFrom = e.clientY;
    held = true;
    touched = true;
    el.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || dragFrom === null) return;
    // Dragging *up* travels *down* the feed, the way every feed on every phone
    // has worked since they stopped putting scrollbars on things.
    push(-(e.clientY - dragFrom));
    dragFrom = e.clientY;
  };

  const endDrag = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    el.releasePointerCapture?.(e.pointerId);
    pointerId = null;
    dragFrom = null;
    held = false;
  };

  const onKey = (e: KeyboardEvent) => {
    if (!enabled()) return;
    const step =
      e.key === 'ArrowDown'
        ? KEY_STEP
        : e.key === 'ArrowUp'
          ? -KEY_STEP
          : e.key === 'PageDown'
            ? PAGE_STEP
            : e.key === 'PageUp'
              ? -PAGE_STEP
              : 0;
    if (!step) return;
    e.preventDefault();
    acc += step;
    touched = true;
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', onKey);

  return {
    consume() {
      const r: ScrollReading = { d: acc, live: touched || held, held };
      acc = 0;
      touched = false;
      return r;
    },

    destroy() {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('keydown', onKey);
    },
  };
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
