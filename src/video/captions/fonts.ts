// ===== Curated font pool for the caption "font boil" effect =====
//
// A deliberately varied but legible set — condensed sans, heavy sans, elegant
// and display serif, script, marker, block display, and mono — so the cycle
// reads as an intentional "font roll" rather than visual noise. All are Google
// Fonts; they're injected + preloaded before the canvas renders or exports.

export interface BoilFont {
  /** Font-family name as registered by Google Fonts. */
  family: string;
  /** Weight that actually gets loaded (avoids canvas falling back). */
  weight: number;
  /** Short label for the settle-font picker. */
  label: string;
}

export const BOIL_FONTS: BoilFont[] = [
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

const GOOGLE_FONTS_URL =
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
  '&display=swap';

/** Canvas font shorthand for a pool entry at a given pixel size. */
export function fontCss(font: BoilFont, sizePx: number): string {
  return `${font.weight} ${sizePx}px "${font.family}", sans-serif`;
}

let linkInjected = false;
let preloadPromise: Promise<void> | null = null;

/** Inject the Google Fonts stylesheet and resolve once it has loaded (so the
 *  @font-face rules are registered before we ask the browser to load them). */
function injectStylesheet(): Promise<void> {
  return new Promise((resolve) => {
    if (linkInjected) {
      resolve();
      return;
    }
    linkInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.appendChild(link);
    // Safety net in case the load event never fires.
    setTimeout(resolve, 4000);
  });
}

/**
 * Inject the Google Fonts stylesheet and wait for every pool font to be usable
 * on the canvas. Cached — safe to call repeatedly. Canvas draws before this
 * resolves will silently fall back, so the tool awaits it on mount.
 */
export function preloadBoilFonts(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    // Must wait for the stylesheet before document.fonts.load can find the faces.
    await injectStylesheet();
    await Promise.all(
      BOIL_FONTS.map((f) =>
        document.fonts.load(`${f.weight} 64px "${f.family}"`).catch(() => undefined),
      ),
    );
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  })();
  return preloadPromise;
}
