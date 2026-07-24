import type { HomeApp } from './apps';

/**
 * Renders an app-icon glyph: either a built-in vector mark (when `app.icon`
 * is set) or the emoji fallback. Keeps the data registry (apps.ts) JSX-free.
 */
export default function AppGlyph({ app, size }: { app: HomeApp; size: number }) {
  if (app.icon === 'instagram') {
    return <InstagramMark size={size * 0.62} />;
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
