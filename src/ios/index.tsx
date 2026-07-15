// ===== Shared iOS component set =====
// One restyled base kit reused by the home screen, the apps, and the video
// editor so the whole site reads as a single design language.

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import Squircle from './Squircle';

export { default as Squircle } from './Squircle';
export { squirclePath } from './geometry';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({
  variant = 'secondary',
  className = '',
  children,
  ...rest
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = variant === 'primary' ? 'ios-btn-primary' : variant === 'ghost' ? 'ios-btn-ghost' : '';
  return (
    <button className={`ios-btn ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** iOS switch — a drop-in replacement for a checkbox. */
export function Switch({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <label className="ios-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" aria-hidden />
      <span className="knob" aria-hidden />
    </label>
  );
}

export function Slider(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="range" {...props} className={`ios-slider ${props.className ?? ''}`} />;
}

/** iOS segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`ios-segmented ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Frosted-glass squircle surface for bars, docks and panels. */
export function GlassPanel({
  radius = 26,
  className = '',
  style,
  children,
}: {
  radius?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <Squircle radius={radius} className={`ios-glass ${className}`} style={style}>
      {children}
    </Squircle>
  );
}

/** Solid elevated squircle card. */
export function Card({
  radius = 24,
  className = '',
  style,
  children,
  onClick,
}: {
  radius?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Squircle radius={radius} className={`ios-card ${className}`} style={style} onClick={onClick}>
      {children}
    </Squircle>
  );
}
