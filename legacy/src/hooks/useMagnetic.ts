import { useRef, useCallback } from 'react';
import gsap from 'gsap';

interface UseMagneticOptions {
  strength?: number;
  ease?: number;
}

export function useMagnetic(options: UseMagneticOptions = {}) {
  const { strength = 0.3, ease = 0.3 } = options;
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;

      gsap.to(ref.current, {
        x: x * strength,
        y: y * strength,
        duration: ease,
        ease: 'power2.out',
      });
    },
    [strength, ease]
  );

  const handleMouseLeave = useCallback(() => {
    if (!ref.current) return;
    gsap.to(ref.current, {
      x: 0,
      y: 0,
      duration: 0.6,
      ease: 'elastic.out(1, 0.3)',
    });
  }, []);

  return {
    ref,
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
  };
}
