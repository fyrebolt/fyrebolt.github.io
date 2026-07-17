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

A set of in-browser video/photo editing tools. Everything (decoding, rendering,
and MP4 encoding via ffmpeg.wasm) happens locally in your browser. Pick a tool from
the left menu (it scrolls horizontally on mobile); each tool is bookmarkable at
`/video/#<tool-id>`.

| Tool | What it does |
| --- | --- |
| **Entrance Banner** | Overlays a Smash-style character-intro banner on your footage and formats it for vertical short-form. Upload, place the freeze point, export an MP4. |
| **Captions** | Add any number of animated captions with a "font boil" reveal. Drag each on the canvas and time it on a multi-track timeline. |
| **Zoom** | Sequential zoom keyframes — drag a crop rectangle, set transitions, and the video animates between them. Non-destructive. |
| **Sketch** | Draw freehand on a mini pad, then project it as a resizable overlay that animates on like someone drawing live. |
| **Highlighter** | Sweep a resizable, recolorable highlight box over any part of the footage. |
| **Static Zoom** | Turn a photo into a moving clip — set a length and zoom into (or out of) part of the image. |
| **Dramatic Wording** | Big uppercase words over your footage; keep them translucent or invert to spotlight the word. |

**Typical flow:** choose a tool → **Choose File** to upload a photo/video →
adjust the controls on the right → **Play preview** → **Export MP4**. The first
MP4 export downloads the ffmpeg encoder once (then it's cached).

> Note: exporting records the preview in real time and encodes to H.264 MP4. It
> works best in Chromium-based browsers; where MP4 encoding isn't available it
> falls back to WebM.

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
  video/       # Camera video editor + its tools (src/video/tools/)
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
