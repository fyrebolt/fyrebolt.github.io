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
| 📸 **Instagram Tracker** | `/instagram/` | Who follows and unfollows you, diffed once a day from one committed history file. |
| 💼 **LinkedIn Tracker** | `/linkedin/` | The same idea for LinkedIn, built around profile views. **Unfinished** — deliberately not on the home screen. |

Each app has its own section below. For the scripts that feed the two trackers,
see [Command-line tools](#command-line-tools).

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

**When is the next one?** Click the green **Live data** badge on the tracker page.
It opens the collection details: when this reading was taken, how, the totals it
holds, the retry window the job is installed on, and the next attempt —
`12:20 PM (in 14 minutes)` if today's pull hasn't landed, or tomorrow's date and
time if it has, since `--once-daily` means the intervening hourly firings will
no-op. The page is static and can't see the Mac, so each successful pull records
its own schedule (read straight out of the installed LaunchAgent) into
`history.json`; re-install at a different hour and the page corrects itself on the
next run. The times shown are the job's wall clock, labelled with its zone when
you're reading from somewhere else. No schedule on file — a file written by a
manual run — and the panel says so rather than inventing a time.

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
| `instagram-agent.mjs` | **The server behind "Update now."** A tiny token-authenticated HTTP listener bound to `127.0.0.1:4599` that runs exactly one fixed action — a pull — so the static page can trigger one. Installed as a login item rather than run by hand. |
| `instagram-backfill.mjs` | **Real follow dates, once.** Folds the timestamps from the official Instagram export into the committed `history.json`, so every visitor sees them instead of each browser importing its own copy. Takes the export directory or loose JSON files, plus `--dry-run`. |
| `instagram-schedule.sh` | **launchd installer** for the two above. `install [HH:MM]`, `uninstall`, `status`, `run`, `logs` drive the daily job; `agent-install`, `agent-uninstall`, `agent-status`, `agent-logs` drive the agent. `status` answers the question you actually have: has today's pull happened yet? |
| `linkedin-setup.mjs` | **Interactive credential setup.** Prompts for two values and writes `scripts/.linkedin-secrets.json` at mode 0600. Use it instead of hand-editing: LinkedIn shows `JSESSIONID` wrapped in double quotes, and pasting that verbatim produces JSON that won't parse. |
| `linkedin-pull.mjs` | **The LinkedIn daily job.** Unions whatever profile viewers are currently visible into a log that only ever grows, picks up new connections from a single page of recently-added, and writes both the public `history.json` (viewer identities stripped) and the gitignored private one. |
| `linkedin-schedule.sh` | **launchd installer** for the LinkedIn job — same `install`/`uninstall`/`status`/`run`/`logs` subcommands, no agent. Defaults to 09:40 so the two scrapers never start in the same minute. |
| `gen_sample_instagram.mjs`<br>`gen_sample_linkedin.mjs` | **Sample data.** Regenerate the committed `history.json` each tracker ships with, so both apps are fully demoable with no session connected. Deterministic — the same run gives the same data. |
| `lib/instagram-session.mjs` | Not a command. The cookie assembly and request headers that the pull and the agent both have to agree on, kept in one place so they can't drift apart. |

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
`printer/`, `about/`, `instagram/`, `linkedin/`) wired up in
[`vite.config.ts`](vite.config.ts).

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
  linkedin/    # LinkedIn tracker (unfinished; not on the home screen)
  components/  # shared UI + section components
scripts/       # daily pull jobs + launchd installers for both trackers
test/          # node:test suites for the tracker parsers and pull logic
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
