import { useState } from 'react';
import Squircle from '../ios/Squircle';
import AppGlyph from './AppGlyph';
import type { HomeApp } from './apps';

/**
 * A single home-screen app icon: a squircle tile with a glyph, an optional
 * label, a springy press, and an iOS-style "launch" zoom before navigating to
 * the app's real route.
 */
export default function AppIcon({
  app,
  size = 96,
  showLabel = true,
  index = 0,
}: {
  app: HomeApp;
  size?: number;
  showLabel?: boolean;
  index?: number;
}) {
  const [launching, setLaunching] = useState(false);

  const open = () => {
    if (launching) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      window.location.href = app.route;
      return;
    }
    setLaunching(true);
    window.setTimeout(() => {
      window.location.href = app.route;
    }, 240);
  };

  return (
    <button
      onClick={open}
      aria-label={`${app.label} — ${app.blurb}`}
      className="app-icon-btn"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <Squircle
        radius={Infinity}
        className="app-icon-tile"
        style={{
          width: size,
          height: size,
          background: app.gradient,
          transform: launching ? 'scale(1.35)' : undefined,
          opacity: launching ? 0 : 1,
        }}
      >
        <AppGlyph app={app} size={size} />
      </Squircle>
      {showLabel && <span className="app-icon-label">{app.label}</span>}
    </button>
  );
}
