// ===== Doomscroll's sounds =====
//
// The oscillators and envelopes live in `src/utils/synth.ts`; this file is only
// the catalogue. The one that matters is `tick`: a card boundary crossing the
// read line makes the same dry detent a notched wheel does, which is what turns
// an abstract number on screen into something your hand can feel.

import { blip, noise, setMuted } from '../utils/synth';

export const sfx = {
  setMuted,
  /** A card edge crossed the read line. Quiet on purpose — it fires a lot. */
  tick() {
    blip({ from: 1250, to: 900, dur: 0.028, type: 'square', gain: 0.055 });
  },
  /** A post banked; the pitch climbs with the combo so a streak sounds like one. */
  read(combo: number) {
    const step = Math.min(combo, 9) - 1;
    const base = 560 * Math.pow(2, step / 12);
    blip({ from: base, to: base * 1.5, dur: 0.14, type: 'triangle', gain: 0.5, fat: 7 });
  },
  /** Bait kept you. */
  hooked() {
    blip({ from: 200, to: 46, dur: 0.36, type: 'sawtooth', gain: 0.55 });
    noise(0.26, 0.35, 1300);
  },
  /** An ad has taken the feed. */
  ad() {
    blip({ from: 150, to: 150, dur: 0.42, type: 'square', gain: 0.16, fat: 22 });
  },
  quirk() {
    blip({ from: 240, to: 880, dur: 0.3, type: 'square', gain: 0.22, fat: 12 });
  },
  wave() {
    blip({ from: 440, to: 880, dur: 0.22, type: 'triangle', gain: 0.4, fat: 9 });
  },
  over() {
    blip({ from: 300, to: 58, dur: 0.9, type: 'sawtooth', gain: 0.5, fat: 14 });
    noise(0.6, 0.3, 900);
  },
  start() {
    blip({ from: 300, to: 640, dur: 0.2, type: 'triangle', gain: 0.4 });
  },
};
