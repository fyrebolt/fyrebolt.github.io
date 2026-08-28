// ===== The loop =====
//
// Everything real happens in `sim.ts`; this file only decides *when* to call
// it and what to draw afterwards. It owns three things the simulation must
// never touch: the animation frame, the keyboard, and the phase the shot is in
// (slate → rolling → cut → wrap).
//
// The clock is an accumulator, not a delta. Frames arrive at whatever rate the
// display runs at, and are spent in whole FIXED_DT steps; leftover time is
// carried to the next frame. So a 60 Hz monitor, a 144 Hz monitor and the test
// suite all advance the world identically — which they have to, because a take
// recorded on one machine is replayed step-for-step on the same one.

import { LEVELS } from './levels';
import { draw, shotAspect } from './render';
import { sfx } from './sfx';
import { bankTake, createSim, cutTake, elapsed, remaining, stepSim, type SimState } from './sim';
import { FIXED_DT, NO_INPUT, type Input, type Level, type Take } from './types';

/** What the shot is currently doing. */
export type Phase = 'slate' | 'rolling' | 'cut' | 'wrap' | 'out-of-takes';

export interface Hud {
  levelIndex: number;
  levelCount: number;
  levelName: string;
  hint: string;
  /** 1-based number of the take now rolling. */
  take: number;
  takes: number;
  ghosts: number;
  secondsLeft: number;
  phase: Phase;
  /** How the take that just finished ended. */
  ending: SimState['ending'];
  muted: boolean;
  /** Width/height of the composed shot, for the stage box. */
  aspect: number;
}

export interface EngineOptions {
  onHud: (hud: Hud) => void;
  startAt?: number;
}

/** A frame longer than this is a tab that was in the background, not slow play. */
const MAX_FRAME = 0.25;
/** How long the "cut" card sits before the next take rolls. */
const CUT_PAUSE = 0.85;
const WRAP_PAUSE = 1.4;

