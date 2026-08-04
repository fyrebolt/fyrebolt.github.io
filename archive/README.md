# Archive — the first version of this site

The original `fyrebolt.github.io`, kept exactly as it was written: a hand-coded
HTML page from a high-school CodeHS class, parallax bands and all.

Served at <https://fyrebolt.github.io/archive/>.

| File | What it is |
| --- | --- |
| `index.html` | The whole page — headings, a video embed, and a nav bar pointing at pages that were never built. |
| `another.css` | Its stylesheet, including the parallax background bands. |

Nothing here is part of the build. It's plain static files that GitHub Pages
serves as-is, with no dependency on the React app in `src/` — which is the point
of keeping it. **Don't modernize it.** Its value is being an accurate snapshot of
what the site used to be; tidying the markup would erase exactly that.

Not to be confused with [`legacy/`](../legacy/), which is the React site as it
stood before the iPad-home-screen redesign. That one *is* built — `npm run build`
emits it into `dist/old/` and serves it at `/old/`.
