# Hastin Chen — Portfolio

An iPad-style personal site. The landing page is a portrait iPad home screen; each
icon "launches" into a real, bookmarkable mini-app that shows off a different piece
of work. Built with React 19, TypeScript, Vite, and Tailwind CSS v4, and deployed
to GitHub Pages.

Live site: <https://fyrebolt.github.io/>

---

## Using the site

Everything runs in the browser — no accounts, no backend, nothing is uploaded to a
server. Tap an icon on the home screen to open an app; use the **Home** button in
each app's top bar to come back. The layout is responsive: on a phone the iPad
frame becomes a full-screen surface, and on a desktop it sits centered as a device.

### The apps at a glance

| App | Route | What it does |
| --- | --- | --- |
| 🏠 **Home screen** | `/` | The iPad home screen itself — the icon grid and dock that launch everything else. |
| 🛍️ **App Store** | `/appstore/` | Portfolio of projects, laid out like Apple's App Store. |
| 🎥 **Camera** | `/video/` | Layer-based video editor. Decoding, compositing and MP4 export all happen in the browser. |
| 🖨️ **Printer** | `/printer/` | Renders the résumé PDF to a canvas with a "printing" animation. |
| 👋 **About Me** | `/about/` | Bio, skills, writing, and contact links. |
| 🎯 **Drift** | `/game/` | A game that takes your cursor with Pointer Lock and hands back a warped one. |
| 📱 **Doomscroll** | `/feed/` | A game that takes your scroll wheel. Stop to read, fly past the bait, relearn scrolling every ten seconds. |
| 🎞️ **GIF Shop** | `/gif/` | Drop any video in, get a GIF back. Two-pass palette, full source quality by default, converted in the tab. |
| 🎬 **Retake** | `/retake/` | A puzzle platformer where every attempt is recorded, and your past takes become platforms you stand on. |
| 📸 **Instagram Tracker** | `/instagram/` | Who follows and unfollows you, diffed once a day from one committed history file. |
| 💼 **LinkedIn Tracker** | `/linkedin/` | The same idea for LinkedIn, built around profile views. **Unfinished** — deliberately not on the home screen. |

