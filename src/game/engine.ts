// ===== Drift: simulation =====
//
// One rAF loop owns everything: it drains the pointer, pushes the delta through
// the active warps, integrates a position, moves the hunters, resolves
// collisions, then hands the state to render.ts. React never sees a frame — it
// gets a throttled HUD snapshot and a per-frame number for the timer bar, so
// the game runs at display rate with no reconciliation in the hot path.

import { createPointerInput } from './pointer';
import { sfx } from './sfx';
import { draw, type View } from './render';
import { WARPS, WARP_BY_ID, transformDelta, type WarpDef, type WarpId } from './warps';
import { HUNTER_GRACE } from './types';
import type { GameState, HudSnapshot, Hunter, Orb, Vec } from './types';

// --- Tuning -----------------------------------------------------------------
// Everything is in arena units (the arena is 1.0 tall) and seconds.

const PLAYER_R = 0.02;
const ORB_R = 0.023;
const HUNTER_R = 0.027;

const START_TIME = 20;
const TIME_CAP = 26;
const ORB_TIME = 1.7;

const ORBS_PER_WAVE = 6;
const MAX_HUNTERS = 9;
const MAX_COMBO = 9;
const COMBO_WINDOW = 3.6;

const WARP_LIFE = 9.5;
const WARP_GAP = 1.8;

const TRAIL_LEN = 26;
const ICE_GAIN = 7;
const ICE_DRAG = 1.15;
const SYRUP_TAU = 0.22;
const TIDE_SPEED = 0.16;
const TIDE_TURN = 0.32;
const WELL_G = 0.012;
const WELL_CAP = 0.75;

const BEST_KEY = 'drift.best.v1';

export interface GameEvent {
  kind: 'warp' | 'wave' | 'hit' | 'over';
  warp?: WarpDef;
  wave?: number;
}

export interface GameHandle {
  /** Begin a fresh run (also grabs pointer lock — call from a user gesture). */
  start(): void;
  pause(): void;
  /** Resume a paused run, re-acquiring pointer lock. */
  resume(): void;
  destroy(): void;
  state(): GameState;
}

export interface GameOptions {
  onHud: (h: HudSnapshot) => void;
  /** Called every frame with the timer as a 0..1 fraction. */
  onTick: (fraction: number) => void;
  onEvent: (e: GameEvent) => void;
}

