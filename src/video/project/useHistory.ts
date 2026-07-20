// ===== General snapshot-based undo/redo history =====
//
// A deliberately GENERAL history: it observes a single immutable snapshot of the
// whole project and records a stack of past/future snapshots. Because it watches
// the *result* state (not individual call sites) it cannot "miss a case" — every
// mutation that produces a new snapshot is captured, including deletes, adds,
// transforms, timeline drags, property edits, and output-setting changes.
//
// Coalescing keeps the stack meaningful:
//   - Continuous edits (dragging a handle, typing in a field, sliders) arrive as
//     a rapid burst and are merged into ONE entry via a trailing debounce.
//   - Discrete one-shot actions (add layer, delete, commit a sketch stroke, add a
//     keyframe…) call `sealDiscrete()` just before mutating, so each becomes its
//     own entry and never merges with neighbouring edits.
//
// The live snapshot is derived by the caller (a stable object whose fields change
// on mutation); `restore` applies a snapshot back through the caller's setters.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface HistoryApi {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Call immediately BEFORE a discrete mutation so it commits as its own entry. */
  sealDiscrete: () => void;
}

interface Options<S> {
  /** Current live snapshot (a new object whenever any tracked field changes). */
  live: S;
  /** Apply a snapshot back to component state. */
  restore: (snapshot: S) => void;
  /** Field-wise equality — true when two snapshots represent the same project. */
  equal: (a: S, b: S) => boolean;
  /** Trailing-merge window for continuous edit bursts (ms). */
  debounceMs?: number;
  /** Maximum retained undo depth. */
  cap?: number;
}

export function useHistory<S>({
  live,
  restore,
  equal,
  debounceMs = 350,
  cap = 100,
}: Options<S>): HistoryApi {
  const liveRef = useRef(live);
  const baselineRef = useRef(live); // last settled snapshot (== live when idle)
  const undoRef = useRef<S[]>([]);
  const redoRef = useRef<S[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoringRef = useRef(false);
  const sealNextRef = useRef(false);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncFlags = useCallback(() => {
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
  }, []);

  /** Push the current baseline onto the undo stack and advance the baseline. */
  const commit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    undoRef.current.push(baselineRef.current);
    if (undoRef.current.length > cap) undoRef.current.shift();
    redoRef.current = [];
    baselineRef.current = liveRef.current;
    syncFlags();
  }, [cap, syncFlags]);

  /** If a debounced burst is pending, seal it now (so it is its own entry). */
  const flushPending = useCallback(() => {
    if (timerRef.current) commit();
  }, [commit]);

  // Observe snapshot changes. Runs only when `live` actually changes identity.
  useEffect(() => {
    liveRef.current = live;

    // Our own restore() produced this change — adopt it as the new baseline.
    if (restoringRef.current) {
      restoringRef.current = false;
      baselineRef.current = live;
      return;
    }
    // No real change from the settled baseline (e.g. a no-op edit).
    if (equal(live, baselineRef.current)) return;

    if (sealNextRef.current) {
      sealNextRef.current = false;
      commit(); // discrete action → seal immediately as its own entry
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(commit, debounceMs);
    }
  }, [live, equal, commit, debounceMs]);

  const sealDiscrete = useCallback(() => {
    // Seal any in-flight burst first so this action can't merge with it, then
    // mark the next observed change to commit on its own.
    flushPending();
    sealNextRef.current = true;
  }, [flushPending]);

  const undo = useCallback(() => {
    flushPending();
    const prev = undoRef.current.pop();
    if (prev === undefined) return;
    redoRef.current.push(liveRef.current);
    restoringRef.current = true;
    baselineRef.current = prev;
    restore(prev);
    syncFlags();
  }, [flushPending, restore, syncFlags]);

  const redo = useCallback(() => {
    flushPending();
    const next = redoRef.current.pop();
    if (next === undefined) return;
    undoRef.current.push(liveRef.current);
    restoringRef.current = true;
    baselineRef.current = next;
    restore(next);
    syncFlags();
  }, [flushPending, restore, syncFlags]);

  return { canUndo, canRedo, undo, redo, sealDiscrete };
}
