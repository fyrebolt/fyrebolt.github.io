// ===== Doomscroll: simulation =====
//
// One rAF loop owns everything: it drains the scroll input, pushes the distance
// through the active quirks, integrates an offset with whatever momentum model
// is in force, works out which card is under the read line, and hands the state
// to render.ts. React never sees a frame — it gets a throttled HUD snapshot and
// a per-frame number for the attention bar, so the feed runs at display rate
// with no reconciliation in the hot path.
//
// The rule the whole game hangs off is `engagement`: one number, derived from
// scroll speed alone, that says how much of the focused card lands on you this
// frame. Reading a post, bleeding attention to bait and triggering an ad are
// all the same mechanic seen from three sides — slow down and the feed gets
// what it wants, whatever the card happens to be.

import { createScrollInput } from './scroll';
import { makeCard } from './content';
import { sfx } from './sfx';
import { draw, type View } from './render';
import { QUIRKS, QUIRK_BY_ID, transformScroll, type QuirkDef, type QuirkId } from './quirks';
import { ZONE_Y } from './types';
import type { Card, CardKind, FeedState, HudSnapshot } from './types';

// --- Tuning -----------------------------------------------------------------
// Everything is in feed units (the viewport is 1.0 tall) and seconds.

const START_ATT = 20;
const ATT_CAP = 26;
const POST_ATT = 2.6;
const HOT_ATT = 4.2;
const DRAIN_BASE = 1;
const DRAIN_WAVE = 0.09;
const BAIT_DRAIN = 2.8;

const READ_TIME = 0.8;
const HOT_TIME = 1.15;
const HOOK_TIME = 1.6;
/** Meter bleed-back per second once a card leaves the line. */
const MELT = 0.4;

/**
 * Scroll speed at which engagement reaches zero, units/s — a little under one
 * screen a second. Below it the focused card starts working on you; above it
 * you are moving too fast for anything, good or bad, to land.
 */
const CALM_V = 0.8;

/** Engagement an ad needs before it can take the feed. */
const AD_TRIGGER = 0.34;
const AD_HOLD = 1.25;

const POSTS_PER_WAVE = 6;
const MAX_COMBO = 9;
const COMBO_WINDOW = 4.5;

const QUIRK_LIFE = 9.5;
const QUIRK_GAP = 1.8;

/** Momentum. FLING_TAU is how quickly the coast speed follows your hand. */
const FLING_TAU = 0.075;
const DECAY = 3.2;
const SLICK_DECAY = 0.4;
/**
 * Ceiling on coasting speed, units/s. One oversized wheel event implies a hand
 * speed no hand had, and without this the feed can leave on a single notch.
 */
const MAX_V = 8;
/** Below this the feed is visually still, so stop pretending otherwise. */
const REST_V = 0.05;
const HEAVY_GAIN = 0.5;
const HEAVY_TAU = 0.26;
const SNAP_TAU = 0.16;
const SNAP_V = 1.3;
const AUTOPLAY_SPEED = 0.42;
const RUBBER_TAU = 2.4;
const RUBBER_K = 1.6;
const RUBBER_MAX = 0.55;

/** Gap between cards, units. */
const GAP = 0.032;
/** Generate cards until this far past the bottom edge; prune this far above. */
const AHEAD = 2.2;
const BEHIND = 1.2;

/** How fast the feed drifts by itself behind the title card. */
const ATTRACT_SPEED = 0.075;

const BEST_KEY = 'doomscroll.best.v1';

export interface FeedEvent {
  kind: 'quirk' | 'wave' | 'hook' | 'over';
  quirk?: QuirkDef;
  wave?: number;
}

export interface FeedHandle {
  /** Begin a fresh run. */
  start(): void;
  /** Abandon the run for the title card. */
  toMenu(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
  state(): FeedState;
}

export interface FeedOptions {
  onHud: (h: HudSnapshot) => void;
  /** Called every frame with the attention meter as a 0..1 fraction. */
  onTick: (fraction: number) => void;
  onEvent: (e: FeedEvent) => void;
}

export function createFeed(canvas: HTMLCanvasElement, opts: FeedOptions): FeedHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view: View = { w: 1, h: 1, dpr: 1, aspect: 1.6, reduceMotion };

  const st = freshState(loadBest());
  let raf = 0;
  let prev = performance.now();
  let hudAt = 0;
  /** The last few quirks drawn, so the scheduler doesn't repeat itself. */
  const recentQuirks: QuirkId[] = [];

