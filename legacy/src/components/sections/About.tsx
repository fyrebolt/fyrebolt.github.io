import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SectionReveal from '../ui/SectionReveal';
import MagneticButton from '../ui/MagneticButton';

gsap.registerPlugin(ScrollTrigger);

export default function About() {
  const sectionRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const image = imageRef.current;
    const content = contentRef.current;
    if (!section || !image || !content) return;

    // Parallax on the image
    gsap.to(image, {
      yPercent: -15,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1,
      },
    });

    // Scale-in image on scroll
    gsap.fromTo(
      image,
      { scale: 0.85, opacity: 0 },
      {
        scale: 1,
        opacity: 1,
        duration: 1.2,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: section,
          start: 'top 70%',
          toggleActions: 'play none none reverse',
        },
      }
    );

    return () => {
      ScrollTrigger.getAll().forEach((t) => {
        if (t.trigger === section) t.kill();
      });
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="about"
      className="relative z-10 section-padding mobile-snap-section"
    >
      <div className="max-w-7xl mx-auto content-backdrop">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Image */}
          <div ref={imageRef} className="relative" style={{ willChange: 'transform' }}>
            <div className="relative aspect-[4/5] rounded-2xl overflow-hidden glass-card">
              {/* Placeholder image — swap this out with your photo */}
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-bg-surface)] to-[var(--color-bg-elevated)] flex items-center justify-center">
                <div className="text-center">
                  <div className="w-32 h-32 mx-auto mb-4 rounded-full bg-gradient-to-br from-[var(--color-primary-green)] to-[var(--color-primary-blue)] opacity-30" />
                  <p className="text-sm text-[var(--color-text-muted)] font-mono">
                    {/* TODO: Replace this div with an <img> tag pointing to your photo */}
                    Your Photo Here
                  </p>
                </div>
              </div>
            </div>

            {/* Decorative gradient border accent */}
            <div className="absolute -inset-[2px] rounded-2xl bg-gradient-to-br from-[var(--color-primary-green)] via-transparent to-[var(--color-primary-blue)] opacity-30 -z-10 blur-sm" />
          </div>

          {/* Content */}
          <SectionReveal direction="right" className="space-y-6">
            <div>
              <span className="text-sm font-mono uppercase tracking-[0.3em] text-[var(--color-primary-green)] mb-4 block">
                About Me
              </span>
              <h2 className="text-4xl md:text-5xl font-bold leading-tight">
                Hello, I'm{' '}
                <span className="gradient-text">Hastin</span>
              </h2>
            </div>

            <div className="space-y-4 text-[var(--color-text-secondary)] leading-relaxed">
              <p>
                I'm an aspiring software developer passionate about building elegant, 
                performant applications that make a difference. With a keen eye for design 
                and a love for clean code, I'm always exploring new technologies and pushing
                the boundaries of what's possible on the web.
              </p>
              <p>
                From neural networks to full-stack web applications, I enjoy diving deep 
                into complex problems and emerging with creative solutions. When I'm not 
                coding, you can find me exploring new frameworks, contributing to open 
                source, or participating in hackathons.
              </p>
            </div>

            {/* Skills */}
            <div className="flex flex-wrap gap-3 pt-2">
              {['React', 'TypeScript', 'Python', 'Node.js', 'GSAP', 'Tailwind CSS', 'Git', 'JavaScript'].map(
                (skill) => (
                  <span
                    key={skill}
                    className="px-4 py-2 text-xs font-mono rounded-full
                      bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)]
                      text-[var(--color-text-secondary)]
                      hover:border-[var(--color-primary-green)] hover:text-[var(--color-primary-green)]
                      transition-all duration-300"
                    data-cursor-hover
                  >
                    {skill}
                  </span>
                )
              )}
            </div>

            {/* Resume Download */}
            <div className="pt-4">
              <MagneticButton
                href="#"
                /* ============================================
                 * TODO: Replace "#" above with the URL to your
                 * resume PDF file. For example:
                 * href="/fyrebolt.github.io/resume.pdf"
                 * 
                 * Place your resume PDF in the /public folder
                 * and reference it with the base path prefix.
                 * ============================================ */
              >
                📄 Download Resume
              </MagneticButton>
            </div>
          </SectionReveal>
        </div>
      </div>
    </section>
  );
}
