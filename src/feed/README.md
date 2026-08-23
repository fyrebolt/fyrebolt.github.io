# Doomscroll — `/feed/`

A game about the scroll wheel. The player-facing description lives in the
[root README](../../README.md#-doomscroll-feed); this file is for whoever has to
change the code.

Entry point: [`feed/index.html`](../../feed/index.html) → [`main.tsx`](main.tsx),
registered as the `feed` input in [`vite.config.ts`](../../vite.config.ts) and
listed on the home screen in [`src/home/apps.ts`](../home/apps.ts).

It is deliberately Drift's sibling — same unit-space discipline, same
catalogue-driven modifiers, same "the picture is derived from the transform"
rule — but they share nothing except [`../utils/synth.ts`](../utils/synth.ts)
and the [iOS kit](../ios). Neither game should be able to break the other by
being retuned.

## The one idea

**Everything the feed does to you is scaled by how fast you are moving.**

That is `st.engagement`, and it comes from scroll speed alone:

```
engagement = clamp(1 - |v| / CALM_V, 0, 1)
```

Reading a post, bleeding attention to bait, and an ad deciding it can take the
feed are all the *same* mechanic read off that one number. Nothing asks what
kind of card is on the line before working out how hard it lands — the card kind
only decides what the effect is, never how much of it applies. If you find
yourself adding a second speed test somewhere, that's the bug: it will drift out
of step with this one, and the game stops being about attention.

The second idea is Drift's: **nothing in the simulation knows what a pixel is.**
The viewport is exactly `1.0` unit tall and `aspect` units wide, every card
height and speed below is in those units and in seconds, and only two files
convert — [`scroll.ts`](scroll.ts) divides incoming wheel and drag distances by
the viewport's on-screen height, and [`render.ts`](render.ts) sets one transform
per frame so `1.0` maps back to it.

The deliberate exceptions are the two text passes (card copy, score pops), drawn
under a pixel transform because sub-pixel font sizes rasterise badly. They still
take their positions from `layoutCard`, in units.

## Module map

| File | Owns |
| --- | --- |
| [`scroll.ts`](scroll.ts) | Wheel, drag and keys → one distance in units, plus whether input is still arriving. Accumulates; never interprets. |
| [`quirks.ts`](quirks.ts) | The quirk catalogue and `transformScroll` — the pure part of the lie. |
| [`content.ts`](content.ts) | The feed's copy, and `makeCard`, which derives a card's height from what's inside it. |
| [`engine.ts`](engine.ts) | The rAF loop, momentum, card generation, the read line, quirk scheduling, scoring. |
| [`render.ts`](render.ts) | All drawing. Reads state, mutates nothing. |
| [`types.ts`](types.ts) | Shared shapes, plus `ZONE_Y` / `ZONE_H` (the constants the engine and renderer must agree on). |
| [`sfx.ts`](sfx.ts) | The sound catalogue. Oscillators live in [`../utils/synth.ts`](../utils/synth.ts). |
| [`FeedApp.tsx`](FeedApp.tsx) / [`feed.css`](feed.css) | Shell, HUD, overlays, mute. |

### Why React never sees a frame

Same contract as Drift. The engine hands React only a `onHud(snapshot)`
throttled to 10 Hz (forced on discrete changes) and `onTick(fraction)`, written
straight to the attention bar's `transform` through a ref. If you need a new
per-frame readout, write it to a ref — don't add state.

## How input becomes an offset

Per frame, in `stepScroll`:

1. Drain `scroll.consume()` — a distance in units, plus `live` (did anything
   arrive?) and `held` (is a finger still down?).
2. Run it through `transformScroll` (Sticky → Inverted → Firehose, in that fixed
   order so the same set always composes to the same feel).
3. Integrate, in one of three ways:
   - `molasses` — a first-order lag on the *rate*, time constant `HEAVY_TAU`
   - input still arriving — `y += d`, and the coast speed chases `d/dt` with
     time constant `FLING_TAU`
   - nothing arriving — coast: `y += v·dt`, `v *= e^(−DECAY·dt)`
4. Apply forces: `autoplay` (constant drift) and `rubberband` (a pull toward an
   anchor that trails you by `RUBBER_TAU`).
5. Apply `snap`, which springs the nearest card's centre onto the read line —
   but only below `SNAP_V`, so a real flick still travels.
6. Clamp: you may reverse until the oldest retained card has its top edge on the
   line, and no further.
7. Recompute `engagement`.

`live` is a real signal, not the absence of one — a feed that keeps travelling
after your hand stops *is* the feel of the thing, so "no input this frame" is
what selects the coast branch.

## Adding a quirk

1. Add an entry to `QUIRKS` in [`quirks.ts`](quirks.ts): `id`, `name`, a one-line
   `hint` for the banner, a `color`, its `kind`, and any `excludes`.
2. If it's a `transform`, implement it inside `transformScroll`. **That's all** —
   the HUD chip, the banner, the scheduler and the rail all read the catalogue,
   and the rail derives its gain from `transformScroll` itself.
3. If it's `integration` or `force`, it belongs in `stepScroll` instead, and
   `transformScroll` must leave the distance untouched.

Exclusions must be mutual; [`test/feed-quirks.test.mjs`](../../test/feed-quirks.test.mjs)
enforces it (and caught exactly that mistake once already).

### The rail is derived, not drawn to match

`scrollGain` recovers the live signed gain by pushing `1` through the *real*
`transformScroll`. The rail's tick spacing and its arrow direction come from
that number, so under Firehose the ticks spread and under Inverted the arrow
flips, for free and forever. Don't "optimise" it into a hand-written multiplier:
if the rail and the transform ever disagree, the game promises one direction
while taking another, which is unplayable rather than hard.

## Tuning

All of it is the constant block at the top of [`engine.ts`](engine.ts).

| Knob | Value | Effect |
| --- | --- | --- |
| `START_ATT` / `ATT_CAP` / `POST_ATT` | 20 / 26 / 2.6 s | The clock. The bar reads against `ATT_CAP`, so it opens ~77% full and reading visibly buys headroom. |
| `CALM_V` | 0.8 units/s | Where engagement hits zero — a little under one screen a second. The single most load-bearing number in the game. |
| `READ_TIME` / `HOOK_TIME` | 0.8 / 1.6 s | Dwell to bank a post; dwell before bait hooks you. Bait must always be the slower of the two. |
| `BAIT_DRAIN` | 2.8 /s | Attention lost per second of full engagement with bait, on top of the base drain. |
| `AD_TRIGGER` / `AD_HOLD` | 0.34 / 1.25 s | How slow you have to be for an ad to take the feed, and how long it keeps it. |
| `POSTS_PER_WAVE` | 6 | Posts banked per wave. Each wave raises the drain and the bait/ad share of the mix. |
| `QUIRK_LIFE` / `QUIRK_GAP` | 9.5 / 1.8 s | How long a quirk holds, and the breath between them. |
| `quirkSlots()` | 0 / 1 / 2 / 3 | Simultaneous quirks at waves <2, <4, <7, 7+. Wave 1 is deliberately clean so scrolling can be learned. |
| `DECAY` / `SLICK_DECAY` | 3.2 / 0.4 /s | Coast friction. `SLICK_DECAY` is the whole of the Slick quirk. |
| `MAX_V` / `REST_V` | 8 / 0.05 units/s | Speed ceiling (one oversized wheel event implies a hand speed no hand had) and the point below which the feed is declared still. |

A change to any of these is worth re-running the headless playtest in
[`test/feed-engine.test.mjs`](../../test/feed-engine.test.mjs) over: the
"stopping on a post banks it" and "flying past banks nothing" cases are the two
halves of the core loop, and they will notice.

## Gotchas

- **The wheel event is always swallowed.** `scroll.ts` calls `preventDefault`
  unconditionally, even when the game isn't running, because letting the page
  take a share would scroll the app shell out from under the feed. The stage
  also sets `touch-action: none` so a finger drag doesn't pan the page.
- **The first measurement can fail.** In dev, Vite injects CSS from JS, so the
  canvas can still be 0×0 when the effect runs and `resize` bails. The frame
  loop retries while `view.w <= 1`; don't remove that guard, and don't replace
  it with a `getBoundingClientRect` on every frame either.
- **The read line, not overlap, decides focus.** Exactly one card can contain
  the line, and the line landing in a gap between cards is a legal nothing
  (`st.focus === -1`). A run opens with a card centred on the line, which is why
  the reverse clamp is `cards[0].top - ZONE_Y` and not something tighter — a
  tighter floor used to push the line past a short first card and open the run
  on a gap.
- **An ad holding the feed is also the focused card.** `stepFocus` bails while
  `st.pin` is set, or the ad re-triggers its own hold every frame and never lets
  go.
- **Card copy is a headline plus skeleton bars, never sentences.** It scans as a
  feed, it never needs wrapping or truncating at four window sizes, and it keeps
  the player's eyes on the one line that decides what the card is.
- **Glows are radial gradients, never `shadowBlur`** — same reason as Drift.
- **The game cannot be verified in Claude's Browser pane.** That surface reports
  `document.hidden: true` and a 0×0 viewport, so `requestAnimationFrame` never
  fires, `ResizeObserver` never delivers, and `getBoundingClientRect` returns
  zeroes. The React shell and the HUD still work there (the score and the
  attention bar update), but nothing is ever painted. Verify the drawing in a
  real browser; verify the *mechanics* with
  [`test/feed-engine.test.mjs`](../../test/feed-engine.test.mjs), which drives
  the real loop against a stub canvas and is the better check anyway. Same
  limitation as `/game` and `/video`.