  // Fill the feed before the first paint: `resize` draws immediately, and an
  // empty column of cards is not what this app looks like at rest.
  layout();

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
    // Draw straight away rather than waiting for the next frame: a resize can
    // land between animation frames, and a stretched slab of stale pixels is
    // worse than a frame's worth of work.
    draw(ctx, st, view);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const scroll = createScrollInput(canvas, {
    unitScale: () => view.h,
    enabled: () => st.phase === 'playing',
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
      quirks: st.quirks.map((q) => ({ ...q })),
      pinned: st.pin ? st.pin.left : null,
    });
  }

  // --- Lifecycle ------------------------------------------------------------

  function start() {
    Object.assign(st, freshState(st.best));
    st.aspect = view.aspect;
    st.phase = 'playing';
    recentQuirks.length = 0;
    layout();
    // Open on the first card already at the line, so the run starts on a post
    // rather than on the seam above one.
    st.y = st.cards[0].top + st.cards[0].h / 2 - ZONE_Y;
    st.anchor = st.y;
    scroll.consume();
    sfx.start();
    prev = performance.now();
    pushHud(true);
  }

  function pause() {
    if (st.phase !== 'playing') return;
    st.phase = 'paused';
    pushHud(true);
  }

  function resume() {
    if (st.phase !== 'paused') return;
    st.phase = 'playing';
    scroll.consume();
    prev = performance.now();
    pushHud(true);
  }

  /**
   * Give up on the run and go back to the title card. An abandoned run still
   * counts for the record: the score was earned, and withholding it for
   * quitting would only teach players to park in a gap between cards and wait
   * for the clock instead.
   */
  function toMenu() {
    if (st.phase === 'menu') return;
    bankBest();
    Object.assign(st, freshState(st.best));
    st.aspect = view.aspect;
    layout();
    pushHud(true);
  }

  function gameOver() {
    if (st.phase === 'over') return;
    st.phase = 'over';
    bankBest();
    st.pin = null;
    burst({ x: st.aspect / 2, y: ZONE_Y }, 44, '#ffffff', 1.1);
    ring({ x: st.aspect / 2, y: ZONE_Y }, 1.4, '#ff453a', 0.9, 0.012);
    st.shake = reduceMotion ? 0 : 0.045;
    st.flash = 1;
    st.flashColor = '255,69,58';
    sfx.over();
    opts.onEvent({ kind: 'over' });
    pushHud(true);
  }

  function bankBest() {
    if (st.score > st.best) {
      st.best = st.score;
      saveBest(st.best);
    }
  }

  // --- The feed itself ------------------------------------------------------

  /** Generate whatever the viewport is about to need, drop what it has passed. */
  function layout() {
    while (st.nextTop < st.y + 1 + AHEAD) {
      const card = makeCard(st.nextId++, pickKind(), st.nextTop);
      st.cards.push(card);
      st.nextTop = card.top + card.h + GAP;
    }
    let gone = 0;
    while (gone < st.cards.length - 1) {
      const c = st.cards[gone];
      if (c.top + c.h >= st.y - BEHIND) break;
      gone++;
    }
    if (gone) st.cards.splice(0, gone);
  }

  /**
   * The mix. Bait and ads climb with the wave, and the first few cards of a run
   * are always plain posts — the first thing a player meets has to be the thing
   * they are here to do, not the thing that punishes them for doing it.
   */
  function pickKind(): CardKind {
    if (st.nextId < 3) return 'post';
    const w = st.wave;
    const ad = Math.min(0.18, 0.04 + w * 0.02);
    const bait = Math.min(0.34, 0.1 + w * 0.03);
    const hot = 0.08;
    const tail = st.cards.slice(-2).map((c) => c.kind);
    const r = Math.random();

    if (r < ad && tail[tail.length - 1] !== 'ad') return 'ad';
    // Three shrill cards in a row is a wall, not a feed.
    if (r < ad + bait && !(tail[0] === 'bait' && tail[1] === 'bait')) return 'bait';
    if (r < ad + bait + hot) return 'hot';
    return 'post';
  }

  function cardById(id: number): Card | undefined {
    return st.cards.find((c) => c.id === id);
  }

  /** Offset that would centre the card nearest the line on the line. */
  function snapTarget(): number | null {
    let best: number | null = null;
    let bestGap = Infinity;
    for (const c of st.cards) {
      const target = c.top + c.h / 2 - ZONE_Y;
      const gap = Math.abs(target - st.y);
      if (gap < bestGap) {
        bestGap = gap;
        best = target;
      }
    }
    return best;
  }

  function activeIds(): Set<QuirkId> {
    return new Set(st.quirks.map((q) => q.id));
  }

  // --- Scrolling ------------------------------------------------------------

  function stepScroll(dt: number) {
    const active = activeIds();
    const input = scroll.consume();

    // An ad has the feed. Whatever your hand is doing is read and thrown away,
    // which is the joke, and the countdown is the only way out.
    if (st.pin) {
      st.pin.left -= dt;
      st.v = 0;
      const card = cardById(st.pin.id);
      if (card) {
        const target = card.top + card.h / 2 - ZONE_Y;
        st.y += (target - st.y) * (1 - Math.exp(-dt / 0.16));
        card.meter = 1 - Math.max(0, st.pin.left) / st.pin.total;
      }
      if (st.pin.left <= 0 || !card) releasePin();
      st.engagement = 1;
      return;
    }

    const d = transformScroll(input.d, active);

    if (active.has('molasses')) {
      // A first-order lag on the *rate*: the feed leans into a flick late and
      // keeps creeping after your hand has stopped.
      const k = 1 - Math.exp(-dt / HEAVY_TAU);
      st.smooth += ((d * HEAVY_GAIN) / dt - st.smooth) * k;
      st.y += st.smooth * dt;
      st.v = st.smooth;
    } else if (input.live) {
      st.y += d;
      const k = 1 - Math.exp(-dt / FLING_TAU);
      st.v = clamp(st.v + (d / dt - st.v) * k, -MAX_V, MAX_V);
      st.smooth = st.v;
    } else {
      // Nothing arrived this frame, so the feed is coasting on the last flick.
      const decay = active.has('slick') ? SLICK_DECAY : DECAY;
      st.y += st.v * dt;
      st.v *= Math.exp(-decay * dt);
      if (Math.abs(st.v) < REST_V) st.v = 0;
      st.smooth = st.v;
    }

    if (active.has('autoplay')) st.y += AUTOPLAY_SPEED * dt;

    if (active.has('rubberband')) {
      // An anchor that trails you by a couple of seconds, pulling the whole
      // time: stop pushing and you lose ground you already paid for.
      st.anchor += (st.y - st.anchor) * (1 - Math.exp(-dt / RUBBER_TAU));
      st.y += clamp(st.anchor - st.y, -RUBBER_MAX, RUBBER_MAX) * RUBBER_K * dt;
    } else {
      st.anchor = st.y;
    }

    if (active.has('snap') && Math.abs(st.v) < SNAP_V) {
      const target = snapTarget();
      if (target !== null) {
        st.y += (target - st.y) * (1 - Math.exp(-dt / SNAP_TAU));
        st.v *= Math.exp(-4 * dt);
      }
    }

    // You may reverse until the oldest card you can still see has its top edge
    // on the read line, and no further — far enough to go back for a post you
    // overshot, not far enough to hide in the empty space above the feed. It is
    // also, by construction, never tighter than where a run opens: a card
    // centred on the line always sits below its own top edge.
    const floor = st.cards.length ? st.cards[0].top - ZONE_Y : 0;
    if (st.y < floor) {
      st.y = floor;
      st.v = Math.max(0, st.v);
    }

    st.engagement = clamp(1 - Math.abs(st.v) / CALM_V, 0, 1);
  }

  // --- The read line --------------------------------------------------------

  function stepFocus(dt: number) {
    const line = st.y + ZONE_Y;
    let idx = -1;
    for (let i = 0; i < st.cards.length; i++) {
      const c = st.cards[i];
      if (c.top <= line && line < c.top + c.h) {
        idx = i;
        break;
      }
    }
    st.focus = idx;

    const id = idx >= 0 ? st.cards[idx].id : -1;
    if (id !== st.lastFocusId) {
      st.lastFocusId = id;
      sfx.tick();
    }

    // Everything not on the line forgets what it had started, slowly — enough
    // that grazing a post twice still works, not enough to farm bait in taps.
    for (let i = 0; i < st.cards.length; i++) {
      const c = st.cards[i];
      if (i !== idx && !c.done && c.meter > 0) c.meter = Math.max(0, c.meter - MELT * dt);
      if (i !== idx) c.focus = 0;
    }

    // While an ad holds the feed it is also the focused card; leave it alone or
    // it re-triggers its own pin every frame and never lets go.
    if (idx < 0 || st.pin) return;
    const card = st.cards[idx];
    card.focus += dt;
    if (card.done) return;

    const eng = st.engagement;
    if (eng <= 0) return;

    if (card.kind === 'ad') {
      if (eng >= AD_TRIGGER) engagePin(card);
      return;
    }

    if (card.kind === 'bait') {
      st.attention -= BAIT_DRAIN * eng * dt;
      card.meter += (eng * dt) / HOOK_TIME;
      if (card.meter >= 1) hook(card);
      return;
    }

    card.meter += (eng * dt) / (card.kind === 'hot' ? HOT_TIME : READ_TIME);
    if (card.meter >= 1) bank(card);
  }

  function screenPos(card: Card) {
    return { x: st.aspect / 2, y: card.top + card.h / 2 - st.y };
  }

  function bank(card: Card) {
    card.done = true;
    card.meter = 1;
    const hot = card.kind === 'hot';
    const p = screenPos(card);

    st.combo = Math.min(MAX_COMBO, st.combo + 1);
    st.comboTimer = COMBO_WINDOW;
    const points = (hot ? 25 : 10) * st.combo;
    st.score += points;
    st.read++;
    st.attention = Math.min(ATT_CAP, st.attention + (hot ? HOT_ATT : POST_ATT));

    burst(p, hot ? 22 : 14, hot ? '#ffd60a' : '#7ff0ff', hot ? 0.7 : 0.5);
    ring(p, 0.22, hot ? '#ffd60a' : '#7ff0ff', 0.45, 0.006);
    st.pops.push({
      p,
      text: `+${points}`,
      life: 0.9,
      color: st.combo > 1 || hot ? '#ffd60a' : '#7ff0ff',
    });
    sfx.read(st.combo);

    if (st.read % POSTS_PER_WAVE === 0) waveUp();
    pushHud(true);
  }

  function hook(card: Card) {
    card.done = true;
    card.meter = 1;
    st.shields--;
    st.combo = 0;
    st.shake = reduceMotion ? 0 : 0.03;
    st.flash = 0.85;
    st.flashColor = '255,69,58';
    burst(screenPos(card), 26, '#ff453a', 0.9);
    ring(screenPos(card), 0.5, '#ff453a', 0.55, 0.008);
    // The shove: being hooked throws you down the feed, so you lose your place
    // as well as the shield. Sitting on bait should cost more than the meter.
    st.v += 2.4;
    sfx.hooked();
    opts.onEvent({ kind: 'hook' });
    if (st.shields <= 0) gameOver();
    else pushHud(true);
  }

  function engagePin(card: Card) {
    if (st.pin) return;
    st.pin = { id: card.id, left: AD_HOLD, total: AD_HOLD };
    st.flash = 0.5;
    st.flashColor = '191,90,242';
    sfx.ad();
    pushHud(true);
  }

  function releasePin() {
    if (!st.pin) return;
    const card = cardById(st.pin.id);
    if (card) {
      card.done = true;
      card.meter = 1;
      ring(screenPos(card), 0.35, '#bf5af2', 0.4, 0.005);
    }
    st.pin = null;
    pushHud(true);
  }

  function waveUp() {
    st.wave++;
    ring({ x: st.aspect / 2, y: ZONE_Y }, 1.5, '#5ac8fa', 0.6, 0.006);
    sfx.wave();
    opts.onEvent({ kind: 'wave', wave: st.wave });
  }

  // --- Quirk scheduling -----------------------------------------------------

  function quirkSlots() {
    if (st.wave < 2) return 0;
    if (st.wave < 4) return 1;
    if (st.wave < 7) return 2;
    return 3;
  }

  function pickQuirk(): QuirkDef | null {
    const active = activeIds();
    const eligible = QUIRKS.filter((q) => {
      if (active.has(q.id)) return false;
      if (q.excludes.some((x) => active.has(x))) return false;
      return !st.quirks.some((a) => QUIRK_BY_ID[a.id].excludes.includes(q.id));
    });
    if (!eligible.length) return null;
    const fresh = eligible.filter((q) => !recentQuirks.includes(q.id));
    const pool = fresh.length ? fresh : eligible;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function armQuirk(def: QuirkDef, life: number) {
    st.quirks.push({ id: def.id, remaining: life, total: life });
    // Rubberband has to start from where you are, or arming it snaps the feed
    // back to wherever the anchor happened to be left.
    if (def.id === 'rubberband') st.anchor = st.y;
    ring({ x: st.aspect / 2, y: ZONE_Y }, 1.5, def.color, 0.75, 0.01);
    st.flash = 0.7;
    st.flashColor = hexToRgb(def.color);
    st.shake = reduceMotion ? 0 : 0.012;
    sfx.quirk();
    opts.onEvent({ kind: 'quirk', quirk: def });
  }

  function stepQuirks(dt: number) {
    let expired = false;
    for (let i = st.quirks.length - 1; i >= 0; i--) {
      st.quirks[i].remaining -= dt;
      if (st.quirks[i].remaining <= 0) {
        st.quirks.splice(i, 1);
        expired = true;
      }
    }
    if (expired) st.nextQuirkAt = Math.max(st.nextQuirkAt, st.t + QUIRK_GAP);
    if (st.quirks.length < quirkSlots() && st.t >= st.nextQuirkAt) {
      const def = pickQuirk();
      if (def) {
        recentQuirks.push(def.id);
        if (recentQuirks.length > 4) recentQuirks.shift();
        armQuirk(def, QUIRK_LIFE);
        st.nextQuirkAt = st.t + QUIRK_GAP;
        pushHud(true);
      }
    }
  }

  // --- Decoration -----------------------------------------------------------

  function burst(p: { x: number; y: number }, n: number, color: string, speed: number) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.3 + Math.random() * 0.4;
      st.particles.push({
        p: { ...p },
        v: { x: Math.cos(a) * s, y: Math.sin(a) * s },
        life,
        max: life,
        r: 0.003 + Math.random() * 0.005,
        color,
      });
    }
  }

  function ring(
    p: { x: number; y: number },
    max: number,
    color: string,
    life: number,
    width: number,
  ) {
    if (reduceMotion) return;
    st.rings.push({ p: { ...p }, r: 0, max, life, maxLife: life, color, width });
  }

  function stepEffects(dt: number) {
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
  }

  // --- The loop -------------------------------------------------------------

  function update(dt: number) {
    st.t += dt;
    stepQuirks(dt);
    stepScroll(dt);
    layout();
    stepFocus(dt);
    stepEffects(dt);

    st.attention -= (DRAIN_BASE + st.wave * DRAIN_WAVE) * dt;
    if (st.attention <= 0) {
      st.attention = 0;
      gameOver();
    }
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // The very first measurement can land before the stylesheet does, in which
    // case the canvas has no size yet and `resize` bailed. Retry until it takes
    // — cheap, because the moment a real size arrives this stops running, and
    // it doesn't force a layout on every ordinary frame.
    if (view.w <= 1) resize();
    // Clamp so a backgrounded tab or a slow paint can't teleport the feed.
    const dt = Math.min(0.05, Math.max(0.0005, (now - prev) / 1000));
    prev = now;

    if (st.phase === 'playing') {
      update(dt);
      pushHud();
    } else if (st.phase === 'menu') {
      // Attract mode: the feed keeps scrolling itself behind the title card,
      // which is both the ambience and an honest preview of what it does.
      st.t += dt;
      st.y += ATTRACT_SPEED * dt;
      layout();
      stepEffects(dt);
    } else {
      stepEffects(dt);
    }

    opts.onTick(st.attention / ATT_CAP);
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
    toMenu,
    pause,
    resume,
    state: () => st,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scroll.destroy();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

// --- Helpers ----------------------------------------------------------------

function freshState(best: number): FeedState {
  return {
    phase: 'menu',
    t: 0,
    aspect: 1.6,
    y: 0,
    v: 0,
    engagement: 1,
    smooth: 0,
    anchor: 0,
    cards: [],
    nextTop: 0,
    nextId: 0,
    focus: -1,
    lastFocusId: -1,
    pin: null,
    quirks: [],
    nextQuirkAt: 0,
    particles: [],
    rings: [],
    pops: [],
    score: 0,
    best,
    combo: 0,
    comboTimer: 0,
    shields: 3,
    wave: 1,
    read: 0,
    attention: START_ATT,
    shake: 0,
    flash: 0,
    flashColor: '90,200,250',
  };
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
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
