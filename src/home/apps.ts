// ===== Home-screen app registry =====
//
// This is the single source of truth for the iPad-style home screen — the same
// idea as the video editor's TOOLS.ts. To add a future app: drop one entry
// here (icon, label, route) and it appears in the grid (and dock, if favorited).
// Nothing else needs to change.

export interface HomeApp {
  /** Stable id. */
  id: string;
  /** Label shown under the icon. */
  label: string;
  /** Emoji glyph drawn on the squircle icon. */
  glyph: string;
  /** Real, bookmarkable route this icon opens (its own Vite entry point). */
  route: string;
  /** CSS gradient for the icon tile. */
  gradient: string;
  /** One-line description (used for aria + subtle captions). */
  blurb: string;
  /** Pin to the dock as a favorite. */
  favorite?: boolean;
}

export const APPS: HomeApp[] = [
  {
    id: 'appstore',
    label: 'App Store',
    glyph: '🛍️',
    route: '/appstore/',
    gradient: 'linear-gradient(160deg, #0a84ff 0%, #0055d4 100%)',
    blurb: 'A portfolio of past projects.',
    favorite: true,
  },
  {
    id: 'camera',
    label: 'Camera',
    glyph: '🎥',
    route: '/video/',
    gradient: 'linear-gradient(160deg, #3a3a3c 0%, #1c1c1e 100%)',
    blurb: 'The in-browser video editor.',
    favorite: true,
  },
  {
    id: 'printer',
    label: 'Printer',
    glyph: '🖨️',
    route: '/printer/',
    gradient: 'linear-gradient(160deg, #30d0c6 0%, #0a9d9f 100%)',
    blurb: 'View my résumé as a printed page.',
    favorite: true,
  },
  {
    id: 'about',
    label: 'About Me',
    glyph: '👋',
    route: '/about/',
    gradient: 'linear-gradient(160deg, #ff9f6b 0%, #ff375f 100%)',
    blurb: 'Who I am, what I write, how to reach me.',
  },
];

export const DOCK_APPS = APPS.filter((a) => a.favorite);
