import { useMemo } from 'react';
import { initialsOf } from './data';

/**
 * Deterministic gradient + initials, so each person keeps their colour.
 *
 * No photos on purpose: LinkedIn's media URLs are signed and expire within
 * days, so persisting them would churn hundreds of KB into every daily commit
 * and still 404 by the time anyone looked.
 */
export function Avatar({ seed, label, small }: { seed: string; label?: string; small?: boolean }) {
  const { hue, initials } = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < seed.length; i++) acc = (acc * 31 + seed.charCodeAt(i)) % 360;
    return { hue: acc, initials: initialsOf(label ?? seed) };
  }, [seed, label]);

  return (
    <span
      className={`li-avatar ${small ? 'is-small' : ''}`}
      aria-hidden
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 62% 58%), hsl(${(hue + 40) % 360} 58% 42%))`,
      }}
    >
      {initials}
    </span>
  );
}

/** The stand-in for a viewer LinkedIn wouldn't name. */
export function AnonAvatar() {
  return (
    <span className="li-avatar is-anon" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8.2" r="3.6" stroke="currentColor" strokeWidth="1.9" />
        <path
          d="M4.8 20a7.2 7.2 0 0114.4 0"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
