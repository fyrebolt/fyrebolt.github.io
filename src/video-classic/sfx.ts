// ===== Procedural sound effects (Web Audio) =====
//
// All original, synthesized on the fly — no external files, no downloads, no
// copyrighted samples. One output GainNode the caller routes to the speakers
// and/or the export recording stream. Works on a normal AudioContext (live) or
// an OfflineAudioContext (tests).

export type SfxKind = 'entrance' | 'riffle' | 'key' | 'whoosh' | 'pencil';

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

  /** `gain` scales an individual hit (used to make the backspace key louder). */
  trigger(kind: SfxKind, when = this.ctx.currentTime, gain = 1): void {
    if (kind === 'entrance') this.entrance(when);
    else if (kind === 'riffle') this.riffle(when);
    else if (kind === 'whoosh') this.whoosh(when, gain);
    else if (kind === 'pencil') this.pencil(when, gain);
    else this.key(when, gain);
  }

  /**
   * One grain of pencil-on-paper: a short band of filtered noise with a soft
   * attack, its centre frequency jittered so a stream of grains reads as the
   * continuous scratch of graphite dragging across paper. Fire repeatedly (a few
   * per second) for the length of a sketch's animation.
   */
  private pencil(t: number, gain = 1): void {
    const ctx = this.ctx;
    const src = this.noiseSource();
    // gritty texture: high-pass to thin it, band-pass to give it a "paper tooth" colour
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600 + Math.random() * 2200;
    bp.Q.value = 0.6 + Math.random() * 0.5;
    const g = ctx.createGain();
    const dur = 0.05 + Math.random() * 0.05;
    const amp = (0.06 + Math.random() * 0.05) * gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(bp).connect(g).connect(this.output);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Zoom transition: a pitch-swept filtered-noise whoosh with a volume swell. */
  private whoosh(t: number, gain = 1): void {
    const ctx = this.ctx;
    const src = this.noiseSource();
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    // sweep up then settle — reads as a fast "vwoom"
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.36);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * gain, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    src.connect(bp).connect(g).connect(this.output);
    src.start(t);
    src.stop(t + 0.42);
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    return src;
  }

  /** A short plucked note (triangle fundamental + a little square body). */
  private pluck(freq: number, t: number, dur: number, amp: number): void {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this.output);

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.connect(env);
    o.start(t);
    o.stop(t + dur + 0.02);

    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = freq;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o2.connect(g2).connect(env);
    o2.start(t);
    o2.stop(t + dur + 0.02);
  }

  /** Banner lock: a short musical entrance — rising arpeggio into a bright chord. */
  private entrance(t: number): void {
    // C5 E5 G5 C6 arpeggio
    const arp = [523.25, 659.25, 783.99, 1046.5];
    const step = 0.085;
    arp.forEach((f, i) => this.pluck(f, t + i * step, 0.22, 0.42));
    // bright resolving chord (C6 E6 G6) + a sparkle
    const chordT = t + arp.length * step;
    [1046.5, 1318.5, 1568.0].forEach((f) => this.pluck(f, chordT, 0.5, 0.26));
    this.pluck(2093.0, chordT + 0.02, 0.42, 0.18);
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
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(hp).connect(bp).connect(g).connect(this.output);
    src.start(t);
    src.stop(t + 0.06);
  }

  /**
   * Mechanical keyboard click: ONE tight noise burst (so it stays a single
   * click at any volume — `gain` just scales it up, never splits into two) plus
   * a crisp high snap that overlaps it.
   */
  private key(t: number, gain = 1): void {
    const ctx = this.ctx;

    const n = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100 + Math.random() * 400;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * gain, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    n.connect(hp).connect(bp).connect(g).connect(this.output);
    n.start(t);
    n.stop(t + 0.03);

    // crisp high 'snap', fully overlapping the burst
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 2600 + Math.random() * 250;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.16 * gain, t + 0.001);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    o.connect(og).connect(this.output);
    o.start(t);
    o.stop(t + 0.02);
  }
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
