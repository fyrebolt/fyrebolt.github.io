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

### 🏠 Home screen (`/`)

The iPad home screen. Four app icons in a grid plus a dock of favorites. Each icon
is a real route you can bookmark directly. Add or reorder apps by editing a single
list — [`src/home/apps.ts`](src/home/apps.ts).

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

1. **Add your session cookie.** Create `scripts/.instagram-secrets.json`
   (gitignored):

   ```json
   { "account": "yourhandle", "cookie": "<paste the whole cookie: request header>" }
   ```

   Get it from instagram.com while logged in: DevTools → Network → click any
   request to instagram.com → Request Headers → copy the entire `cookie:` value.

2. **Test it without writing anything:**

   ```bash
   node scripts/instagram-pull.mjs --dry-run
   ```

3. **Schedule it** (launchd, once a day, default 09:20):

   ```bash
   ./scripts/instagram-schedule.sh install
   ```

   `status`, `run`, `logs`, and `uninstall` do what they say. The scheduled job
   runs with `--commit`, so each day's pull is committed and pushed on its own —
   which means your follower and following lists are public on the live site.
   Drop `--commit` from the plist if you'd rather keep the data local and publish
   by hand.

The first run only records a baseline; diffs start the next day. Expect to
re-paste the cookie every few weeks — the script fails with a clear message
rather than silently recording nothing.

**Guard against phantom unfollows.** A throttled or truncated read looks exactly
like a mass unfollow to a diffing tracker, so the script cross-checks what it
paged against the count Instagram reports for the profile and refuses to write if
it's short (or if the follower count halved since the last run). `--force`
overrides it when a drop is genuinely real.

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

---

## Development

Requires Node 20+ (CI builds on Node 22).

```bash
npm install       # install dependencies
npm run dev       # start the Vite dev server (http://localhost:5173)
npm run build     # type-check + production build (main site + legacy snapshot)
npm run preview   # preview the production build locally
npm run lint      # run ESLint
```

Each app is its own Vite entry point (`index.html`, `video/`, `appstore/`,
`printer/`, `about/`, `instagram/`) wired up in [`vite.config.ts`](vite.config.ts).

### Project layout

```
src/
  home/        # iPad home screen (icons, grid, dock)
  ios/         # shared "device" chrome: iPad frame, app shell, squircles, cursor
  appstore/    # App Store portfolio
  video/       # Camera video editor (layer model + compositor in src/video/project/)
  printer/     # Résumé PDF viewer
  about/       # About Me
  instagram/   # Instagram follower tracker
  components/  # shared UI + section components
scripts/       # instagram-pull.mjs (daily job), instagram-schedule.sh (launchd)
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