export function createGame(canvas: HTMLCanvasElement, opts: GameOptions): GameHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view: View = { w: 1, h: 1, dpr: 1, aspect: 1.6, reduceMotion };

  const st = freshState(loadBest());
  let raf = 0;
  let prev = performance.now();
  let hudAt = 0;
  /** The last few warps drawn, so the scheduler doesn't repeat itself. */
  const recentWarps: WarpId[] = [];

  // --- Sizing ---------------------------------------------------------------

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = rect.width;
    view.h = rect.height;
    view.dpr = dpr;
    view.aspect = rect.width / rect.height;
    st.aspect = view.aspect;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    clampPlayer();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const pointer = createPointerInput(canvas, {
    unitScale: () => view.h,
    onLockChange: (locked) => {
      // Escape (or a lost lock for any other reason) is the pause gesture.
      if (!locked && st.phase === 'playing') pause();
      else pushHud(true);
    },
  });

  // --- HUD plumbing ---------------------------------------------------------

  function pushHud(force = false) {
    const now = performance.now();
    if (!force && now - hudAt < 100) return;
    hudAt = now;
    opts.onHud({
      phase: st.phase,
      score: Math.round(st.score),
      best: Math.round(st.best),
      combo: st.combo,
      shields: st.shields,
      wave: st.wave,
      warps: st.warps.map((w) => ({ ...w })),
      locked: pointer.isLocked(),
    });
  }

  // --- Lifecycle ------------------------------------------------------------

  function start() {
    Object.assign(st, freshState(st.best));
    st.aspect = view.aspect;
    st.player.p = { x: view.aspect / 2, y: 0.5 };
    st.phase = 'playing';
    recentWarps.length = 0;
    for (let i = 0; i < 3; i++) spawnOrb();
    spawnHunter();
    pointer.consume();
    sfx.start();
    void pointer.lock();
    prev = performance.now();
    pushHud(true);
  }

  function pause() {
    if (st.phase !== 'playing') return;
    st.phase = 'paused';
    pointer.release();
    pushHud(true);
  }

  function resume() {
    if (st.phase !== 'paused') return;
    st.phase = 'playing';
    pointer.consume();
    prev = performance.now();
    void pointer.lock();
    pushHud(true);
  }

  function gameOver() {
    if (st.phase === 'over') return;
    st.phase = 'over';
    if (st.score > st.best) {
      st.best = st.score;
      saveBest(st.best);
    }
    burst(st.player.p, 46, '#ffffff', 1.1);
    ring(st.player.p, 1.4, '#ff453a', 0.9, 0.012);
    st.shake = reduceMotion ? 0 : 0.045;
    st.flash = 1;
    st.flashColor = '255,69,58';
    pointer.release();
    sfx.over();
    opts.onEvent({ kind: 'over' });
    pushHud(true);
  }

  // --- Spawning -------------------------------------------------------------

  function spawnOrb() {
    const p = findOpenSpot(0.3, 0.26);
    st.orbs.push({ p, r: ORB_R, age: 0, seed: Math.random() * 6.283 });
  }

  function findOpenSpot(fromPlayer: number, fromHunters: number): Vec {
    const m = 0.08;
    let bestP: Vec = { x: st.aspect / 2, y: 0.5 };
    let bestScore = -1;
    for (let i = 0; i < 30; i++) {
      const p = {
        x: m + Math.random() * (st.aspect - 2 * m),
        y: m + Math.random() * (1 - 2 * m),
      };
      let score = dist(p, st.player.p) - fromPlayer;
      for (const h of st.hunters) score = Math.min(score, dist(p, h.p) - fromHunters);
      for (const o of st.orbs) score = Math.min(score, dist(p, o.p) - 0.18);
      if (score > 0) return p;
      if (score > bestScore) {
        bestScore = score;
        bestP = p;
      }
    }
    return bestP;
  }

  function spawnHunter() {
    // Enter from just outside a random edge so hunters always arrive from the
    // rim rather than materialising on top of you.
    const edge = Math.floor(Math.random() * 4);
    const a = st.aspect;
    const p: Vec =
      edge === 0
        ? { x: Math.random() * a, y: -0.08 }
        : edge === 1
          ? { x: a + 0.08, y: Math.random() }
          : edge === 2
            ? { x: Math.random() * a, y: 1.08 }
            : { x: -0.08, y: Math.random() };
    st.hunters.push({
      p,
      v: { x: 0, y: 0 },
      r: HUNTER_R,
      age: 0,
      spin: Math.random() * 6.283,
      wobble: Math.random() * 6.283,
      speed: Math.min(0.62, 0.24 + st.wave * 0.022),
      stun: 0,
    });
  }

  // --- Warp scheduling ------------------------------------------------------

  function warpSlots() {
    if (st.wave < 2) return 0;
    if (st.wave < 5) return 1;
    if (st.wave < 8) return 2;
    return 3;
  }

  function activeIds(): Set<WarpId> {
    return new Set(st.warps.map((w) => w.id));
  }

  function pickWarp(): WarpDef | null {
    const active = activeIds();
    const eligible = WARPS.filter((w) => {
      if (active.has(w.id)) return false;
      if (w.excludes.some((x) => active.has(x))) return false;
      return !st.warps.some((a) => WARP_BY_ID[a.id].excludes.includes(w.id));
    });
    if (!eligible.length) return null;
    const fresh = eligible.filter((w) => !recentWarps.includes(w.id));
    const pool = fresh.length ? fresh : eligible;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function engageWarp() {
    const def = pickWarp();
    if (!def) return;
    st.warps.push({ id: def.id, remaining: WARP_LIFE, total: WARP_LIFE });
    recentWarps.push(def.id);
    if (recentWarps.length > 4) recentWarps.shift();

    if (def.id === 'wells') {
      st.wells = [];
      const n = 2 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        st.wells.push({
          p: findOpenSpot(0.3, 0.1),
          sign: Math.random() < 0.72 ? 1 : -1,
          phase: Math.random() * 6.283,
        });
      }
    }
    if (def.id === 'spin') st.spinAngle = 0;

    ring({ x: st.aspect / 2, y: 0.5 }, 1.5, def.color, 0.75, 0.01);
    st.flash = 0.7;
    st.flashColor = hexToRgb(def.color);
    st.shake = reduceMotion ? 0 : 0.012;
    sfx.warp();
    opts.onEvent({ kind: 'warp', warp: def });
    pushHud(true);
  }

  function stepWarps(dt: number) {
    let expired = false;
    for (let i = st.warps.length - 1; i >= 0; i--) {
      st.warps[i].remaining -= dt;
      if (st.warps[i].remaining <= 0) {
        if (st.warps[i].id === 'wells') st.wells = [];
        st.warps.splice(i, 1);
        expired = true;
      }
    }
    if (expired) st.nextWarpAt = Math.max(st.nextWarpAt, st.t + WARP_GAP);
    if (st.warps.length < warpSlots() && st.t >= st.nextWarpAt) {
      engageWarp();
      st.nextWarpAt = st.t + WARP_GAP;
    }
  }

  // --- The player -----------------------------------------------------------

  function clampPlayer() {
    const r = PLAYER_R;
    const p = st.player.p;
    if (p.x < r) {
      p.x = r;
      st.player.v.x = Math.max(0, st.player.v.x);
    } else if (p.x > st.aspect - r) {
      p.x = st.aspect - r;
      st.player.v.x = Math.min(0, st.player.v.x);
    }
    if (p.y < r) {
      p.y = r;
      st.player.v.y = Math.max(0, st.player.v.y);
    } else if (p.y > 1 - r) {
      p.y = 1 - r;
      st.player.v.y = Math.min(0, st.player.v.y);
    }
  }

  function stepPlayer(dt: number) {
    const active = activeIds();
    const raw = pointer.consume();
    const pl = st.player;

    // Keep the raw heading around: the renderer draws a faint chevron in the
    // direction your hand actually went, which is the only honest feedback you
    // get while a warp is lying to you.
    const rawLen = Math.hypot(raw.x, raw.y);
    if (rawLen > 0.0008) {
      pl.raw.x += (raw.x / rawLen - pl.raw.x) * 0.25;
      pl.raw.y += (raw.y / rawLen - pl.raw.y) * 0.25;
    }

    const d = transformDelta(raw, active, st.spinAngle);
    const rate = { x: d.x / dt, y: d.y / dt };

    if (active.has('ice')) {
      // You are pushing a puck: input adds momentum, drag bleeds it off.
      pl.v.x = (pl.v.x + d.x * ICE_GAIN) * Math.exp(-ICE_DRAG * dt);
      pl.v.y = (pl.v.y + d.y * ICE_GAIN) * Math.exp(-ICE_DRAG * dt);
      pl.p.x += pl.v.x * dt;
      pl.p.y += pl.v.y * dt;
    } else if (active.has('syrup')) {
      // A first-order lag on velocity: the cursor leans into a move late and
      // keeps going after you stop.
      const k = 1 - Math.exp(-dt / SYRUP_TAU);
      st.smooth.x += (rate.x - st.smooth.x) * k;
      st.smooth.y += (rate.y - st.smooth.y) * k;
      pl.p.x += st.smooth.x * dt;
      pl.p.y += st.smooth.y * dt;
      pl.v = { ...st.smooth };
    } else {
      pl.p.x += d.x;
      pl.p.y += d.y;
      pl.v = rate;
      st.smooth = { ...rate };
    }

    if (active.has('tide')) {
      st.tideAngle += TIDE_TURN * dt;
      pl.p.x += Math.cos(st.tideAngle) * TIDE_SPEED * dt;
      pl.p.y += Math.sin(st.tideAngle) * TIDE_SPEED * dt;
    }

    for (const w of st.wells) {
      w.phase += dt * 1.6;
      const dx = w.p.x - pl.p.x;
      const dy = w.p.y - pl.p.y;
      const r2 = dx * dx + dy * dy + 0.012;
      const speed = Math.min(WELL_CAP, WELL_G / r2) * w.sign;
      const len = Math.sqrt(r2);
      pl.p.x += (dx / len) * speed * dt;
      pl.p.y += (dy / len) * speed * dt;
    }

    clampPlayer();

    pl.trail.push({ x: pl.p.x, y: pl.p.y });
    if (pl.trail.length > TRAIL_LEN) pl.trail.shift();
    if (pl.invuln > 0) pl.invuln -= dt;
  }

  // --- Scoring and damage ---------------------------------------------------

  function collect(o: Orb, i: number) {
    st.orbs.splice(i, 1);
    st.combo = Math.min(MAX_COMBO, st.combo + 1);
    st.comboTimer = COMBO_WINDOW;
    const points = 10 * st.combo;
    st.score += points;
    st.collected++;
    st.timeLeft = Math.min(TIME_CAP, st.timeLeft + ORB_TIME);

    burst(o.p, 16, '#7ff0ff', 0.55);
    ring(o.p, 0.16, '#7ff0ff', 0.4, 0.006);
    st.pops.push({
      p: { ...o.p },
      text: `+${points}`,
      life: 0.9,
      color: st.combo > 1 ? '#ffd60a' : '#7ff0ff',
    });
    sfx.collect(st.combo);

    if (st.collected % ORBS_PER_WAVE === 0) waveUp();
    spawnOrb();
  }

  function waveUp() {
    st.wave++;
    if (st.hunters.length < Math.min(MAX_HUNTERS, st.wave)) spawnHunter();
    for (const h of st.hunters) h.speed = Math.min(0.62, 0.24 + st.wave * 0.022);
    if (st.orbs.length < Math.min(6, 2 + Math.floor(st.wave / 2))) spawnOrb();
    ring({ x: st.aspect / 2, y: 0.5 }, 1.5, '#5ac8fa', 0.6, 0.006);
    sfx.wave();
    opts.onEvent({ kind: 'wave', wave: st.wave });
    pushHud(true);
  }

  function takeHit(h: Hunter) {
    st.shields--;
    st.player.invuln = 1.5;
    st.combo = 0;
    st.shake = reduceMotion ? 0 : 0.032;
    st.flash = 1;
    st.flashColor = '255,69,58';
    burst(st.player.p, 26, '#ff6b6b', 0.85);
    ring(st.player.p, 0.5, '#ff453a', 0.55, 0.009);
    sfx.hit();
    opts.onEvent({ kind: 'hit' });

    // Shove the offender (and anything crowding it) clear and stun it for
    // longer than the invulnerability lasts. Without the stun a hunter simply
    // re-homes and takes the next shield the instant the flashing stops, which
    // reads as being punished twice for one mistake.
    for (const other of st.hunters) {
      const dx = other.p.x - st.player.p.x;
      const dy = other.p.y - st.player.p.y;
      const len = Math.hypot(dx, dy) || 1;
      if (len > 0.4 && other !== h) continue;
      other.v.x = (dx / len) * 1.1;
      other.v.y = (dy / len) * 1.1;
      other.p.x += (dx / len) * 0.06;
      other.p.y += (dy / len) * 0.06;
      other.stun = other === h ? 1.9 : 1.1;
    }

    pushHud(true);
    if (st.shields <= 0) gameOver();
  }

  // --- Effects --------------------------------------------------------------

  function burst(p: Vec, n: number, color: string, power: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const s = (0.15 + Math.random() * 0.85) * power;
      st.particles.push({
        p: { ...p },
        v: { x: Math.cos(a) * s, y: Math.sin(a) * s },
        life: 0.35 + Math.random() * 0.5,
        max: 0.85,
        r: 0.003 + Math.random() * 0.006,
        color,
      });
    }
  }

  function ring(p: Vec, max: number, color: string, life: number, width: number) {
    st.rings.push({ p: { ...p }, r: 0, max, life, maxLife: life, color, width });
  }

  // --- Frame ----------------------------------------------------------------

  function update(dt: number) {
    st.t += dt;
    st.spinAngle += dt * 0.62;

    stepWarps(dt);
    stepPlayer(dt);

    for (let i = st.orbs.length - 1; i >= 0; i--) {
      const o = st.orbs[i];
      o.age += dt;
      if (dist(o.p, st.player.p) < o.r + PLAYER_R + 0.012) collect(o, i);
    }

    for (const h of st.hunters) {
      h.age += dt;
      h.spin += dt * 2.6;
      h.wobble += dt * 2.1;
      const dx = st.player.p.x - h.p.x;
      const dy = st.player.p.y - h.p.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // A little sideways bias makes hunters arc in rather than laser-track,
      // which leaves you a slip lane if you commit early.
      const sway = Math.sin(h.wobble) * 0.38;
      const tx = (ux - uy * sway) * h.speed;
      const ty = (uy + ux * sway) * h.speed;
      if (h.stun > 0) {
        // Coasting on the knockback: no steering, just drag.
        h.stun -= dt;
        h.v.x *= Math.exp(-2.2 * dt);
        h.v.y *= Math.exp(-2.2 * dt);
      } else {
        const k = 1 - Math.exp(-dt * 2.6);
        h.v.x += (tx - h.v.x) * k;
        h.v.y += (ty - h.v.y) * k;
      }
      h.p.x += h.v.x * dt;
      h.p.y += h.v.y * dt;

      if (st.player.invuln <= 0 && h.age > HUNTER_GRACE && len < h.r + PLAYER_R) {
        takeHit(h);
        break;
      }
    }

    for (let i = st.particles.length - 1; i >= 0; i--) {
      const q = st.particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        st.particles.splice(i, 1);
        continue;
      }
      q.p.x += q.v.x * dt;
      q.p.y += q.v.y * dt;
      q.v.x *= Math.exp(-2.4 * dt);
      q.v.y *= Math.exp(-2.4 * dt);
    }

    for (let i = st.rings.length - 1; i >= 0; i--) {
      const r = st.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        st.rings.splice(i, 1);
        continue;
      }
      const p = 1 - r.life / r.maxLife;
      r.r = r.max * (1 - Math.pow(1 - p, 2.4));
    }

    for (let i = st.pops.length - 1; i >= 0; i--) {
      const p = st.pops[i];
      p.life -= dt;
      p.p.y -= dt * 0.09;
      if (p.life <= 0) st.pops.splice(i, 1);
    }

    if (st.comboTimer > 0) {
      st.comboTimer -= dt;
      if (st.comboTimer <= 0) st.combo = 0;
    }

    st.shake *= Math.exp(-6 * dt);
    st.flash *= Math.exp(-5 * dt);

    st.timeLeft -= dt;
    if (st.timeLeft <= 0) {
      st.timeLeft = 0;
      gameOver();
    }
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // Clamp so a backgrounded tab or a slow paint can't teleport anything.
    const dt = Math.min(0.05, Math.max(0.0005, (now - prev) / 1000));
    prev = now;

    if (st.phase === 'playing') {
      update(dt);
      pushHud();
    } else if (st.phase === 'menu') {
      // Idle attract mode: keep the ambience alive behind the title card.
      st.t += dt;
      st.spinAngle += dt * 0.62;
    }

    opts.onTick(st.timeLeft / TIME_CAP);
    draw(ctx, st, view);
  };
  raf = requestAnimationFrame(frame);

  const onVisibility = () => {
    if (document.hidden) pause();
  };
  document.addEventListener('visibilitychange', onVisibility);

  pushHud(true);

  return {
    start,
    pause,
    resume,
    state: () => st,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      pointer.destroy();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

// --- Helpers ----------------------------------------------------------------

function freshState(best: number): GameState {
  return {
    phase: 'menu',
    t: 0,
    aspect: 1.6,
    player: {
      p: { x: 0.8, y: 0.5 },
      v: { x: 0, y: 0 },
      trail: [],
      invuln: 0,
      raw: { x: 1, y: 0 },
    },
    smooth: { x: 0, y: 0 },
    orbs: [],
    hunters: [],
    particles: [],
    rings: [],
    pops: [],
    wells: [],
    warps: [],
    spinAngle: 0,
    tideAngle: Math.random() * 6.283,
    nextWarpAt: 0,
    score: 0,
    best,
    combo: 0,
    comboTimer: 0,
    shields: 3,
    wave: 1,
    collected: 0,
    timeLeft: START_TIME,
    shake: 0,
    flash: 0,
    flashColor: '90,200,250',
  };
}

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* private mode — the run still counts, it just won't be remembered */
  }
}
