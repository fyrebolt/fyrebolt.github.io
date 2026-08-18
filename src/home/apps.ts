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
  /** Optional built-in vector icon id (e.g. 'instagram'); overrides the emoji glyph. */
  icon?: 'instagram' | 'linkedin';
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
  {
    id: 'game',
    label: 'Drift',
    glyph: '🎯',
    route: '/game/',
    gradient: 'linear-gradient(160deg, #7ff0ff 0%, #5856d6 55%, #ff7ab6 100%)',
    blurb: 'A cursor game that takes the cursor.',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    glyph: '📸',
    icon: 'instagram',
    route: '/instagram/',
    gradient:
      'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%)',
    blurb: 'Track my follower count and daily follows/unfollows.',
  },
  // The LinkedIn tracker is deliberately absent. It still builds and is still
  // reachable at /linkedin/, but it isn't finished — LinkedIn cuts off a
  // scripted session after a handful of requests, so the daily pull can't be
  // relied on yet — and the home screen is for things that work. To put it back,
  // restore an entry here with `icon: 'linkedin'` (the mark is still in
  // AppGlyph) and see the README section for what's outstanding.
];

export const DOCK_APPS = APPS.filter((a) => a.favorite);
