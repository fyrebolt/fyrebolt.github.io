// ===== The console's command language =====
//
// Drift has a prompt behind ⌘K. Nothing in the interface mentions it, nothing
// lists what it accepts, and that is deliberate — the whole point of a cheat
// code is that somebody told you.
//
// The parsing lives here, apart from the box that draws it, because what a
// command *does* is worth testing and a blinking caret isn't.

import { HARD_WARPS, WARP_BY_ID } from './warps';

export type LineKind = 'in' | 'ok' | 'err' | 'dim';

export interface Line {
  kind: LineKind;
  text: string;
}

/** Everything the console can toggle. One flag, so far. */
export interface CheatState {
  /** Bench the four direction-lying warps from the next run onward. */
  yolo: boolean;
}

export const NO_CHEATS: CheatState = { yolo: false };

export interface ExecResult {
  state: CheatState;
  out: Line[];
}

/**
 * Fold a typed line down to something comparable.
 *
 * Smart-quote substitution turns `--yolo` into `—yolo` in a lot of places
 * between a chat window and this box, so the em- and en-dashes are folded back
 * to hyphens. Somebody who was told the code should not fail on their keyboard.
 */
export function normalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ');
}

const benchedNames = () => HARD_WARPS.map((id) => WARP_BY_ID[id].name.toLowerCase()).join(' · ');

/**
 * Run one line. Pure: it takes the current flags and returns the next ones
 * plus what the box should print.
 */
export function execute(raw: string, state: CheatState): ExecResult {
  const cmd = normalise(raw);
  const echo: Line = { kind: 'in', text: raw.trim() };

  if (!cmd) return { state, out: [] };

  if (cmd === '--yolo' || cmd === '-yolo') {
    const yolo = !state.yolo;
    return {
      state: { ...state, yolo },
      out: yolo
        ? [
            echo,
            { kind: 'ok', text: 'yolo' },
            { kind: 'dim', text: `${benchedNames()} — benched` },
            { kind: 'dim', text: 'takes effect on the next run' },
            { kind: 'dim', text: "scores from benched runs aren't banked" },
          ]
        : [echo, { kind: 'ok', text: 'yolo off' }, { kind: 'dim', text: 'full catalogue restored' }],
    };
  }

  // Asking the prompt what it accepts is not how this is supposed to go.
  if (cmd === 'help' || cmd === '?' || cmd === 'man' || cmd === 'ls') {
    return { state, out: [echo, { kind: 'dim', text: 'no.' }] };
  }

  return { state, out: [echo, { kind: 'err', text: `command not found: ${raw.trim()}` }] };
}

/** The line the box opens on, so an armed flag isn't a secret from its owner. */
export function statusLines(state: CheatState): Line[] {
  return state.yolo ? [{ kind: 'dim', text: 'yolo: armed' }] : [];
}
