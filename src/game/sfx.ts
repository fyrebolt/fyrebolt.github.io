// ===== Drift's sounds =====
//
// The oscillators and envelopes live in `src/utils/synth.ts`; this file is only
// the catalogue — which shape each event in the game makes.

import { blip, noise, setMuted } from '../utils/synth';

export const sfx = {
  setMuted,
  /** Rising ping; the pitch climbs with the combo so streaks sound like one. */
  collect(combo: number) {
    const step = Math.min(combo, 9) - 1;
    const base = 520 * Math.pow(2, step / 12);
    blip({ from: base, to: base * 1.5, dur: 0.13, type: 'triangle', gain: 0.5, fat: 7 });
  },
  hit() {
    blip({ from: 180, to: 42, dur: 0.34, type: 'sawtooth', gain: 0.55 });
    noise(0.24, 0.35, 1400);
  },
  warp() {
    blip({ from: 240, to: 880, dur: 0.3, type: 'square', gain: 0.22, fat: 12 });
  },
  wave() {
    blip({ from: 440, to: 880, dur: 0.22, type: 'triangle', gain: 0.4, fat: 9 });
  },
  over() {
    blip({ from: 320, to: 60, dur: 0.9, type: 'sawtooth', gain: 0.5, fat: 14 });
    noise(0.6, 0.3, 900);
  },
  start() {
    blip({ from: 320, to: 660, dur: 0.2, type: 'triangle', gain: 0.4 });
  },
};
