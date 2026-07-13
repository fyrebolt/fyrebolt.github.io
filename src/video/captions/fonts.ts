// ===== Font pools for the caption "font boil" effect =====
//
// Multiple curated pools the boil can cycle through (chosen globally in the UI):
//  - default:   the original mixed display/serif/script/mono set.
//  - scripting: cohesive casual handwriting (Comic-Sans-ish, but nicer).
//  - sketch:    marker / pen handwriting in the same spirit, a second option.
//
// All are Google Fonts, injected + preloaded before the canvas renders/exports.

export interface BoilFont {
  /** Font-family name as registered by Google Fonts. */
  family: string;
  /** Weight that actually gets loaded (avoids canvas falling back). */
  weight: number;
  /** Short label for the settle-font picker. */
  label: string;
}

export type BoilPoolId = 'default' | 'scripting' | 'sketch';

export interface FontPool {
  id: BoilPoolId;
  label: string;
  stylesheet: string;
  fonts: BoilFont[];
}

const DEFAULT_FONTS: BoilFont[] = [
  { family: 'Anton', weight: 400, label: 'Anton' },
  { family: 'Bebas Neue', weight: 400, label: 'Bebas Neue' },
  { family: 'Oswald', weight: 700, label: 'Oswald' },
  { family: 'Archivo Black', weight: 400, label: 'Archivo Black' },
  { family: 'Playfair Display', weight: 700, label: 'Playfair' },
  { family: 'Abril Fatface', weight: 400, label: 'Abril Fatface' },
  { family: 'Pacifico', weight: 400, label: 'Pacifico' },
  { family: 'Permanent Marker', weight: 400, label: 'Permanent Marker' },
  { family: 'Bungee', weight: 400, label: 'Bungee' },
  { family: 'Space Mono', weight: 700, label: 'Space Mono' },
];

// The 8 handwriting faces requested.
const SCRIPTING_FONTS: BoilFont[] = [
  { family: 'Architects Daughter', weight: 400, label: 'Architects Daughter' },
  { family: 'Caveat', weight: 400, label: 'Caveat' },
  { family: 'Gochi Hand', weight: 400, label: 'Gochi Hand' },
  { family: 'Handlee', weight: 400, label: 'Handlee' },
  { family: 'Indie Flower', weight: 400, label: 'Indie Flower' },
  { family: 'Kalam', weight: 400, label: 'Kalam' },
  { family: 'Patrick Hand', weight: 400, label: 'Patrick Hand' },
  { family: 'Shadows Into Light', weight: 400, label: 'Shadows Into Light' },
];

// A second, similar casual/marker handwriting set.
const SKETCH_FONTS: BoilFont[] = [
  { family: 'Permanent Marker', weight: 400, label: 'Permanent Marker' },
  { family: 'Coming Soon', weight: 400, label: 'Coming Soon' },
  { family: 'Gaegu', weight: 400, label: 'Gaegu' },
  { family: 'Schoolbell', weight: 400, label: 'Schoolbell' },
  { family: 'Reenie Beanie', weight: 400, label: 'Reenie Beanie' },
  { family: 'Just Another Hand', weight: 400, label: 'Just Another Hand' },
  { family: 'Nanum Pen Script', weight: 400, label: 'Nanum Pen Script' },
  { family: 'Neucha', weight: 400, label: 'Neucha' },
];

export const FONT_POOLS: FontPool[] = [
  {
    id: 'default',
    label: 'Default',
    stylesheet:
      'https://fonts.googleapis.com/css2?' +
      [
        'family=Anton',
        'family=Bebas+Neue',
        'family=Oswald:wght@700',
        'family=Archivo+Black',
        'family=Playfair+Display:wght@700',
        'family=Abril+Fatface',
        'family=Pacifico',
        'family=Permanent+Marker',
        'family=Bungee',
        'family=Space+Mono:wght@700',
      ].join('&') +
      '&display=swap',
    fonts: DEFAULT_FONTS,
  },
  {
    id: 'scripting',
    label: 'Scripting',
    stylesheet:
      'https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Caveat&family=Gochi+Hand&family=Handlee&family=Indie+Flower&family=Kalam&family=Patrick+Hand&family=Shadows+Into+Light&display=swap',
    fonts: SCRIPTING_FONTS,
  },
  {
    id: 'sketch',
    label: 'Sketch',
    stylesheet:
      'https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Coming+Soon&family=Gaegu&family=Schoolbell&family=Reenie+Beanie&family=Just+Another+Hand&family=Nanum+Pen+Script&family=Neucha&display=swap',
    fonts: SKETCH_FONTS,
  },
];

export function poolById(id: BoilPoolId): FontPool {
  return FONT_POOLS.find((p) => p.id === id) ?? FONT_POOLS[0];
}

/** Back-compat alias: the default pool's fonts. */
export const BOIL_FONTS = DEFAULT_FONTS;

/** A single font referenced across pools (for the typewriter's one-font pick). */
export interface FontRef extends BoilFont {
  /** Stable id "poolId:index". */
  key: string;
  /** Which pool it came from (shown in the picker). */
  poolLabel: string;
}

/** Every font across all pools, flattened, with stable keys. */
export const ALL_FONTS: FontRef[] = FONT_POOLS.flatMap((p) =>
  p.fonts.map((f, i) => ({ ...f, key: `${p.id}:${i}`, poolLabel: p.label })),
);

export function fontByKey(key: string): BoilFont {
  return ALL_FONTS.find((f) => f.key === key) ?? ALL_FONTS[0];
}

/** Canvas font shorthand for a pool entry at a given pixel size. */
export function fontCss(font: BoilFont, sizePx: number): string {
  return `${font.weight} ${sizePx}px "${font.family}", sans-serif`;
}

const injectedSheets = new Set<string>();
let preloadPromise: Promise<void> | null = null;

function injectStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    if (injectedSheets.has(href)) {
      resolve();
      return;
    }
    injectedSheets.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.appendChild(link);
    setTimeout(resolve, 4000); // safety net
  });
}

/**
 * Inject every pool's stylesheet and wait for all fonts to be usable on the
 * canvas. Cached — safe to call repeatedly. Awaited by the tool on mount so
 * switching pools is instant and canvas draws never fall back.
 */
export function preloadAllFontPools(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    // Wait for stylesheets first so the @font-face rules are registered before
    // we ask the browser to actually load each face.
    await Promise.all(FONT_POOLS.map((p) => injectStylesheet(p.stylesheet)));
    const all = FONT_POOLS.flatMap((p) => p.fonts);
    await Promise.all(
      all.map((f) => document.fonts.load(`${f.weight} 64px "${f.family}"`).catch(() => undefined)),
    );
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  })();
  return preloadPromise;
}
