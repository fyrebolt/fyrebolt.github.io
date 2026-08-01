import type { HomeApp } from './apps';

/**
 * Renders an app-icon glyph: either a built-in vector mark (when `app.icon`
 * is set) or the emoji fallback. Keeps the data registry (apps.ts) JSX-free.
 */
export default function AppGlyph({ app, size }: { app: HomeApp; size: number }) {
  if (app.icon === 'instagram') {
    return <InstagramMark size={size * 0.62} />;
  }
  if (app.icon === 'linkedin') {
    return <LinkedInMark size={size * 0.58} />;
  }
  return (
    <span className="app-icon-glyph" style={{ fontSize: size * 0.46 }}>
      {app.glyph}
    </span>
  );
}

/** The classic Instagram camera mark, drawn in white to sit on the gradient tile. */
function InstagramMark({ size }: { size: number }) {
  const stroke = Math.max(2, size * 0.085);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.22))' }}
    >
      <rect
        x="2.6"
        y="2.6"
        width="18.8"
        height="18.8"
        rx="5.6"
        stroke="#fff"
        strokeWidth={stroke}
      />
      <circle cx="12" cy="12" r="4.6" stroke="#fff" strokeWidth={stroke} />
      <circle cx="17.4" cy="6.6" r={stroke * 0.72} fill="#fff" />
    </svg>
  );
}

/**
 * The lowercase "in" wordmark, drawn in white to sit on the blue tile.
 *
 * Currently unused: the LinkedIn tracker is unfinished and off the home screen
 * (see apps.ts). Kept so restoring it is a one-line change rather than a
 * redraw.
 *
 * Solid fills rather than strokes, unlike the Instagram mark next door: the
 * counter of the `n` is small enough that a stroked version turns to mush at
 * dock size.
 */
function LinkedInMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.22))' }}
    >
      <path
        d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.04c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.56V9h3.56v11.45z"
        fill="#fff"
      />
    </svg>
  );
}
