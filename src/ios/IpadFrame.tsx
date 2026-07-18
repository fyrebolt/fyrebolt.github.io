import { useEffect, useState, type ReactNode } from 'react';
import SquircleCursor from './SquircleCursor';
import './ipadframe.css';

/** Live "9:41-style" clock for the status bar. Updates a few times a minute. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function StatusBar() {
  const time = useClock();
  return (
    <div className="ios-statusbar" aria-hidden>
      <span className="ios-statusbar-time">{time}</span>
      <div className="ios-statusbar-icons">
        {/* Cellular */}
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0.5" width="3" height="11.5" rx="1" />
        </svg>
        {/* Wi-Fi: three clean concentric arcs + dot, all centred on the dot. */}
        <svg
          width="17"
          height="12"
          viewBox="0 0 17 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <path d="M2.84 5.34a8 8 0 0 1 11.32 0" />
          <path d="M4.61 7.11a5.5 5.5 0 0 1 7.78 0" />
          <path d="M6.38 8.88a3 3 0 0 1 4.24 0" />
          <circle cx="8.5" cy="10.8" r="0.9" fill="currentColor" stroke="none" />
        </svg>
        {/* Battery */}
        <span className="ios-battery">
          <span className="ios-battery-shell">
            <span className="ios-battery-fill" />
          </span>
          <span className="ios-battery-cap" />
        </span>
      </div>
    </div>
  );
}

/**
 * Wraps any page in a realistic iPad: an aluminium bezel with a front camera and
 * a rounded display that carries the iOS status bar and wallpaper. The home
 * screen uses the portrait orientation; apps opened from it use landscape so the
 * editor tools and portfolio lists have room to breathe.
 */
export default function IpadFrame({
  orientation = 'portrait',
  contentClassName = '',
  ariaLabel,
  children,
}: {
  orientation?: 'portrait' | 'landscape';
  contentClassName?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="ios-studio ipad-stage">
      <SquircleCursor />
      <div className={`ipad-frame ipad-${orientation}`} role="group" aria-label={ariaLabel}>
        <span className="ipad-camera" aria-hidden />
        <div className="ipad-screen ios-wallpaper">
          <StatusBar />
          <div className={`ipad-content ${contentClassName}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}
