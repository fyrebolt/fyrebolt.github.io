import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A soft light-grey circle that trails the pointer with gentle lag.
 * - Skipped entirely on touch / coarse-pointer devices (nothing to replace).
 * - Under prefers-reduced-motion the lag is removed (it tracks 1:1).
 * Purely decorative: it never intercepts pointer events.
 *
 * Rendered through a portal to <body>. Its parent stage sets `isolation:
 * isolate`, which creates a stacking context — so however large the z-index,
 * the dot could only ever rank *within* the stage, and anything portalled
 * alongside it (the profile dialog) painted straight over the cursor. At body
 * level the z-index finally means what it says.
 */
export default function SquircleCursor() {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    if (!finePointer) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = document.documentElement;
    root.classList.add('ios-cursor');

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const pos = { ...target };
    let pressed = false;
    let visible = false;
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      if (!visible) {
        visible = true;
        pos.x = target.x;
        pos.y = target.y;
        if (dotRef.current) dotRef.current.style.opacity = '1';
      }
    };
    const onDown = () => (pressed = true);
    const onUp = () => (pressed = false);
    const onLeave = () => {
      visible = false;
      if (dotRef.current) dotRef.current.style.opacity = '0';
    };

    const tick = () => {
      const ease = reduce ? 1 : 0.2;
      pos.x += (target.x - pos.x) * ease;
      pos.y += (target.y - pos.y) * ease;
      const el = dotRef.current;
      if (el) {
        const scale = pressed ? 0.7 : 1;
        el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%) scale(${scale})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('mouseleave', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove('ios-cursor');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return createPortal(
    <div
      ref={dotRef}
      className="ios-soft-cursor"
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: 'rgba(150, 152, 160, 0.32)',
        boxShadow: '0 0 0 0.5px rgba(120,122,130,0.35)',
        backdropFilter: 'blur(1px)',
        pointerEvents: 'none',
        zIndex: 2147483647,
        opacity: 0,
        transition: 'opacity 0.25s ease, width 0.25s var(--ease-spring), height 0.25s var(--ease-spring)',
        willChange: 'transform',
      }}
    />,
    document.body,
  );
}
