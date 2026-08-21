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
    // Measure the *layout* box, never getBoundingClientRect(): the rect is
    // scaled by any CSS transform in force (the icon-pop / launch-zoom
    // animations, the iPad's entrance scale), while clip-path coordinates live
    // in the element's own untransformed space. Measuring the rect mid-animation
    // bakes a too-small squircle onto a full-size tile — the glyph then sits
    // outside the visible clip, and nothing re-measures because the layout box
    // never actually changed.
    const update = (width: number, height: number) => {
      if (!width || !height) return;
      const r = radius === Infinity ? Math.min(width, height) / 2 : radius;
      setClip(`path('${squirclePath(width, height, r, exponent)}')`);
    };
    update(el.offsetWidth, el.offsetHeight);
    const ro = new ResizeObserver(([entry]) => {
      // borderBoxSize keeps sub-pixel precision; offsetWidth is integer-rounded.
      const box = entry?.borderBoxSize?.[0];
      if (box) update(box.inlineSize, box.blockSize);
      else update(el.offsetWidth, el.offsetHeight);
    });
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
        // .ios-card carries a plain border-radius so it still looks like a card
        // on a bare element. Once the real superellipse clip exists that radius
        // has to go, or its circular corners would cut the squircle's bulge
        // back into an ordinary rounded rectangle.
        borderRadius: clip ? 0 : undefined,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
