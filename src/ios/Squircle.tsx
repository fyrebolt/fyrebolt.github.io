import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import { squirclePath } from './geometry';

interface SquircleProps {
  /** Corner radius in px. Use a large value (or Infinity) for a pure app-icon superellipse. */
  radius?: number;
  /** Superellipse exponent; higher = boxier. Defaults to the iOS-like 5. */
  exponent?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Rendered element tag. */
  as?: 'div' | 'button' | 'a' | 'section' | 'li';
  onClick?: () => void;
  href?: string;
  title?: string;
  'aria-label'?: string;
}

/**
 * Clips its content to a real continuous-corner squircle. Re-measures on
 * resize so the clip-path always matches the box — cards, panels and app
 * icons all use this rather than border-radius.
 */
export default function Squircle({
  radius = 28,
  exponent = 5,
  className,
  style,
  children,
  as = 'div',
  onClick,
  href,
  title,
  'aria-label': ariaLabel,
}: SquircleProps) {
  const ref = useRef<HTMLElement>(null);
  const [clip, setClip] = useState<string>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) {
        const r = radius === Infinity ? Math.min(width, height) / 2 : radius;
        setClip(`path('${squirclePath(width, height, r, exponent)}')`);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius, exponent]);

  // `as` may be an anchor/button/etc.; keep the element type permissive so
  // href/onClick are valid without fighting per-tag prop unions.
  const Tag = as as ElementType;
  return (
    <Tag
      ref={ref}
      className={className}
      onClick={onClick}
      href={href}
      title={title}
      aria-label={ariaLabel}
      style={{
        clipPath: clip,
        WebkitClipPath: clip,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
