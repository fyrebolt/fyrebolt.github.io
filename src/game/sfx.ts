// ===== Tiny synth =====
//
// No audio files: every sound is a couple of oscillators and an envelope, which
// keeps the app a few hundred bytes heavier instead of a few hundred kilobytes.
// The context is created lazily on the first sound so we never open an
// AudioContext before a user gesture has happened.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface BlipOptions {
  from: number;
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  /** Slight detune on a second voice, in cents — thickens the tone. */
  fat?: number;
}

function blip({ from, to = from, dur = 0.12, type = 'sine', gain = 1, fat = 0 }: BlipOptions) {
  const ac = audio();
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  env.connect(master);

  const voices = fat ? [0, fat] : [0];
  for (const detune of voices) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    osc.connect(env);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

function noise(dur: number, gain: number, cutoff: number) {
  const ac = audio();
  if (!ac || !master || muted) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  const env = ac.createGain();
  env.gain.value = gain;
  src.connect(lp).connect(env).connect(master);
  src.start();
}

export const sfx = {
  setMuted(v: boolean) {
    muted = v;
  },
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
