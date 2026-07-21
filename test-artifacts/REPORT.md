# Video-editor audit — test report

**Date:** 2026-07-20   **Branch:** `test-suite-audit`
**Suite:** 40 Playwright tests across 14 spec files (`tests/`) — **40/40 passing.**

## How it was tested

- **Runner:** Playwright + full Chromium (`channel: 'chromium'` — the headless
  *shell* can't run the MediaRecorder path the editor uses for export).
- **Target:** the **local vite dev server** (exact working-tree code; guaranteed
  headers; reliable file upload/download automation). Item **13** additionally
  runs against the **live** site `https://fyrebolt.github.io` for real-deployment
  coverage.
- **Fixtures:** three synthetic **VP9/Opus WebM** clips generated with ffmpeg —
  `clip1_red` (2.0s, 440 Hz), `clip2_green` (3.0s, 660 Hz), `clip3_blue`
  (2.5s, 880 Hz) — plus a magenta PNG sticker. (WebM/VP9 because headless
  Chromium seeks it reliably; **H.264 seeking was flaky headless** — a test-tooling
  detail, not a product defect; H.264 decodes fine in real browsers.)
- **Instrumentation (DEV-only, behaviour-neutral):** to assert exact geometry and
  per-instance settings instead of guessing from canvas pixels, a read-only state
  snapshot is published to `window.__ve`, plus `data-testid`s on the transform
  handles / add-menu / scrub ruler. **Every action is driven through the real UI;
  only reads use the hook.** It is compiled out of production
  (`import.meta.env.DEV`). Files touched purely for testability: `VideoEditor.tsx`,
  `transform/TransformBox.tsx`, `project/ProjectTimeline.tsx`. Full list in
  `tests/README.md`.

Artifacts: screenshots in `test-artifacts/screenshots/`, exported video in
`test-artifacts/exports/camera.mp4`, run logs in `test-artifacts/logs/`.

---

## Results by requested item

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Multi-clip stitching | ✅ PASS · transitions ⚠️ **not implemented** | `01-*` screenshots |
| 2 | Add every layer kind | ✅ PASS | `02-all-layer-kinds.png` |
| 3 | Independent resize | ✅ PASS (3 kinds) | `03-*` |
| 4 | Independent rotation | ✅ PASS (2 kinds) | `04-*` |
| 5 | Guide-locks (6 snap types) | ✅ PASS | — |
| 6 | **Per-instance font-boil pools** | ✅ **PASS (no leak)** | `06-two-pools.png` |
| 7 | Delete + confirmation | ✅ PASS | `07-delete-confirm.png` |
| 8 | Undo / redo | ✅ PASS (see note) | — |
| 9 | Play-from-cursor | ✅ PASS | — |
| 10 | Time Machine | ✅ PASS | `10-speedup.png`, `10-freeze.png` |
| 11 | Stickers | ✅ PASS · 1 bug · audio-fx **not implemented** | `11-*` |
| 12 | Export / download | ✅ PASS | `exports/camera.mp4` |
| 13 | Site-wide smoke | ✅ PASS | — |

---

### 1 — Multi-clip stitching ✅ (transitions not implemented)
Added all 3 clips; total base duration = **7.52s** = sum of clip lengths
(2.008 + 3.008 + 2.508). Warped output timeline equals the base (no time-warp).
Sampled the centre pixel at 6 timestamps and confirmed the correct clip shows:
0.6s→red, 1.9s→red, 2.4s→green, 4.8s→green, 5.3s→blue, 7.2s→blue (boundaries at
2.0s and 5.0s). Screenshots `01-clip-at-*`.

**Transition types — NOT IMPLEMENTED.** Clips concatenate as a hard **cut** only;
there is no transition data model (`clips.ts` / `ClipStrip.tsx` / `types.ts` have
no crossfade/wipe/dissolve). The "cut" is verified clean (red→green flips with no
blended frame across the 2.0s boundary). Crossfade/wipe are future work
(matches the "PR#2 transitions" plan).

### 2 — Every layer kind ✅
One of each added via the "+" menu and verified by kind/variant/mode: Entrance
Banner, Caption (boil), Typewriter, Zoom, Time Machine, Sketch, Highlighter,
Dramatic (normal / **inverse** / **reflection**), plus Image + Video stickers =
12 layers. **Static Zoom** is **not** a separate menu entry — it was folded away
(the standalone tool wasn't ported into the layer model); asserted absent.
Time Machine is correctly offered **video-only** (disabled "video only" for image
sources). Screenshot `02-all-layer-kinds.png`.

### 3 — Independent resize ✅
Two instances each of **highlighter** (free 8-handle), **image sticker**
(aspect-locked corner), and **dramatic word** (sizeScale). Resized ONE via its
SE handle; the other instance's stored geometry was **byte-identical** before/after
in all three. Screenshots `03-*`.

### 4 — Independent rotation ✅
Rotated one **highlighter** and one **image sticker** via the rotate widget; the
rotated element's `rotation` changed (>0.05 rad) while the sibling stayed exactly
`0`. Screenshots `04-*`.

### 5 — Guide-locks ✅ (all six)
Global gear settings; SNAP_T = 0.018 of the frame. For each type: enabled it,
dragged near the guide and confirmed a snap; disabled it and confirmed free
positioning.
- **Centre H/V** — box centre snaps to 0.5.
- **Snap-to-border** — edge snaps to 0.
- **Snap-to-object** — a second box's edge/centre snaps to another's.
- **Fit-to-width / Fit-to-height** — a near-full free resize snaps to the full
  frame (x=0,w=1 / y=0,h=1).
- **Snap-to-cursor** — the box centre locks to the pointer.

### 6 — Per-instance font-boil pools ✅ (the critical check — no leak)
Two boil captions set to genuinely different pools (**scripting** and **marker**).
Both **simultaneously** retain their own `pool` after configuring the second — the
core regression assertion (if the old global-pool bug were present, setting the
second would flip the first). Verified at the render level too: the compositor's
`fontFor()` draws from `poolById(el.pool)`, and each caption's resolved settle
font comes from its own pool and the two differ. Screenshot `06-two-pools.png`.

**Broader leak probe (as requested):** `normalize` and `settleFontIndex` are also
per-instance — set A=sketch/normalize-off and B=claude/normalize-on; no cross-leak.
I found **no** setting that leaks between instances. (The project also exposes
"Font pool default" / "Even sizing by default" seeds — these are correctly
*separate* from the per-caption values and only seed newly-added captions.)

### 7 — Delete ✅
Selecting a layer and pressing Delete/Backspace shows a **"Delete layer?"**
confirmation (nothing removed yet); confirming removes only that layer and leaves
others untouched; **Escape cancels** and keeps the layer. Screenshot
`07-delete-confirm.png`.

### 8 — Undo / redo ✅ (with a behaviour note)
Ran add → move → resize → delete, undid back through each (layer reappears in its
resized state → reverts to moved → reverts to added → removed), then redid forward
to the same states.
**Note:** the history coalesces *continuous* edits within a **350 ms trailing
debounce** — a move immediately followed by a resize merges into ONE undo step
unless separated by >350 ms (or a discrete action). This is by design (see
`useHistory.ts`), not a bug, but it means rapid distinct gestures aren't always
individually undoable.

### 9 — Play-from-cursor ✅
Scrubbed to 5.3s (blue clip), pressed Play; `currentSec` resumed **>5.0s** (not
0) and advanced, with blue showing — no restart-at-zero.

### 10 — Time Machine ✅
- **Speed-up** ramp (2×) shrinks the warped output timeline below the base length;
  a `speed:2` keyframe is recorded. Screenshot `10-speedup.png`.
- **Freeze** adds a `speed:0` keyframe and lengthens the warped output. Screenshot
  `10-freeze.png`.
Both verified in the preview via `compileWarp`-driven `timelineDuration`.
**Note:** exact variable-speed profiling of the *exported* file isn't feasible
from a constant-rate re-encode, so speed correctness is verified in preview +
keyframe state; the full export (item 12) exercises the export path end-to-end.

### 11 — Stickers ✅ (1 bug; audio-fx not implemented)
Image and video stickers added; each **repositioned, resized (aspect-locked), and
rotated** with verified geometry changes. **Crop mode** enters/exits correctly via
the panel "Crop image/video" button (transform widget → crop editor → back).
Screenshots `11-image-sticker`, `11-video-sticker`, `11-crop-mode`.

- 🐞 **BUG (minor): double-click-to-crop doesn't work.** The sticker panel
  advertises *"Double-click the sticker to crop"*, but a real double-click never
  reaches `onCanvasDoubleClick`: the first click selects the sticker, which spawns
  the `TransformBox` overlay (`z-20`, `pointer-events-auto`), and that overlay then
  swallows the second click / `dblclick`. The handler itself is correct (entering
  crop when a `dblclick` is dispatched directly on the `<canvas>`). **Repro:** add a
  sticker → double-click it → nothing happens (`croppingId` stays null). **Impact:**
  the advertised gesture is effectively unreachable; the panel button is the only
  working path.
- ⚠️ **Sticker audio-effects — NOT IMPLEMENTED.** The request mentioned an
  "audio-effects feature"; the code has none for stickers. `StickerPanel` exposes
  only Start / Hold / Crop / Remove; embedded sticker audio is hard-muted; a code
  comment references a "procedural appear/disappear SFX feature handled elsewhere"
  but no such data field or UI exists (`sticker/types.ts`, `sfx.ts`). Reported as
  not implemented, not a failure.

### 12 — Export / download ✅
Exported a full composite (3 stitched clips + a boil caption + an image sticker)
via **Export MP4**, captured the download, and verified with `ffprobe`:
- File: `test-artifacts/exports/camera.mp4`, **893 KB** (non-empty).
- Streams: **H.264 video + AAC audio**.
- Duration: **7.565 s** ≈ composited timeline (7.52 s), within recording overhead.

(The export records the preview canvas via MediaRecorder in real time, then
transcodes WebM→MP4 with the single-threaded ffmpeg.wasm core — no COOP/COEP
needed, so it works on GitHub Pages too. First run downloads the ~30 MB core.)

### 13 — Site-wide smoke ✅ (live site)
Against `https://fyrebolt.github.io`:
- Home screen loads with all four app labels.
- Every icon navigates to the right route: App Store→`/appstore/`,
  Camera→`/video/`, Printer→`/printer/`, About Me→`/about/`.
- App Store, Camera (Layer editor) and About pages render with **no console
  errors**.
- **Printer PDF renders** — pdf.js draws the résumé onto a canvas with non-zero
  dimensions, no console errors.

---

## Summary of findings (report-only, nothing fixed)

**Bugs**
1. 🐞 *Minor:* Sticker **double-click-to-crop is non-functional** — intercepted by
   the TransformBox overlay (item 11). Crop works via the panel button.

**Not implemented (reported, not failures)**
2. Clip-to-clip **transitions** (crossfade/wipe) — only hard cuts (item 1).
3. Sticker **audio effects** (appear/disappear SFX) (item 11).
4. **Static Zoom** as a standalone tool — folded out of the layer model (item 2).

**Behaviour notes**
5. Undo history **coalesces continuous edits** within 350 ms (item 8) — by design.

**No leaks found** beyond the one already-fixed pool bug: per-caption `pool`,
`normalize`, and `settleFontIndex` are all correctly per-instance (item 6).
