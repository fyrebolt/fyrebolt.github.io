// ===== Retake's sounds =====
//
// The oscillators and envelopes live in `src/utils/synth.ts`; this file is only
// the catalogue — which shape each event on the stage makes. Nothing here is a
// sample: there are no audio files anywhere in the site.

import { blip, noise, setMuted } from '../utils/synth';

export const sfx = {
  setMuted,
  jump() {
    blip({ from: 300, to: 560, dur: 0.1, type: 'triangle', gain: 0.28 });
  },
  land() {
    blip({ from: 150, to: 90, dur: 0.07, type: 'sine', gain: 0.22 });
  },
  /** The clapperboard: two woodblock knocks, the sound a take starts on. */
  slate() {
    blip({ from: 900, to: 300, dur: 0.06, type: 'square', gain: 0.32 });
    noise(0.05, 0.3, 4000);
  },
  /** "Cut." A short, flat, deliberate stop. */
  cut() {
    blip({ from: 420, to: 180, dur: 0.16, type: 'square', gain: 0.3, fat: 6 });
  },
  died() {
    blip({ from: 260, to: 50, dur: 0.4, type: 'sawtooth', gain: 0.42 });
    noise(0.26, 0.3, 1100);
  },
  /** Hitting the mark. */
  made() {
    blip({ from: 520, to: 784, dur: 0.16, type: 'triangle', gain: 0.42, fat: 7 });
    window.setTimeout(
      () => blip({ from: 784, to: 1046, dur: 0.28, type: 'triangle', gain: 0.38, fat: 9 }),
      130,
    );
  },
  /** A whole shot in the can. */
  wrap() {
    blip({ from: 392, to: 587, dur: 0.18, type: 'triangle', gain: 0.4, fat: 8 });
    window.setTimeout(
      () => blip({ from: 587, to: 880, dur: 0.4, type: 'triangle', gain: 0.4, fat: 12 }),
      150,
    );
  },
  outOfTakes() {
    blip({ from: 300, to: 70, dur: 0.7, type: 'sawtooth', gain: 0.45, fat: 10 });
  },
};
