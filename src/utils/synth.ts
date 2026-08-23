// ===== Tiny synth =====
//
// No audio files anywhere on the site: every sound in every app is a couple of
// oscillators and an envelope, which costs a few hundred bytes instead of a few
// hundred kilobytes. The context is created lazily on the first sound, so we
// never open an AudioContext before a user gesture has happened.
//
// Only one app is ever loaded on a page, so the master gain and the mute flag
// are module-level: each game keeps its own *catalogue* of sounds (see
// `src/game/sfx.ts`, `src/feed/sfx.ts`) and shares the plumbing.

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

export function setMuted(v: boolean) {
  muted = v;
}

export interface BlipOptions {
  from: number;
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  /** Slight detune on a second voice, in cents — thickens the tone. */
  fat?: number;
}

export function blip({
  from,
  to = from,
  dur = 0.12,
  type = 'sine',
  gain = 1,
  fat = 0,
}: BlipOptions) {
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

export function noise(dur: number, gain: number, cutoff: number) {
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
