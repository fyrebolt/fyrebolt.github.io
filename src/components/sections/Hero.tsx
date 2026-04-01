import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import MagneticButton from '../ui/MagneticButton';

gsap.registerPlugin(ScrollTrigger);

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    // Initial staggered entrance
    const tl = gsap.timeline({ delay: 0.3 });

    tl.fromTo(
      headingRef.current,
      { opacity: 0, y: 80, scale: 0.9 },
      { opacity: 1, y: 0, scale: 1, duration: 1.2, ease: 'power3.out' }
    )
      .fromTo(
        subtitleRef.current,
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' },
        '-=0.6'
      )
      .fromTo(
        taglineRef.current,
        { opacity: 0, y: 30 },
        { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' },
        '-=0.4'
      )
      .fromTo(
        ctaRef.current,
        { opacity: 0, y: 30, scale: 0.8 },
        { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'back.out(1.7)' },
        '-=0.3'
      );

    // Scroll-driven exit: pin hero and scale/fade out
    const scrollTl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: '+=100%',
        pin: true,
        scrub: 0.8,
        pinSpacing: true,
      },
    });

    scrollTl
      .to(headingRef.current, { scale: 0.8, opacity: 0, y: -100, duration: 1 })
      .to(subtitleRef.current, { opacity: 0, y: -60, duration: 0.8 }, '<0.1')
      .to(taglineRef.current, { opacity: 0, y: -40, duration: 0.6 }, '<0.1')
      .to(ctaRef.current, { opacity: 0, scale: 0.5, duration: 0.5 }, '<0.1');

    return () => {
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  const handleCTAClick = () => {
    const projects = document.querySelector('#projects');
    if (projects) {
      const top = projects.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <section
      ref={sectionRef}
      id="home"
      className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden mobile-snap-section"
    >
      {/* Gradient orb decorations */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full opacity-20 blur-[120px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, var(--color-primary-green), transparent)',
          top: '10%',
          left: '-10%',
        }}
      />
      <div
        className="absolute w-[400px] h-[400px] rounded-full opacity-15 blur-[100px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, var(--color-primary-blue), transparent)',
          bottom: '10%',
          right: '-5%',
        }}
      />

      {/* Content */}
      <div className="relative z-10 text-center max-w-4xl">
        <h1
          ref={headingRef}
          className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-tight leading-none mb-6"
          style={{ opacity: 0 }}
        >
          <span className="gradient-text">Hastin Chen</span>
        </h1>

        <p
          ref={subtitleRef}
          className="text-xl sm:text-2xl md:text-3xl font-light text-[var(--color-text-secondary)] mb-4 tracking-wide"
          style={{ opacity: 0 }}
        >
          Aspiring Software Developer
        </p>

        <p
          ref={taglineRef}
          className="text-base sm:text-lg text-[var(--color-text-muted)] mb-10 font-mono"
          style={{ opacity: 0 }}
        >
          Building the future, one line at a time.
        </p>

        <div ref={ctaRef} style={{ opacity: 0 }}>
          <MagneticButton onClick={handleCTAClick}>
            Explore My Work →
          </MagneticButton>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
        <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)] font-mono">
          Scroll
        </span>
        <div className="w-[1px] h-8 bg-gradient-to-b from-[var(--color-primary-green)] to-transparent" />
      </div>
    </section>
  );
}
