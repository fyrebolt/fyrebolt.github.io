import { useRef } from 'react';
import gsap from 'gsap';
import type { MagneticButtonProps } from '../../types';

export default function MagneticButton({
  children,
  className = '',
  onClick,
  href,
  strength = 0.3,
}: MagneticButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    gsap.to(buttonRef.current, {
      x: x * strength,
      y: y * strength,
      duration: 0.3,
      ease: 'power2.out',
    });

    gsap.to(contentRef.current, {
      x: x * strength * 0.5,
      y: y * strength * 0.5,
      duration: 0.3,
      ease: 'power2.out',
    });
  };

  const handleMouseLeave = () => {
    gsap.to(buttonRef.current, {
      x: 0,
      y: 0,
      duration: 0.7,
      ease: 'elastic.out(1, 0.3)',
    });
    gsap.to(contentRef.current, {
      x: 0,
      y: 0,
      duration: 0.7,
      ease: 'elastic.out(1, 0.3)',
    });
  };

  const Tag = href ? 'a' : 'button';
  const tagProps = href
    ? { href, target: href.startsWith('http') ? '_blank' : undefined, rel: href.startsWith('http') ? 'noopener noreferrer' : undefined }
    : { onClick };

  return (
    <div
      ref={buttonRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="inline-block"
      style={{ willChange: 'transform' }}
    >
      <Tag
        {...tagProps as React.AnchorHTMLAttributes<HTMLAnchorElement> & React.ButtonHTMLAttributes<HTMLButtonElement>}
        data-cursor-hover
        className={`relative inline-flex items-center justify-center px-8 py-4 text-sm font-semibold tracking-wide
          rounded-full overflow-hidden transition-all duration-300
          bg-gradient-to-r from-[var(--color-primary-green)] via-[var(--color-primary-yellow)] to-[var(--color-primary-blue)]
          text-[var(--color-bg-primary)]
          shadow-[0_0_30px_rgba(0,200,83,0.3)]
          hover:shadow-[0_0_50px_rgba(0,200,83,0.5)]
          hover:scale-105
          active:scale-95
          ${className}`}
      >
        <span ref={contentRef} className="relative z-10" style={{ willChange: 'transform' }}>
          {children}
        </span>
      </Tag>
    </div>
  );
}
