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
`printer/`, `about/`) wired up in [`vite.config.ts`](vite.config.ts).

### Project layout

```
src/
  home/        # iPad home screen (icons, grid, dock)
  ios/         # shared "device" chrome: iPad frame, app shell, squircles, cursor
  appstore/    # App Store portfolio
  video/       # Camera video editor (layer model + compositor in src/video/project/)
  printer/     # Résumé PDF viewer
  about/       # About Me
  components/  # shared UI + section components
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
