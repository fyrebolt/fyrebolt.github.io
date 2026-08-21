# Drift — `/game/`

A game about losing control of your own cursor. The player-facing description
lives in the [root README](../../README.md#-drift-game); this file is for
whoever has to change the code.

Entry point: [`game/index.html`](../../game/index.html) → [`main.tsx`](main.tsx),
registered as the `game` input in [`vite.config.ts`](../../vite.config.ts) and
listed on the home screen in [`src/home/apps.ts`](../home/apps.ts).

## The one idea

**Nothing in the simulation knows what a pixel is.**

The arena is exactly `1.0` unit tall and `aspect` units wide. Every radius,
speed, force and line weight below is in those units, and in seconds. Only two
files convert:

- [`pointer.ts`](pointer.ts) divides incoming mouse deltas by the arena's
  on-screen height, turning "17 pixels" into "0.038 of the arena".
- [`render.ts`](render.ts) sets one transform per frame so `1.0` maps to that
  same height, then draws in units.

The payoff is that a sweep across the arena always crosses the arena, at any
window size — difficulty doesn't change with the viewport, and resizing
mid-run isn't an exploit. If you find yourself writing a pixel value anywhere
else, that's the bug.

The one deliberate exception is canvas text (the floating `+120` pops), which
is drawn in a separate pass under an identity-ish transform because sub-pixel
font sizes rasterise badly.

## Module map

| File | Owns |
| --- | --- |
| [`pointer.ts`](pointer.ts) | Pointer Lock, ratio deltas, the unlocked fallback. Accumulates; never interprets. |
| [`warps.ts`](warps.ts) | The warp catalogue and `transformDelta` — the pure linear part of the lie. |
| [`engine.ts`](engine.ts) | The rAF loop, integration, spawning, warp scheduling, collisions, scoring. |
| [`render.ts`](render.ts) | All drawing. Reads state, mutates nothing. |
| [`types.ts`](types.ts) | Shared shapes, plus `HUNTER_GRACE` (the one constant the engine and renderer must agree on). |
| [`sfx.ts`](sfx.ts) | Oscillators and envelopes. No audio files anywhere. |
| [`tutorial.ts`](tutorial.ts) | The lesson catalogue — order, teaching copy, and which lessons bring a hunter. Data only. |
| [`GameApp.tsx`](GameApp.tsx) / [`game.css`](game.css) | Shell, HUD, overlays, mute. |

### Why React never sees a frame

The engine drives everything at display rate and hands React only:

- `onHud(snapshot)` — throttled to 10 Hz, and forced on discrete changes
  (phase, hit, wave, warp).
- `onTick(fraction)` — called every frame, written straight to the timer bar's
  `transform` through a ref.

So there is no reconciliation in the hot path. Keep it that way: if you need a
new per-frame readout, write it to a ref, don't add state.

## How input becomes a position

Per frame, in `stepPlayer`:

1. Drain `pointer.consume()` — raw delta, already in units.
2. Smooth the raw *direction* into `player.raw` for the ghost chevron. This is
   the only honest feedback the player gets while a warp is lying, so it must
   stay pre-transform.
3. Run the delta through `transformDelta` (Swap → Spin → Mirror → Flip → Twitch,
   in that fixed order so the same set always composes to the same feel).
4. Integrate, in one of three ways:
   - default — `p += d`
   - `ice` — the delta is an impulse: `v = (v + d·ICE_GAIN)·e^(−ICE_DRAG·dt)`, then `p += v·dt`
   - `syrup` — a first-order lag on *velocity* with time constant `SYRUP_TAU`
5. Apply forces: `tide` (a slowly turning constant drift) and `wells`
   (inverse-square pull, capped at `WELL_CAP`).
6. Clamp to the arena, zeroing the ice velocity component that hit the wall so
   you don't stick to it.

Deltas are converted to a *rate* (`d/dt`) before any filtering, so the feel
doesn't change with frame rate. `dt` is clamped to 50 ms.

## Adding a warp

1. Add an entry to `WARPS` in [`warps.ts`](warps.ts): `id`, `name`, a one-line
   `hint` for the banner, a `color`, its `kind`, and any `excludes`.
2. If it's a `transform`, implement it inside `transformDelta`. **That's all** —
   the HUD chip, the banner, the scheduler and the background grid all read the
   catalogue, and the grid derives its matrix from `transformDelta` itself.
3. If it's `integration` or `force`, it belongs in `stepPlayer` instead, and
   `transformDelta` must leave the delta untouched.

4. Add a lesson for it to `LESSONS` in [`tutorial.ts`](tutorial.ts) — one
   sentence on *what to do about it*, since the name and hint are read from the
   catalogue. This isn't optional politeness:
   [`test/game-tutorial.test.mjs`](../../test/game-tutorial.test.mjs) fails if a
   warp the scheduler can throw at players goes untaught.

Exclusions must be mutual; the test suite enforces it.

### The grid is derived, not drawn to match

`warpBasis` recovers the live 2×2 matrix by pushing `(1,0)` and `(0,1)` through
the *real* `transformDelta`. The floor is drawn through that. It therefore
cannot show a distortion the controls aren't applying — under Spin the floor
turns, under Twitch it coarsens, under Mirror it flips, for free and forever.

Don't "optimise" this into a hand-written matrix.
[`test/game-warps.test.mjs`](../../test/game-warps.test.mjs) asserts the basis
reproduces the transform exactly, because if those two ever disagree the game
shows one lie while telling another — unplayable rather than hard.

## The tutorial

`startTutorial()` runs the ordinary loop with three things taken away — the
clock, the score, and the cost of a mistake — and everything else left exactly
as it is. `st.tutorial` being non-null is the single flag the engine reads:

- `stepWarps` is skipped, so the one armed warp never expires and no second one
  rolls in.
- `timeLeft` stops draining, so nothing ends a lesson but the orb.
- `takeHit` still flashes, shoves and stuns; it just doesn't decrement
  `shields`, and can't reach `gameOver`.
- `collect` banks nothing and scores nothing — it calls `advanceLesson`.

`applyLesson` clears the floor (including `player.v` and `smooth`, or the ice
you built up in one lesson coasts you through the start of the next), arms the
lesson's warp through the same `armWarp` the scheduler uses, and spawns exactly
one orb. Lessons are therefore the real warp, not a simplified imitation of it.

Spawns are cropped to `LESSON_TOP` while teaching, orbs, wells and hunter entry
edges alike, because the bottom of the arena is under the lesson card — an orb
you can't see isn't a lesson, and a hunter you can't see is an ambush.

`toMenu()` is the way out of both a lesson and a run. An abandoned *run* still
banks its score: withholding the record for quitting would only teach players
to sit in a corner waiting out the clock.

## Tuning

All of it is the constant block at the top of [`engine.ts`](engine.ts).

| Knob | Value | Effect |
| --- | --- | --- |
| `START_TIME` / `TIME_CAP` / `ORB_TIME` | 20 / 26 / 1.7 s | The clock. The bar reads against `TIME_CAP`, so it starts ~77% full and orbs visibly buy headroom. |
| `ORBS_PER_WAVE` | 6 | Orbs banked per wave. Each wave adds a hunter, up to `MAX_HUNTERS`. |
| `WARP_LIFE` / `WARP_GAP` | 9.5 / 1.8 s | How long a warp holds, and the breath between them. |
| `warpSlots()` | 0 / 1 / 2 / 3 | Simultaneous warps at waves <2, <5, <8, 8+. Wave 1 is deliberately clean so the controls can be learned. |
| `HUNTER_GRACE` | 0.7 s | Fade-in *and* damage immunity — a hunter is only dangerous once fully drawn. |
| hit `stun` | 1.9 s | Longer than the 1.5 s invulnerability on purpose: without it a hunter re-homes and takes the next shield the instant the flashing stops, which reads as being punished twice for one mistake. |

## Gotchas

- **Pointer Lock is optional.** If it's denied (touch, embedded frames, a
  browser that refuses `unadjustedMovement`), `pointer.ts` differences client
  coordinates into the identical pipeline. Everything downstream is unaware.
  `unadjustedMovement: true` is tried first to bypass OS mouse acceleration,
  with a plain retry on rejection.
