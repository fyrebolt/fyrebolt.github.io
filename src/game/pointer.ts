// ===== Pointer input: the game takes the cursor, then hands it back warped ==
//
// The whole premise needs the real cursor gone, so this uses the Pointer Lock
// API: while locked the OS pointer is hidden and pinned, and the browser hands
// us raw `movementX/Y` deltas instead of a position. The game integrates those
// deltas itself, which is what lets warps.ts sit in the middle and lie to you.
//
// Deltas are divided by the arena's on-screen height before anyone else sees
// them, so a movement is expressed as *a fraction of the arena* rather than a
// count of pixels. Sweeping the mouse across the arena always sweeps the arena,
// whether it is 400px tall in a phone-sized window or 900px on a big display.
//
// Lock is a nicety, not a requirement: without it (denied permission, touch,
// Safari quirks) we fall back to differencing client coordinates, which feeds
// the exact same pipeline. Only the "you cannot leave the arena" part is lost.

import type { Vec } from './types';

/** Per-event movement ceiling, in arena units. Kills alt-tab / warp spikes. */
const MAX_STEP = 0.3;

export interface PointerInput {
  /** Drain everything accumulated since the last call, in arena units. */
  consume(): Vec;
  /** Ask for pointer lock. Resolves to whether we actually got it. */
  lock(): Promise<boolean>;
  release(): void;
  isLocked(): boolean;
  destroy(): void;
}

export interface PointerOptions {
  /** Current arena height in CSS pixels — the unit the deltas are divided by. */
  unitScale: () => number;
  onLockChange: (locked: boolean) => void;
}

export function createPointerInput(
  el: HTMLElement,
  { unitScale, onLockChange }: PointerOptions,
): PointerInput {
  const acc: Vec = { x: 0, y: 0 };
  let locked = false;
  let last: Vec | null = null;
  let destroyed = false;

  const push = (dxPx: number, dyPx: number) => {
    const s = Math.max(1, unitScale());
    acc.x += clamp(dxPx / s, -MAX_STEP, MAX_STEP);
    acc.y += clamp(dyPx / s, -MAX_STEP, MAX_STEP);
  };

  const onMove = (e: PointerEvent) => {
    if (locked) {
      // Under lock, clientX/Y are frozen; movementX/Y is the only signal.
      push(e.movementX, e.movementY);
      return;
    }
    // Unlocked fallback: difference successive positions so the pipeline
    // downstream cannot tell which mode it is being fed from.
    if (last) push(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
  };

  const onLeave = () => {
    last = null;
  };

  const onLockChangeEvt = () => {
    const now = document.pointerLockElement === el;
    if (now === locked) return;
    locked = now;
    last = null;
    onLockChange(locked);
  };

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerlockchange', onLockChangeEvt);

  return {
    consume() {
      const d = { x: acc.x, y: acc.y };
      acc.x = 0;
      acc.y = 0;
      return d;
    },

    async lock() {
      if (destroyed || locked) return locked;
      // `unadjustedMovement` turns off OS mouse acceleration, which matters a
      // lot for a precision game — but it is not universally supported, and
      // some browsers reject the whole request rather than ignoring the flag.
      try {
        await requestLock(el, true);
      } catch {
        try {
          await requestLock(el, false);
        } catch {
          return false;
        }
      }
      return document.pointerLockElement === el;
    },

    release() {
      if (document.pointerLockElement === el) document.exitPointerLock();
    },

    isLocked() {
      return locked;
    },

    destroy() {
      destroyed = true;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerlockchange', onLockChangeEvt);
      if (document.pointerLockElement === el) document.exitPointerLock();
    },
  };
}

/** Older engines return undefined instead of a promise; normalise both. */
function requestLock(el: HTMLElement, unadjusted: boolean): Promise<void> {
  const req = el.requestPointerLock(unadjusted ? { unadjustedMovement: true } : undefined) as
    | Promise<void>
    | undefined;
  return req ?? Promise.resolve();
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
