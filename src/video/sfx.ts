// ===== Procedural sound effects (Web Audio) =====
//
// All original, synthesized on the fly — no external files, no downloads, no
// copyrighted samples. One output GainNode the caller routes to the speakers
// and/or the export recording stream. Works on a normal AudioContext (live) or
// an OfflineAudioContext (tests).

export type SfxKind = 'slash' | 'riffle' | 'key';

export class SfxEngine {
  /** Route this to ctx.destination (monitoring) and/or a MediaStreamDestination (export). */
  readonly output: GainNode;
  private ctx: BaseAudioContext;
  private noise: AudioBuffer;

  constructor(ctx: BaseAudioContext, volume = 0.5) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = volume;
    this.noise = makeNoise(ctx);
  }

  setVolume(v: number): void {
    // Set directly (no ramp) so it tracks the slider without zipper noise on triggers.
    this.output.gain.value = Math.max(0, v);
  }

  trigger(kind: SfxKind, when = this.ctx.currentTime): void {
    if (kind === 'slash') this.slash(when);
    else if (kind === 'riffle') this.riffle(when);
    else this.key(when);
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    return src;
  }

  /** Banner entrance: a fast noise whoosh sweeping up, with a short metallic ring. */
  private slash(t: number): void {
    const ctx = this.ctx;
    const src = this.noiseSource();
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(bp).connect(g).connect(this.output);
    src.start(t);
    src.stop(t + 0.3);

    // metallic ring / impact tail at the lock
    [1250, 2500, 3750].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t + 0.04);
      og.gain.exponentialRampToValueAtTime(0.22 / (i + 1), t + 0.07);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
      o.connect(og).connect(this.output);
      o.start(t + 0.04);
      o.stop(t + 0.4);
    });
  }

  /** Font boil: a short filtered noise flick — one per font change reads as riffling. */
  private riffle(t: number): void {
    const ctx = this.ctx;
    const src = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + Math.random() * 1800; // vary so it doesn't sound like one repeated tick
    bp.Q.value = 1.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(hp).connect(bp).connect(g).connect(this.output);
    src.start(t);
    src.stop(t + 0.06);
  }

  /** Typewriter: a mechanical key-click — a noise transient plus a low "thock". */
  private key(t: number): void {
    const ctx = this.ctx;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2000 + Math.random() * 700;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(bp).connect(g).connect(this.output);
    src.start(t);
    src.stop(t + 0.04);

    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = 170 + Math.random() * 40;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.5, t + 0.03);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.28, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(og).connect(this.output);
    o.start(t);
    o.stop(t + 0.06);
  }
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