export function createEngine(canvas: HTMLCanvasElement, opts: EngineOptions) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Retake needs a 2D canvas');

  let levelIndex = opts.startAt ?? 0;
  let level: Level = LEVELS[levelIndex];
  let ghosts: Take[] = [];
  let sim: SimState = createSim(level, ghosts);
  let phase: Phase = 'slate';
  let phaseTimer = 0;
  let muted = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  const keys = { left: false, right: false, jump: false };
  const input = (): Input => (phase === 'rolling' ? keys : NO_INPUT);

  // --- HUD, pushed rather than polled, and only when it changes ---
  let hudKey = '';
  function pushHud(force = false) {
    const hud: Hud = {
      levelIndex,
      levelCount: LEVELS.length,
      levelName: level.name,
      hint: level.hint,
      take: ghosts.length + 1,
      takes: level.takes,
      ghosts: ghosts.length,
      secondsLeft: Math.ceil(remaining(sim)),
      phase,
      ending: sim.ending,
      muted,
      aspect: shotAspect(level),
    };
    const k = `${hud.levelIndex}|${hud.take}|${hud.phase}|${hud.secondsLeft}|${hud.ending}|${hud.muted}`;
    if (!force && k === hudKey) return;
    hudKey = k;
    opts.onHud(hud);
  }

  // --- Phase transitions ---
  function rollTake() {
    sim = createSim(level, ghosts);
    phase = 'rolling';
    phaseTimer = 0;
    sfx.slate();
    pushHud(true);
  }

  function endTake() {
    // Bank whatever was performed, so the next take can stand on it.
    const take = bankTake(sim);
    if (sim.ending === 'made') {
      phase = 'wrap';
      phaseTimer = 0;
      sfx.made();
    } else {
      ghosts = [...ghosts, take];
      if (ghosts.length >= level.takes) {
        phase = 'out-of-takes';
        phaseTimer = 0;
        sfx.outOfTakes();
      } else {
        phase = 'cut';
        phaseTimer = 0;
        if (sim.ending === 'died') sfx.died();
        else sfx.cut();
      }
    }
    pushHud(true);
  }

  function loadLevel(i: number) {
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    level = LEVELS[levelIndex];
    ghosts = [];
    sim = createSim(level, ghosts);
    phase = 'slate';
    phaseTimer = 0;
    pushHud(true);
  }

  /** Throw away every take and shoot the scene again from the top. */
  function reshoot() {
    ghosts = [];
    sim = createSim(level, ghosts);
    phase = 'slate';
    phaseTimer = 0;
    pushHud(true);
  }

  /** The one key that matters: end this take and keep what it performed. */
  function cut() {
    if (phase !== 'rolling') return;
    cutTake(sim);
    endTake();
  }

  /** Space/Enter: whatever "get on with it" means in the current phase. */
  function advance() {
    if (phase === 'slate') rollTake();
    else if (phase === 'cut') rollTake();
    else if (phase === 'out-of-takes') reshoot();
    else if (phase === 'wrap') {
      if (levelIndex + 1 < LEVELS.length) loadLevel(levelIndex + 1);
      else loadLevel(0);
    }
  }

  // --- The frame ---
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(MAX_FRAME, (now - last) / 1000 || 0);
    last = now;

    if (phase === 'rolling') {
      acc += dt;
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        const ev = stepSim(sim, input());
        if (ev.jumped) sfx.jump();
        else if (ev.landed) sfx.land();
        if (ev.ended) { endTake(); break; }
      }
    } else {
      acc = 0;
      phaseTimer += dt;
      if (phase === 'cut' && phaseTimer >= CUT_PAUSE) rollTake();
      else if (phase === 'wrap' && phaseTimer >= WRAP_PAUSE) {
        // Hold on the wrap card until the player moves on themselves; only the
        // last level loops, so finishing the game doesn't yank you elsewhere.
        phaseTimer = WRAP_PAUSE;
      }
    }

    render();
    pushHud();
  }

  function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    draw(ctx!, sim, { w, h, dpr });
  }

  // --- Keyboard ---
  function onKeyDown(e: KeyboardEvent) {
    if (e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': keys.left = true; e.preventDefault(); break;
      case 'ArrowRight': case 'd': case 'D': keys.right = true; e.preventDefault(); break;
      case 'ArrowUp': case 'w': case 'W': case ' ':
        keys.jump = true;
        e.preventDefault();
        if (phase !== 'rolling') advance();
        break;
      case 'Enter': advance(); e.preventDefault(); break;
      case 'r': case 'R': cut(); break;
      case 'Escape': reshoot(); break;
      default: break;
    }
  }
  function onKeyUp(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': keys.left = false; break;
      case 'ArrowRight': case 'd': case 'D': keys.right = false; break;
      case 'ArrowUp': case 'w': case 'W': case ' ': keys.jump = false; break;
      default: break;
    }
  }
  /** Losing focus mid-run would otherwise leave a key stuck down. */
  function onBlur() { keys.left = keys.right = keys.jump = false; }

  return {
    start() {
      if (running) return;
      running = true;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      last = performance.now();
      // Paint once up front rather than waiting on the first animation frame:
      // the stage is behind a slate card from the moment it appears, and a
      // frame of empty canvas behind it reads as a broken game.
      render();
      raf = requestAnimationFrame(frame);
      pushHud(true);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
    cut,
    advance,
    reshoot,
    loadLevel,
    setMuted(v: boolean) { muted = v; sfx.setMuted(v); pushHud(true); },
    /** Test seam: drive the world without an animation frame. */
    stepFor(seconds: number) {
      let t = seconds;
      while (t >= FIXED_DT && phase === 'rolling') {
        t -= FIXED_DT;
        const ev = stepSim(sim, input());
        if (ev.ended) { endTake(); break; }
      }
      render();
      pushHud();
    },
    press(k: 'left' | 'right' | 'jump', down: boolean) { keys[k] = down; },
    get phase() { return phase; },
    get elapsed() { return elapsed(sim); },
  };
}
