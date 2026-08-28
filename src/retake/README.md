# Retake — `/retake/`

A puzzle platformer about cooperating with your own past attempts. The
player-facing description lives in the [root README](../../README.md#-retake-retake);
this file is for whoever has to change the code.

Entry point: [`retake/index.html`](../../retake/index.html) → [`main.tsx`](main.tsx),
registered as the `retake` input in [`vite.config.ts`](../../vite.config.ts) and
listed on the home screen in [`src/home/apps.ts`](../home/apps.ts).

## The one idea

**A take is a recording, and a recording is a platform.**

Ending a take banks the path the performer walked. Every later take replays that
path as a solid body: you can be blocked by it, and — the whole point — you can
stand on it. So the way you reach a shelf three tiles up is to spend a take
walking to the right spot, press <kbd>R</kbd>, and climb yourself.

Two consequences run through the whole codebase:

- **Past takes never see the live performer.** Take *k* is affected by the level
  and by takes *0…k−1*, and by nothing else. That is what makes the stack
  reproducible: replaying take 2 always lands it in the same place, because
  nothing it can collide with depends on what you are doing now.
- **A finished take freezes rather than disappearing.** `sampleTake` clamps past
  the end of the recording. If a take evaporated when its recording ran out,
  "walk somewhere and cut" would leave a platform that stops existing partway
  through the next take, and the level would look broken rather than hard.

## Module map

| File | Owns |
| --- | --- |
| [`types.ts`](types.ts) | Shared shapes, the body's dimensions, `FIXED_DT`, and `sampleTake` (the freeze-frame rule). |
| [`physics.ts`](physics.ts) | `stepBody` — the movement model, and the tuning constants every level is drawn against. |
| [`levels.ts`](levels.ts) | The shot list as ASCII, and the parser that refuses a malformed one. |
| [`sim.ts`](sim.ts) | The world: one fixed step, take endings, recording and banking. No browser. |
| [`engine.ts`](engine.ts) | The animation frame, the keyboard, and the phase machine. |
| [`render.ts`](render.ts) | All drawing, and how a shot is composed. Reads state, mutates nothing. |
| [`sfx.ts`](sfx.ts) | Which shape each event makes. Oscillators live in `src/utils/synth.ts`. |
| [`RetakeApp.tsx`](RetakeApp.tsx) / [`retake.css`](retake.css) | Slate, film strip, cards, mute. |

## Determinism is the load-bearing property

`sim.ts` has no wall clock, no randomness and no frame-rate term. `engine.ts`
spends real time into whole `FIXED_DT` steps through an accumulator, so a 60 Hz
display, a 144 Hz display and the test suite all advance the world identically.

This is not tidiness. The player stands on a recorded path; if the same inputs
could produce two different runs, ghosts would drift out from under people's
feet. [`test/retake-levels.test.mjs`](../../test/retake-levels.test.mjs) asserts
it directly — the same input script twice, compared position by position.

If you ever need a random number in the simulation, it has to come from a seeded
generator that is part of the recording. Don't reach for `Math.random`.

## The numbers every level is drawn against

From [`physics.ts`](physics.ts): a jump **rises about 2.55 tiles** and **carries
about 5.67**. Everything in the shot list follows from those two:

| Geometry | Consequence |
| --- | --- |
| 2-tile step | Reachable alone. |
| **3-tile shelf** | Impossible alone; possible standing on one take (+0.9). |
| **4-tile rise** | Needs two takes, one per storey. |
| 4-tile pit | Crossable at a run. |
| 6-tile pit | Not crossable. |

[`test/retake-physics.test.mjs`](../../test/retake-physics.test.mjs) pins both
numbers, so retuning the feel cannot silently make five levels trivial or
impossible without a test saying so.

## Adding a level

1. Add a spec to `SPECS` in [`levels.ts`](levels.ts). Rows must all be the same
   width — the parser throws rather than padding, because a ragged grid produces
   a level that is subtly wrong instead of obviously broken.
2. Draw it against the table above. The interesting question for a new shot is
   *how many storeys*, because that is how many takes it costs.
3. **Add a campaign for it to `CAMPAIGNS` in
   [`test/retake-levels.test.mjs`](../../test/retake-levels.test.mjs).** This
   isn't optional politeness: the test plays your level with a scripted sequence
   of takes and fails unless the performer ends up on the mark. A puzzle
   platformer with an impossible level isn't hard, it's broken, and nothing
   short of playing it proves otherwise.
4. Leave slack in `takes` — a test asserts the budget is at least one more than
   the solution needs, so a wasted take isn't an instant reshoot.

The solutions are written in a small vocabulary (`walkTo`, `hopOnto`, `leap`,
`runJump`, `settle`, `wait`) that reads like a description of the intended play.
If you can't express your level's solution in it, that is worth noticing before
a player has to find it.

## Why you can't watch it in an automated browser

The loop is `requestAnimationFrame`, which never fires in a hidden document, so
a headless pass sees a still frame. In development the engine handle is exposed
on `window.__retake` (dropped from production builds) with two seams — `press()`
and `stepFor()` — so a browser can step the world deterministically and
screenshot the result. Gameplay itself is verified in `node`, not in a browser.

## Tuning

All of it is the constant block at the top of [`physics.ts`](physics.ts). The
pacing constants — how long the "Cut." card holds, and the wrap — are at the top
of [`engine.ts`](engine.ts).