- **Esc is the pause gesture.** Losing the lock for any reason pauses the run;
  there is no separate pause key to keep in sync. That makes the pause card the
  only place a player can ask for anything, so it carries Restart and Menu (and
  Leave tutorial, mid-lesson) rather than just Resume. Under lock the browser
  eats the `Escape` keydown and releases the lock instead, so the keyboard
  handler in [`GameApp.tsx`](GameApp.tsx) only ever sees Esc when there is no
  lock to lose: the unlocked fallback, and the pause card itself — where a
  second Esc leaves the tutorial.
- **The site's soft cursor is parked during play** via `html.game-owns-cursor`,
  because [`SquircleCursor`](../ios/SquircleCursor.tsx) tracks `clientX/Y`,
  which freezes under lock.
- **Glows are radial gradients, never `shadowBlur`.** The shadow pipeline is
  slow and its blur radius doesn't follow the transform consistently across
  browsers, so it would look different at every window size.
- **The game cannot be verified in Claude's Browser pane.** That surface reports
  `document.hidden: true`, so `requestAnimationFrame` never fires and the loop
  never starts. Verify in a real browser, or temporarily shim rAF off a Web
  Worker tick (`setInterval` in a worker; main-thread timers are throttled to
  ~1 Hz there too). Same limitation as `/video`.
