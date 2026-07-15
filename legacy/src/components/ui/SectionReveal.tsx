import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { SectionRevealProps } from '../../types';

gsap.registerPlugin(ScrollTrigger);

export default function SectionReveal({
  children,
  className = '',
  direction = 'up',
  delay = 0,
  duration = 1,
  stagger = 0.1,
}: SectionRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const directionMap = {
      up: { y: 60, x: 0 },
      down: { y: -60, x: 0 },
      left: { y: 0, x: 60 },
      right: { y: 0, x: -60 },
    };

    const { x, y } = directionMap[direction];
    const children = el.querySelectorAll(':scope > *');

    gsap.fromTo(
      children.length > 0 ? children : el,
      {
        opacity: 0,
        y,
        x,
      },
      {
        opacity: 1,
        y: 0,
        x: 0,
        duration,
        delay,
        stagger,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          end: 'top 20%',
          toggleActions: 'play none none reverse',
        },
      }
    );

    return () => {
      ScrollTrigger.getAll().forEach((t) => {
        if (t.trigger === el) t.kill();
      });
    };
  }, [direction, delay, duration, stagger]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