Each app has its own section below. For the scripts that feed the two trackers,
see [Command-line tools](#command-line-tools).

### 🏠 Home screen (`/`)

The iPad home screen: a grid of app icons plus a dock of favorites. Each icon is a
real route you can bookmark directly. Add or reorder apps by editing a single list
— [`src/home/apps.ts`](src/home/apps.ts).

The grid pages sideways, like a real iPad. Nothing here scrolls vertically —
the dock has to stay reachable at the bottom of the frame on any screen — so the
screen measures the room the grid actually has, fits as many icons into it as
will go, and spills the rest onto the next page. Swipe, scroll, press ← / →, or
tap a page dot to move between pages; the icon size shrinks a step at a time only
when the frame gets too cramped for a proper grid. The fitting rules live in
[`src/home/layout.ts`](src/home/layout.ts) and are tested in
[`test/home-layout.test.mjs`](test/home-layout.test.mjs).

### 🛍️ App Store — Portfolio (`/appstore/`)

A portfolio styled like Apple's App Store: a featured hero card and a scrollable
"All Projects" list. Tap any card for details. Projects are data-driven — edit
[`src/appstore/projects.ts`](src/appstore/projects.ts) to change them.

### 🎥 Camera — Video Editor (`/video/`)

A layer-based in-browser video/photo editor. Everything — decoding, compositing,
and MP4 encoding via ffmpeg.wasm — happens locally in your browser; nothing is
uploaded. The editor composites one **base sequence** of clips against any number
of stacked **layers**, all on a single shared timeline, and exports one MP4.

> Prefer the older one-tool-at-a-time editor? It's frozen at
> [`/video-classic/`](https://fyrebolt.github.io/video-classic/). The guide below
> is for the current `/video/`.

#### Getting started

Drag a photo or video onto the drop zone (or click to browse), then add more clips
and layers as you go. Uploaded media is remembered in your browser's asset library
for reuse in later projects. Two things stay local and persistent on their own:

- **Autosave** keeps the whole project (including the original media) in the
  browser's IndexedDB, so a refresh or crash restores where you left off.
- **Save / Load project** writes a single `.json` file for backup or transfer. It
  embeds the original media, so the file is self-contained — but larger than the
  footage that went into it.

#### The base sequence (clips)

The strip under the preview is the ordered list of clips that play back-to-back.

- **Trim** each clip with the in/out handles on its card; **reorder** by dragging
  the grip or the ◀ ▶ arrows; **duplicate** (⧉) or **remove** (✕).
- **Split** (the ✂ Split button, or the razor) cuts the clip under the playhead
  into two independent clips you can trim, grade, and transition separately.
- Select a clip to edit its **audio** (a volume-automation curve over the clip's
  original sound, plus mute) and its **colour** (per-clip brightness / contrast /
  saturation) in the right-hand panels.

#### Transitions between clips

Each boundary between two clips carries a **transition**, shown as a chip on the
clip strip. Click the chip to open the Transition panel; drag it sideways to set
the duration. Eight kinds: **Cut** (default hard cut), **Crossfade**, **Wipe**
(directional), **Push**, **Iris**, **Zoom**, **Glitch**, and **Flash**. The window
straddles the cut, so adding or changing a transition never shifts the timing of
anything else on the timeline. Overlapping types crossfade the audio too; each can
fire an optional synthesized whoosh/zap at the cut. **🎲 Randomize** rolls a
transition onto every boundary at once.

#### Layers

Use **+ Add layer** to stack effects over the base sequence. Each is
multi-instance (unless noted), draggable on the canvas where it applies, and timed
on its own timeline row:

| Layer | What it does |
| --- | --- |
| **⚔️ Entrance Banner** | A Smash-style character-intro banner. Its freeze point holds the whole composite for a beat as the banner locks in. |
| **💬 Caption** | Animated text with a "font boil" reveal that cycles through a font pool. |
| **⌨️ Typewriter** | Text that types on (and optionally deletes) character by character. |
| **🔍 Zoom** | Sequential zoom keyframes — drag a crop rectangle, set each transition, and the frame animates between them. One track; non-destructive. |
| **⏱️ Time Machine** | A speed curve over the footage: slow-mo, fast-forward, and freezes. One track; video only. |
| **✏️ Sketch** | Draw freehand on a mini pad, then project it as a resizable overlay that animates on like it's being drawn live. |
| **🖍️ Highlighter** | Sweep a resizable, recolorable highlight box over any part of the frame. |
| **🖼️ / 🎬 Sticker** | Overlay a cropped image or video on top of the footage. |
| **🎵 Music track** | An independent audio track with its own volume curve; unaffected by Time Machine speed changes. |
| **🔠 Dramatic word** | A big uppercase call-out — normal, **inverse** (spotlights the word through the frame), or **reflection**. |

#### Global controls & export

Set the output **aspect ratio** and **fill mode**, apply a **global colour grade**
over the finished composite, and toggle **sound effects**. Undo / redo (or ⌘/Ctrl-Z)
covers every edit. **Play** previews the composite; **Export MP4** records it.

> Export records the composite in real time and encodes to H.264 MP4 at a
> quality-first bitrate that scales with resolution (up to 4K). The first export
> downloads the ffmpeg encoder once, then caches it. It works best in
> Chromium-based browsers; where native MP4 recording isn't available it captures
> WebM and transcodes. Because it's a real-time capture, an export takes about as
> long as the video is.

### 🖨️ Printer — Résumé (`/printer/`)

Renders a résumé PDF to a canvas with a playful "printing" animation. **Open PDF**
opens the raw file; **Print again** replays the animation. Swap
[`public/resume.pdf`](public/resume.pdf) for the real résumé — no code change needed.

### 👋 About Me (`/about/`)

Bio, skills, writing, and contact links. Content lives in
[`src/about/data.ts`](src/about/data.ts).

### 🎯 Drift (`/game/`)

A game about losing control of your own cursor.

Click **Take the cursor** and the page calls
[Pointer Lock](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API):
the real pointer disappears and the browser stops reporting a position at all —
only raw `movementX/Y` deltas. The game integrates those deltas into a cursor of
its own, which means it gets to decide what your hand meant.

**Everything is a ratio, never a pixel.** Deltas are divided by the arena's
on-screen height before anything else touches them, and the whole simulation
runs in *arena units* where the arena is exactly 1.0 tall. Sweeping the mouse
across the arena always sweeps the arena, whether that's 300 px on a laptop or
900 px on a monitor — so difficulty doesn't change when the window does, and
resizing mid-run is not an exploit. Only [`render.ts`](src/game/render.ts) and
[`pointer.ts`](src/game/pointer.ts) know what a pixel is.

Collect cyan orbs (each buys time and builds a combo), dodge red hunters (three
hits ends the run), and survive the clock. Every wave the arena adds a hunter —
and from wave 2 it starts rewriting your controls.

| Warp | What it does to your hand |
| --- | --- |
| **Mirror** / **Flip** | Negates one axis. |
| **Swap** | Exchanges the axes. |
| **Spin** | Rotates your frame of reference — and keeps rotating. |
| **Twitch** | Doubles the gain. |
| **Ice** | Input becomes momentum instead of position; you steer a puck. |
| **Syrup** | A first-order lag on velocity — the cursor leans in late and overshoots. |
| **Tide** | A constant drift, slowly changing direction. |
| **Wells** | Gravity wells that pull (or shove) you as you pass. |

Wave 2 runs one warp at a time, wave 5 runs two, wave 8 runs three. Warps that
would cancel each other out (Spin + Swap, Ice + Syrup) never co-occur.

The floor grid is the tell. It's drawn through the *same* matrix your input goes
through — recovered by pushing the basis vectors back through the real transform
— so it physically cannot describe a warp the controls aren't applying. Under
Spin the grid turns; under Twitch it coarsens; under Mirror it flips. A faint
white chevron on the cursor shows the direction your hand actually went, which
under Spin is often the only honest thing on screen.
[`test/game-warps.test.mjs`](test/game-warps.test.mjs) pins the transform and
asserts the grid basis reproduces it exactly.

**Learn the warps** runs a guided tutorial instead: no clock, no score, no cost
to being hit, and one warp at a time. Each lesson names the warp, says what to
actually do about it, and waits — collecting the orb is what moves you on, so
you can sit inside Spin for a minute if that's what it takes. Every warp above
gets a lesson, and a test fails if a new one doesn't.

<kbd>Esc</kbd> releases the pointer and pauses. The pause card is where you can
restart the run, drop back to the title screen, or leave a lesson (a second
<kbd>Esc</kbd> does the same). Pointer lock is a nicety, not a requirement — if
it's denied (touch devices, embedded frames), the game differences client
coordinates into the identical pipeline and plays the same, minus the "you
cannot leave the arena" part.

### 📱 Doomscroll (`/feed/`)

A game about the scroll wheel, and about what a feed is for.

An endless column of cards travels past a **read line** across the middle of the
screen. Stopping on a post reads it: that banks points and buys back attention,
which is the clock. But everything on the line works on you the same way, and
red bait drains attention while you look at it — so the only defence is speed,
and the only way to score is to stop.

**One number does all of it.** `engagement` is derived from scroll speed alone:
a standstill is total engagement, a flick past is none. Reading a post, bleeding
attention to bait and triggering an ad are the same mechanic seen from three
sides. Nothing in the game asks what kind of card you are looking at before
deciding how hard it lands.

| Card | What it does on the line |
| --- | --- |
| **Post** | Reads in about a second at a standstill. Banks points, buys attention, builds a combo. |
| **Trending** | A rarer post: slower to read, worth two and a half times as much. |
| **For You** (bait) | Drains attention fast while you look at it, and hooks you if you linger. Three hooks ends the run. |
| **Sponsored** | Takes the feed for a second and a quarter — unless you were already moving fast enough to blow past it. |

Like Drift, everything is a ratio and never a pixel: wheel notches, finger drags
and arrow keys are all divided by the viewport's on-screen height before
anything else sees them, and the whole simulation runs in *feed units* where the
viewport is exactly 1.0 tall. A flick covers the same fraction of the feed on a
laptop and on a monitor. Momentum is real — the feed coasts after your hand
stops, and comes to rest on its own.

From wave 2 the algorithm starts rewriting what scrolling does.

| Quirk | What it does to your scroll |
| --- | --- |
| **Inverted** | Down is up. |
| **Firehose** | Doubles the gain. |
| **Sticky** | Swallows any scroll under a threshold, so small corrections do nothing. |
| **Slick** | Almost no friction; a flick keeps going for ten screens. |
| **Molasses** | A first-order lag — the feed leans into a flick late and drags. |
| **Snap** | Pulls the nearest card onto the line, whether or not you wanted that card. |
| **Autoplay** | Scrolls itself. |
| **Rubberband** | An anchor trailing a couple of seconds behind, pulling you back up. |

Wave 2 runs one quirk at a time, wave 4 runs two, wave 7 runs three. Quirks that
would cancel out (Slick + Molasses, Slick + Snap, Autoplay + Rubberband) never
co-occur.

The rail down the right-hand side is the tell — Drift's floor grid, in one
dimension. Its ticks are spaced by the distance one notch of your hand now
covers, and its arrow points wherever a downward flick actually sends the feed,
both recovered by pushing a unit scroll through the *real* transform. So it
cannot promise a direction the controls aren't taking, and under Sticky it draws
the dead band at exactly the size being swallowed.
[`test/feed-quirks.test.mjs`](test/feed-quirks.test.mjs) pins the transform and
asserts the rail's gain reproduces it;
[`test/feed-engine.test.mjs`](test/feed-engine.test.mjs) drives the whole loop
headlessly — stub canvas, hand-cranked clock — and checks the things a
screenshot can't show, like whether slowing down is really what makes a card
land on you.

<kbd>Esc</kbd> pauses. Scroll with the wheel, by dragging, or with
<kbd>↑</kbd> <kbd>↓</kbd> and <kbd>PgUp</kbd> <kbd>PgDn</kbd> — all three feed
the identical pipeline, so the game plays the same on a trackpad, a phone and a
keyboard.

### 🎬 Retake (`/retake/`)

A puzzle platformer about cooperating with your own past attempts.

Every take is recorded. When one ends — you fell on the spikes, the clock ran
out, or you pressed <kbd>R</kbd> to **cut** — it doesn't reset the level. Your
previous performance keeps playing alongside the new one, as a solid body: it
blocks you, and you can stand on it. So the way you reach a shelf three tiles up
is to spend a take walking to the right spot, cut, and then climb yourself.

That makes **Cut** the real verb of the game. It isn't giving up; it's placing a
stand-in. And because a past take replays *from the top* each time, where you
leave it is a question about position and timing at once.

Five shots, and each new one asks for one more storey — which is to say, one
more take. The whole thing is on a soundstage: a slate before each take, a film
strip counting what you've spent, and the mark taped on the floor.

**Determinism is the load-bearing property.** The simulation
([`src/retake/sim.ts`](src/retake/sim.ts)) has no wall clock, no randomness and
no frame-rate term; the engine spends real time into whole fixed steps through
an accumulator, so a 60 Hz display, a 144 Hz display and the test suite all
advance the world identically. The player stands on a recorded path, so if the
same inputs could produce two different runs, the ghosts would drift out from
under their feet. [`test/retake-levels.test.mjs`](test/retake-levels.test.mjs)
asserts it directly, position by position.

Everything in the shot list is drawn against two numbers from
[`src/retake/physics.ts`](src/retake/physics.ts): a jump rises about 2.55 tiles
and carries about 5.67. That is exactly why a 3-tile shelf is out of reach alone
and possible standing on one take, and why a 4-tile rise costs two.
[`test/retake-physics.test.mjs`](test/retake-physics.test.mjs) pins both, so
retuning the feel can't quietly make five levels trivial.

The levels themselves are ASCII grids, and the test suite **plays every one of
them** — a scripted campaign of takes per shot, driven through the same
`stepSim` the browser calls, passing only if the performer ends up standing on
the mark. A puzzle platformer with an impossible level isn't a hard game, it's a
broken one, and nothing short of playing it proves otherwise. Notes for changing
any of this are in [`src/retake/README.md`](src/retake/README.md).

### 🎞️ GIF Shop (`/gif/`)

Drop a video anywhere on the page and a GIF comes back, ready to download.
Anything ffmpeg can demux works — MP4, MOV, WebM, AVI, MKV, an existing GIF, or
a still image — and several files at once queue up and convert one after
another. Like the video editor, it runs entirely on ffmpeg.wasm inside the tab:
nothing is uploaded, which is the only reason it's reasonable to accept
"anything".

**Why it looks like the source.** A GIF holds 256 colours, so the only question
that matters is *which* 256. Converting in one pass uses ffmpeg's fixed web
palette, and anything with a gradient in it bands immediately. So each file gets
two passes ([`src/gif/convert.ts`](src/gif/convert.ts)): the first reads the
whole clip and generates a palette fitted to that clip, the second re-reads it
and maps onto that palette. `stats_mode=diff` weights the palette toward the
parts of the frame that actually move, and `diff_mode=rectangle` limits each
frame to the rectangle that changed, which is what keeps mostly-static footage
from producing an enormous file.

The two passes are run as separate `exec`s rather than one `split` filter graph
on purpose: `split` has to buffer every decoded frame until the palette exists,
which exhausts the wasm heap on a long clip. Reading the input twice is slower
and always finishes.

**Defaults are the full-quality ones** — the source's own frame rate and its own
resolution, no resampling at all. Frame rate and width are there to trade
quality for size when a file has to be smaller; width is applied as
`min(iw, W)`, so choosing a size larger than the source is a no-op rather than
an upscale that costs bytes and adds no detail.

The filter graphs live apart from the wasm in
[`src/gif/options.ts`](src/gif/options.ts), because that is the part worth
testing directly — a malformed filter string is a silently wrong GIF, and a
string is much easier to assert on than an image.
[`test/gif-options.test.mjs`](test/gif-options.test.mjs) pins both passes: that
the default really does emit no rate or size filter, that the palette is fitted
and capped, that pass two wires the palette in as its second input, and that a
width larger than the source can't upscale.

### 📸 Instagram Tracker (`/instagram/`)

Tracks who follows and unfollows you, once a day. The site is static, so all the
data lives in one committed file — [`public/instagram/history.json`](public/instagram/history.json) —
and the app just renders it.

**People** is the main view: five lists over the same two sets, each searchable
and sortable (Recent / Oldest / A–Z), windowed so a few thousand rows scroll
smoothly.

| List | Who's in it |
| --- | --- |
| Followers | Everyone who follows you |
| Following | Everyone you follow |
| Mutuals | You follow each other |
| You don't follow back | They follow you, you haven't followed back |
| Don't follow you back | You follow them, they haven't followed back |

Above the lists, a reciprocity bar splits the whole graph into mutual /
one-way-in / one-way-out. Below the chart, **Daily activity** buckets every
detected follow and unfollow by day.

#### Setting up the daily pull

Instagram has **no public API for follower lists** — the Graph API only returns a
follower *count*, no names. So the pull uses the same private web endpoints
instagram.com itself calls, authenticated with your own session cookie. Two
consequences worth knowing up front: it's automated collection (which Instagram's
ToS disallows), and it runs from your own machine on purpose — datacenter IPs like
GitHub Actions runners get challenged within days.

1. **Add your session cookie.** Run the setup script — it prompts for one value
   and writes `scripts/.instagram-secrets.json` (gitignored, mode 0600):

   ```bash
   node scripts/instagram-setup.mjs
   ```

   **Paste the whole `cookie:` header** when it asks. From instagram.com while
   logged in: DevTools (⌥⌘I) → Network → reload → click any request to
   instagram.com → Request Headers → right-click the `cookie:` row → Copy value.

   That one header carries everything the pull needs: `sessionid`, `csrftoken`,
   and your numeric id — which the script also derives from the sessionid itself,
   so there's no second row to hunt for. Before it finishes it makes one
   read-only request to instagram.com and tells you whether the cookie is
   actually live, rather than leaving you to find out at 09:20 tomorrow.
   `--no-verify` skips that check.

   **This is also how you refresh an expired session** — same command, and it
   keeps your `agentToken` and other settings. See "Setting up the daily pull"
   below for how often to expect it.

2. **Test it without writing anything:**

   ```bash
   node scripts/instagram-pull.mjs --dry-run
   ```

3. **Schedule it** (launchd, first attempt 09:20 by default):

   ```bash
   ./scripts/instagram-schedule.sh install
   ```

   `status`, `run`, `logs`, and `uninstall` do what they say — `status` reports
   whether today's pull has happened yet. The scheduled job runs with `--commit`,
   so each day's pull is committed and pushed on its own — which means your
   follower and following lists are public on the live site. Drop `--commit` from
   the plist if you'd rather keep the data local and publish by hand.

**Retries, but one pull a day.** The job is scheduled *every hour* from the
chosen time until midnight (15 attempts by default), while `--once-daily` makes
it a no-op once a run has already succeeded that day. `history.json` is written
only on success, so its `generatedAt` is itself the record of the last good run —
no separate stamp file to drift out of sync. So a Mac asleep at 09:20 still gets
its pull at 10:20, or whenever it next wakes, and a satisfied day costs one file
read and no network at all. A *failed* attempt leaves the file untouched, so the
next hour tries again — meaning a cookie you re-paste at lunchtime recovers the
same day rather than waiting for tomorrow.

Failure notifications are de-duplicated to one per day per kind, so a dead cookie
alerts you once instead of fifteen times.

**Publishing is guarded, because a pull that can't publish looks fine.** The job
runs against the same working copy you develop in, so `--commit` checks two things
before it trusts `git`. If the repo is on a feature branch or a detached HEAD it
writes `history.json` and stops there — committing would park the data somewhere
that never deploys and leave it to be picked back out of your feature history —
telling you how to publish it by hand. And if the push is rejected because
`origin` moved on, it rebases (`--autostash`, since the working copy is yours) and
pushes once more, rather than leaving the commit stranded locally. Both cases
notify and exit 1, so "the pull worked but the site is behind" never passes for
success.

**When is the next one?** Click the green **Live data** badge on the tracker page.
It opens the collection details: when this reading was taken, how, the totals it
holds, the retry window the job is installed on, and the next attempt —
`12:20 PM (in 14 minutes)` if today's pull hasn't landed, or tomorrow's date and
time if it has, since `--once-daily` means the intervening hourly firings will
no-op. A **Today** line says outright whether the day's pull has landed — that
one is answered by `generatedAt` alone, so it's reliable no matter what else is
known.

The page is static and can't see the Mac, so each successful pull records its own
schedule (read straight out of the installed LaunchAgent) into `history.json`;
re-install at a different hour and the page corrects itself on the next run. The
times shown are the job's wall clock, labelled with its zone when you're reading
from somewhere else. A file that carries no schedule — written by a manual run,
or before this existed — falls back to the installer's default of 09:20 hourly
and marks the row **Assumed**, so you still get a time without it being passed
off as fact.

The first run only records a baseline; diffs start the next day. Expect to
re-paste the cookie every few weeks — the script fails with a clear message
rather than silently recording nothing, and recovering is one command:

```bash
node scripts/instagram-setup.mjs
```

You don't need to restart the scheduled job afterwards; its next hourly attempt
reads the new file, so a cookie refreshed at lunchtime still gets that day's pull.

**Guard against phantom unfollows.** A throttled or truncated read looks exactly
like a mass unfollow to a diffing tracker, so the script cross-checks what it
paged against the count Instagram reports for the profile and refuses to write if
it's short (or if the follower count halved since the last run). `--force`
overrides it when a drop is genuinely real.

Beyond that, every candidate change is confirmed against the live relationship
before it becomes history, and the stored lists only ever lose someone to a
settled unfollow — a read that simply misses a page can't delete anyone.

**And the other way round.** That caution had a failure mode: an account whose
profile endpoint never answers cleanly could never be confirmed gone, so it was
missing from every read, re-detected as an unfollow every run, discarded every
run, and stuck in the list forever. Two things settle it now:

- A **404 is an answer**, not a failure to answer. A handle that no longer
  resolves isn't still following you.
- **Absence outlasts churn.** Paging churn is transient by definition — the
  accounts a bad page drops are back in the next read. Someone missing from three
  consecutive reads is not churn, so an unfollow nothing could verify is accepted
  on the strength of the streak alone, and the event records that it was inferred
  rather than checked. A *contradicted* event is never rescued this way:
  Instagram saying the relationship is live outranks a read that keeps missing it.

#### Keeping the request footprint small

Instagram flags accounts for looking automated, and the two things that make this
job look that way are volume and persistence. Both are capped.

**A refusal ends the day, rather than starting fourteen retries.** The LaunchAgent
fires hourly and stops as soon as a run succeeds — right for a Mac that might be
asleep at 09:20, wrong once Instagram has actually said no, because then the
firings aren't catching a missed slot, they're knocking on a door that was just
shut. A failure now arms a cooling-off period, and the unattended job honours it:
45 minutes after the first failure in a row, then 3, 6, 12 and 24 hours. A failure that
needs a person (expired cookie, checkpoint) never retries inside 6 hours, because
nothing changes until someone re-pastes a cookie. The first rung is 45 minutes
rather than an hour so a single refusal doesn't cost the next hourly firing —
this job has recovered on its own that way, refused at 09:20 and through at
10:20, and an hour armed at 09:20:06 would have missed it by six seconds. Success clears the count, a git
failure doesn't arm one — that's not Instagram's fault — and **a person is never
held**: "Update now", a scheduled one-off and `--force` all run immediately. The
panel shows the hold, so a waiting job doesn't read as a dead one.

**A quiet day costs one request instead of forty.** Paging is nearly the whole
budget of a run — about one request per 50 accounts, twice over — and the profile
read at the start already reports the authoritative totals. If neither total has
moved since the last full read, there is nothing to diff, so the run stops there
and writes the day's snapshot from what it already knows.

The trade is deliberate and bounded: equal totals don't mean an unchanged *set* —
one follow and one unfollow on the same day net zero — so the lists are re-paged
in full every 2 days regardless. Churn hiding behind a stable total is still
found; the only thing lost is the date it gets stamped with. On an account that
changes most days this fires rarely, which is fine: the retry storm was the
expensive part.

And when you know the totals are lying, **Re-read lists** — next to "Update now"
— pages both regardless. `--repage` does the same from a terminal. Deliberately
not `--force`: that one also overrides the completeness guard, and a button has
no business switching off the protection against recording phantom unfollows.

#### The "Update now" button

The deployed site is static, so the page itself can't pull anything — but a
browser *on this Mac* can reach `127.0.0.1`, even from an `https://` page
(loopback is exempt from mixed-content blocking). A small local agent takes
advantage of that:

```bash
./scripts/instagram-schedule.sh agent-install
```

That prints a generated passphrase, which you enter the first time you press
**Update now**; after that it's remembered in the browser. The button only
appears when the agent answers, so on your phone — or in anyone else's browser —
it simply isn't there. While a pull runs it shows live progress, and when it
finishes the page loads the new numbers straight from the agent rather than
waiting out the GitHub Pages redeploy.

`agent-status`, `agent-logs` and `agent-uninstall` do what they say.

#### Stopping a run part-way

While a pull is in flight the button becomes **Stop**, which asks first and then
ends the run: `SIGTERM` to the pull's whole process group, and `SIGKILL` to
anything still standing five seconds later. The group matters — the pull spawns
`git`, and a "cancel" that leaves a `push` running underneath it isn't one.

Nothing has to be rolled back, which is why this is safe to offer at all: the
pull writes `history.json` in one step at the very end and commits after that, so
a run stopped part-way has touched nothing. The only cost is the work it threw
away, plus the usual two-minute cooldown before the next run may start. Stopping
the agent itself (`agent-uninstall`, or Ctrl-C) takes a running pull down with
it, rather than orphaning it.

#### What the tracker last *tried*

`history.json` records the last pull that **worked**, which is the wrong file to
ask whether the thing is still running: an expired cookie writes nothing, so a
tracker that has been failing all week looks exactly like one that isn't due yet.

So every attempt leaves a note in `scripts/.instagram-attempt.json` — when it
ran, who set it off (the daily job, a scheduled one-off, or by hand), how it
ended and, if it failed, the reason and what to do about it. The **Live data**
panel shows it as a "Last attempt" line under "Collected".

Like the buttons, that line comes from the local agent and appears nowhere else —
which is the only place it could come from. A failed pull produces no commit, so
the published site has no way to hear about it.

#### Scheduling one pull at a time you pick

Next to it, **Schedule…** arms a single extra run for a time you choose — for
catching the surge right after a post goes up, without touching the daily job.
Only one is armed at a time, it shows up as a "Pull scheduled for …" line you can
cancel, and the agent writes it to `scripts/.instagram-oneshot.json` so a reboot
or a restart doesn't quietly lose it.

The agent checks every 20 seconds rather than sleeping on a timer, because a
timer set across a lid-close doesn't fire on time. That means a slot the Mac
slept through fires as soon as it wakes — unless it's more than six hours late,
which is dropped instead: a pull at 4am is not what "schedule it for 9pm" meant.

**How it's kept safe.** CORS does not stop a request from arriving — it only
stops the *page* reading the response — so any site you visit could fire a
request at that port. Four things make that harmless:

- `GET /health` has no side effects and reveals nothing but liveness. Everything
  else needs the token.
- `POST /pull` requires a custom header, which forces a CORS preflight. The
  agent refuses the preflight for any origin outside its allowlist, so a hostile
  page's request dies at the `OPTIONS` and never executes. The origin is checked
  again on the request itself, since a non-browser client skips CORS entirely.
- The token is compared in constant time and lives only in `localStorage` for the
  allowed origin, where no other site can read it.
- It binds to `127.0.0.1` only (verified unreachable over the LAN), runs one
  fixed action rather than arbitrary commands, allows a single concurrent run,
  and enforces a two-minute cooldown so a stuck button can't trigger Instagram's
  rate limiting.

#### Backfilling real follow dates

The private API doesn't say *when* someone followed you, so accounts first seen by
the daily job are dated from that day. To get the true dates, request the official
export (Accounts Center → Download your information → **Followers and following**,
JSON) and drop the `.zip` onto the tracker. It's unzipped and parsed entirely in
the browser — nothing is uploaded — and the real dates are merged in, then
preserved by every later pull. It's also the fastest way to seed the whole thing
before the first scheduled run.

Sample data ships committed so the app is demoable without any of this; regenerate
it with `node scripts/gen_sample_instagram.mjs`.

### 💼 LinkedIn Tracker (`/linkedin/`) — unfinished

> **Status: work in progress. Not on the home screen.**
>
> The app is built and works; the data pipeline behind it is not finished.
> Measured against a real 1012-connection account, LinkedIn stops answering a
> scripted session after roughly half a dozen requests and then invalidates it —
> three separate runs died at the same point. That makes the daily profile-view
> collection, which is the whole reason the tool exists, unreliable.
>
> | Piece | State |
> | --- | --- |
> | The app: charts, viewer timeline, people lists, person sheet | **works** (verified in-browser) |
> | Importing the official CSV export → all connections with exact dates | **works**, needs no API |
> | Reading connections from the API | **works for one page**; full paging is impossible (26 pages needed, ~1 allowed) |
> | Reading profile views from the API | **untested** — the session dies before reaching it |
> | Follower counts | **no working endpoint found** |
>
> It's reachable at `/linkedin/` and ships committed sample data, so everything
> below describes real, working UI over invented data. It is deliberately absent
> from the home screen until the pull is dependable — restore it by adding an
> entry back to [`src/home/apps.ts`](src/home/apps.ts).
>
> **What would finish it:** a way to collect profile views that survives
> LinkedIn's session limits. Longer backoff and fewer requests per run are the
> obvious next thing to try. Deliberately *not* on the table: spoofing browser
> fingerprints to evade bot detection.

The same idea as the Instagram tracker, aimed at a network that works differently.
Connections are mutual, so there's no follow-back arithmetic; the asymmetry that
does exist is between connecting and merely following. Data lives in one committed
file — [`public/linkedin/history.json`](public/linkedin/history.json).

**Who viewed your profile** is the headline view, and it's the reason the app
exists. LinkedIn shows a free account only its most recent handful of viewers and
drops them entirely after 90 days, so there's no stable set to diff — there's a
sliding window you have to keep copying out before it moves. Every run therefore
*unions* whatever is currently visible into a log that only ever grows. Run it
daily and after a year you have a view history LinkedIn itself will not show you.
Miss a week and those views are gone for good, which is why the staleness banner
here is blunter than the Instagram one.

The section gives you a 30-day bar chart (click a bar to scope the list to that
day), a rollup of the companies your viewers come from, filters for
named/anonymous/repeat visitors, and a per-person sheet that cross-references
someone's visits against when you connected.

| List | Who's in it |
| --- | --- |
| Connections | Your 1st-degree connections |
| Followers | Everyone who follows your posts |
| Connected + following | Both — the most engaged slice |
| Following, not connected | They follow you without ever having connected |

#### Viewer privacy

Profile viewers are not a follower list. A follower list is public on the
platform; who looked at your profile is shown **only to you**, and those people
never agreed to appear on a public web page. So the puller writes two files:

- `public/linkedin/history.json` — committed and deployed, with viewer names,
  ids and headlines stripped. Counts, timing, employers and degrees survive, so
  the public page is still a real tracker.
- `scripts/.linkedin-private.json` — gitignored, full detail. Drag it onto the
  page to see the real names on your own machine (it's kept in `localStorage`).

Set `"publishViewers": true` in the secrets file to publish names as well. It's
off by default deliberately — this is the one place where the Instagram tracker's
"commit everything" habit would expose someone other than you.

#### Setting up the daily pull

LinkedIn has no public API for connections or profile viewers, so this uses the
private voyager endpoints linkedin.com's own front-end calls — same arrangement
and same caveats as Instagram: it's automated collection (which LinkedIn's user
agreement disallows), and it runs from your own machine because datacenter IPs
get challenged immediately.

1. **Add your session cookie.** Run the setup script — it prompts for two
   values and writes `scripts/.linkedin-secrets.json` (gitignored, mode 0600):

   ```bash
   node scripts/linkedin-setup.mjs
   ```

   **Paste the whole `Cookie:` header** when it asks. DevTools (⌥⌘I) → Network →
   reload → click any request to `www.linkedin.com` → Request Headers →
   right-click the `cookie:` row → Copy value.

   The whole header genuinely matters. `li_at` + `JSESSIONID` alone satisfy some
   endpoints, but not all of them: LinkedIn answers a request missing `bcookie` /
   `lidc` with a 302 **back to the same URL**, which Node reports only as the
   useless "redirect count exceeded". The puller now follows redirects by hand
   and keeps a cookie jar across them, so it reports what actually happened —
   but it can only send cookies you gave it.

   Use the setup script rather than hand-editing the JSON, because LinkedIn
   displays `JSESSIONID` **with double quotes** around it (`"ajax:1234"`) and
   pasting that verbatim into a JSON string produces a file that won't parse.

   If you can only find the individual cookies: DevTools → **Application** tab
   (**Storage** in Firefox/Safari) → Cookies → `https://www.linkedin.com`, and
   copy `li_at` and `JSESSIONID`.

   **Expect to redo this often.** LinkedIn rotates and invalidates sessions used
   by scripts, sometimes within hours of the first automated request. A dead
   session shows up as a clean `HTTP 401` with a message telling you to re-paste;
   it is not a bug in the puller.

   To write the file by hand instead:

   ```json
   {
     "profile": "hastinchen",
     "li_at": "AQED…",
     "jsessionid": "ajax:1234",
     "publishViewers": false
   }
   ```

   `profile` is the slug in `linkedin.com/in/<slug>`. Pasting the full profile
   URL works too — the script trims it. Omit it entirely and the job resolves it
   from the session.

2. **Test it without writing anything:**

   ```bash
   node scripts/linkedin-pull.mjs --dry-run --debug
   ```

   `--debug` dumps the raw payloads to `scripts/.linkedin-debug/`. Worth doing
   on the first run: voyager's decoration ids and field names drift without
   notice, so the parsers are written structurally (walk the payload looking for
   anything shaped like a profile or a view record) rather than against fixed
   paths, and the dumps are how you check what actually came back.

3. **Schedule it** (launchd, first attempt 09:40 by default — offset from the
   Instagram job so two scrapers don't start in the same minute):

   ```bash
   ./scripts/linkedin-schedule.sh install
   ```

   `status`, `run`, `logs`, and `uninstall` do what they say. Retries work the
   same way as the Instagram job: scheduled hourly, `--once-daily` makes it a
   no-op once a run has succeeded, and `generatedAt` is itself the record of the
   last good run.

#### How the work is split, and why

Measured against a real 1012-connection account: **LinkedIn stops answering a
scripted session after roughly half a dozen requests.** Three separate runs died
at the same point. A full page-through of that list needs 26 requests, so it is
simply not something this API will do any more.

The tool is built around that rather than fighting it:

| Data | Where it comes from | Cost |
| --- | --- | --- |
| The full connection list, with exact dates | the official CSV export, imported in-browser | no requests |
| New connections | one page of `sortType=RECENTLY_ADDED` — the newest are all on page one | 1 request |
| Profile views | the daily pull, which is the only thing that *must* be scraped | 1–4 requests |

So import the export once for the back catalogue, and let the daily job do the
one job nothing else can: capturing profile viewers before LinkedIn drops them.

**A partial read can never subtract.** Reading one page of a 26-page list and
diffing it against the stored list would report a disconnect for every
connection that simply wasn't on that page. The puller tracks whether it
actually reached the end of the list, and only lets absence count as evidence
when it did — so the daily run may add connections but never remove them.
Disconnects are picked up when a fresh CSV export is imported. The stored list
also only ever shrinks through a confirmed disconnect, never through a read
missing someone.

#### Backfilling real connection dates

Unusually good on LinkedIn: `Connections.csv` in the official export carries a
"Connected On" date for **every** connection, so one import reconstructs your
entire history back to the day you joined. Request it under Settings → Data
privacy → *Get a copy of your data*, then drop the `.zip` (or the loose `.csv`
files) onto the page. It's parsed entirely in the browser — and the email column
the export includes for some connections is dropped at parse time and never
enters the data model, since this file gets committed publicly.

The export contains no profile viewers. LinkedIn has never included them in the
archive, which is precisely why the daily pull exists.

Sample data ships committed so the app is demoable without any of this; regenerate
it with `node scripts/gen_sample_linkedin.mjs`.

---

## Command-line tools

Everything in `scripts/` runs on your own machine. The deployed site is static
and never executes any of it — these are what produce the data files it renders.
There's no build step; run each from the repo root.

| Tool | What it does |
| --- | --- |
| `instagram-pull.mjs` | **The Instagram daily job.** Resolves your user id, pages your follower and following lists through Instagram's private endpoints, diffs them against the previous run, and writes `public/instagram/history.json`. Refuses to write a read that looks partial, so a throttled fetch can't masquerade as a mass unfollow. |
| `instagram-agent.mjs` | **The server behind "Update now."** A tiny token-authenticated HTTP listener bound to `127.0.0.1:4599` that runs exactly one fixed action — a pull — so the static page can trigger one, stop one, and ask how the last attempt went. Installed as a login item rather than run by hand. |
| `instagram-backfill.mjs` | **Real follow dates, once.** Folds the timestamps from the official Instagram export into the committed `history.json`, so every visitor sees them instead of each browser importing its own copy. Takes the export directory or loose JSON files, plus `--dry-run`. |
| `instagram-schedule.sh` | **launchd installer** for the two above. `install [HH:MM]`, `uninstall`, `status`, `run`, `logs` drive the daily job; `agent-install`, `agent-uninstall`, `agent-status`, `agent-logs` drive the agent. `status` answers the question you actually have: has today's pull happened yet? |
| `linkedin-setup.mjs` | **Interactive credential setup.** Prompts for two values and writes `scripts/.linkedin-secrets.json` at mode 0600. Use it instead of hand-editing: LinkedIn shows `JSESSIONID` wrapped in double quotes, and pasting that verbatim produces JSON that won't parse. |
| `linkedin-pull.mjs` | **The LinkedIn daily job.** Unions whatever profile viewers are currently visible into a log that only ever grows, picks up new connections from a single page of recently-added, and writes both the public `history.json` (viewer identities stripped) and the gitignored private one. |
| `linkedin-schedule.sh` | **launchd installer** for the LinkedIn job — same `install`/`uninstall`/`status`/`run`/`logs` subcommands, no agent. Defaults to 09:40 so the two scrapers never start in the same minute. |
| `gen_sample_instagram.mjs`<br>`gen_sample_linkedin.mjs` | **Sample data.** Regenerate the committed `history.json` each tracker ships with, so both apps are fully demoable with no session connected. Deterministic — the same run gives the same data. |
| `lib/instagram-session.mjs` | Not a command. The cookie assembly and request headers that the pull and the agent both have to agree on, kept in one place so they can't drift apart. |
| `lib/instagram-attempt.mjs` | Not a command. The note every run leaves behind — when, who asked, how it ended, why it failed — written by the pull and served to the page by the agent. Somewhere for the failures to go, since those write no `history.json`. |
| `lib/instagram-backoff.mjs` | Not a command. How long the unattended job waits after a refusal, so one "please wait" doesn't become a day of hourly knocking. Holds the schedule back, never a person. |

Both pull jobs take the same flags:

| Flag | Effect |
| --- | --- |
| `--dry-run` | Fetch, print a summary, write nothing. The safe first run. |
| `--commit` | After writing, `git commit` and push the history file. What the scheduled job uses. |
| `--once-daily` | No-op if a run already succeeded today — what makes hourly retries cheap. |
| `--force` | Write even though the read looks partial, for when a big drop is genuinely real. |
| `--no-notify` | Skip the macOS failure notification. |
| `--debug` | LinkedIn only. Dump the raw payloads to `scripts/.linkedin-debug/`. |

Credentials for both live in gitignored files under `scripts/` and never leave
your machine. The full setup for each is under its app's section above:
[Instagram](#setting-up-the-daily-pull) and [LinkedIn](#setting-up-the-daily-pull-1).

---

## Development

Requires Node 20+ (CI builds on Node 22).

```bash
npm install       # install dependencies
npm run dev       # start the Vite dev server (http://localhost:5173)
npm run build     # type-check + production build (main site + legacy snapshot)
npm run preview   # preview the production build locally
npm run lint      # run ESLint
npm test          # run the node:test suites in test/ (tracker parsers and pulls)
```

Each app is its own Vite entry point (`index.html`, `video/`, `appstore/`,
`printer/`, `about/`, `game/`, `feed/`, `instagram/`, `linkedin/`) wired up in
[`vite.config.ts`](vite.config.ts).

### Project layout

```
src/
  home/        # iPad home screen (icons, paged grid, dock)
  ios/         # shared "device" chrome: iPad frame, app shell, squircles, cursor
  appstore/    # App Store portfolio
  video/       # Camera video editor (layer model + compositor in src/video/project/)
  printer/     # Résumé PDF viewer
  about/       # About Me
  game/        # Drift — pointer-lock cursor game (engine / render / warps / pointer)
  feed/        # Doomscroll — scroll-driven feed game (engine / render / quirks / scroll)
  gif/         # GIF Shop — video-to-GIF converter (two-pass palette via ffmpeg.wasm)
  retake/      # Retake — recorded-takes puzzle platformer (physics / sim / levels / render)
  instagram/   # Instagram follower tracker
  linkedin/    # LinkedIn tracker (unfinished; not on the home screen)
  components/  # shared UI + section components
  utils/       # shared helpers, incl. the oscillator kit both games make sound with
scripts/       # daily pull jobs + launchd installers for both trackers
test/          # node:test suites for the tracker parsers, pull logic, and both games' input maths
public/        # static assets served as-is (resume.pdf, fonts, icons)
```

### Design system

Shared iOS-style tokens and controls (colors, glass, buttons, sliders, switches)
live in [`src/index.css`](src/index.css). App-specific styles sit next to each app
(e.g. `src/home/home.css`). The video editor also uses Tailwind utility classes for
layout.

---

## Deployment

Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which builds the site and publishes `dist/` to GitHub Pages automatically. No manual
deploy step is needed.
