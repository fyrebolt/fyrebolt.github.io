import type { ReactNode } from 'react';
import IpadFrame from './IpadFrame';
import './appshell.css';

/**
 * Shared chrome for every app opened from the home screen: it lives inside a
 * landscape iPad frame and adds a frosted glass top bar with a back-to-home
 * control. The soft cursor, status bar and wallpaper come from the frame.
 */
export default function AppShell({
  title,
  glyph,
  right,
  children,
  maxWidth = 960,
}: {
  title: string;
  glyph?: string;
  right?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <IpadFrame orientation="landscape" ariaLabel={title}>
      <header className="app-bar">
        <div className="app-bar-inner ios-glass" style={{ maxWidth }}>
          <a href="/" className="app-bar-back" aria-label="Back to home screen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Home</span>
          </a>
          <div className="app-bar-title">
            {glyph && <span aria-hidden>{glyph}</span>}
            <span>{title}</span>
          </div>
          <div className="app-bar-right">{right}</div>
        </div>
      </header>
      <main className="app-body" style={{ maxWidth }}>
        {children}
      </main>
    </IpadFrame>
  );
}
