import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

export default function CustomCursor() {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Hide on touch devices
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isVisible) setIsVisible(true);

      gsap.to(outerRef.current, {
        x: e.clientX,
        y: e.clientY,
        duration: 0.5,
        ease: 'power2.out',
      });

      gsap.to(innerRef.current, {
        x: e.clientX,
        y: e.clientY,
        duration: 0.1,
        ease: 'power2.out',
      });
    };

    const handleMouseEnterInteractive = () => setIsHovering(true);
    const handleMouseLeaveInteractive = () => setIsHovering(false);

    document.addEventListener('mousemove', handleMouseMove);

    // Watch for interactive elements
    const interactiveSelectors = 'a, button, [role="button"], input, textarea, select, [data-cursor-hover]';
    const observer = new MutationObserver(() => {
      document.querySelectorAll(interactiveSelectors).forEach((el) => {
        el.addEventListener('mouseenter', handleMouseEnterInteractive);
        el.addEventListener('mouseleave', handleMouseLeaveInteractive);
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial bind
    document.querySelectorAll(interactiveSelectors).forEach((el) => {
      el.addEventListener('mouseenter', handleMouseEnterInteractive);
      el.addEventListener('mouseleave', handleMouseLeaveInteractive);
    });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      observer.disconnect();
    };
  }, [isVisible]);

  // Hide on mobile
  if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    return null;
  }

  return (
    <>
      {/* Outer ring — no mix-blend to avoid glitching on interactive elements */}
      <div
        ref={outerRef}
        className="fixed top-0 left-0 z-[9999] pointer-events-none"
        style={{
          width: isHovering ? 60 : 40,
          height: isHovering ? 60 : 40,
          marginLeft: isHovering ? -30 : -20,
          marginTop: isHovering ? -30 : -20,
          borderRadius: '50%',
          border: isHovering
            ? '2px solid rgba(0, 200, 83, 0.8)'
            : '1.5px solid rgba(0, 200, 83, 0.5)',
          transition: 'width 0.3s, height 0.3s, margin 0.3s, border 0.3s',
          opacity: isVisible ? 1 : 0,
          willChange: 'transform',
        }}
      />
      {/* Inner dot */}
      <div
        ref={innerRef}
        className="fixed top-0 left-0 z-[9999] pointer-events-none"
        style={{
          width: isHovering ? 8 : 5,
          height: isHovering ? 8 : 5,
          marginLeft: isHovering ? -4 : -2.5,
          marginTop: isHovering ? -4 : -2.5,
          borderRadius: '50%',
          background: isHovering
            ? 'linear-gradient(135deg, #00C853, #FFD600)'
            : '#00C853',
          transition: 'width 0.3s, height 0.3s, margin 0.3s, background 0.3s',
          opacity: isVisible ? 1 : 0,
          willChange: 'transform',
        }}
      />
    </>
  );
}
