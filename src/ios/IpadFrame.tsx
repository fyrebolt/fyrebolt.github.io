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
        {/* Wi-Fi */}
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
          <path d="M8.5 2.2c2.7 0 5.2 1 7.1 2.8l-1.5 1.6A8 8 0 0 0 8.5 4.4 8 8 0 0 0 2.9 6.6L1.4 5A10.2 10.2 0 0 1 8.5 2.2Zm0 3.9c1.6 0 3.1.6 4.2 1.7l-1.6 1.6A3.8 3.8 0 0 0 8.5 10a3.8 3.8 0 0 0-2.6 1.4L4.3 9.8A6 6 0 0 1 8.5 6.1Z" />
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
