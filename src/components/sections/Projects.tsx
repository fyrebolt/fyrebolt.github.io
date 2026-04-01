import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGitHubRepos } from '../../hooks/useGitHubRepos';
import ProjectCard from '../ui/ProjectCard';
import SectionReveal from '../ui/SectionReveal';

gsap.registerPlugin(ScrollTrigger);

export default function Projects() {
  const sectionRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const { repos, loading, error } = useGitHubRepos();

  useEffect(() => {
    if (!cardsRef.current || loading) return;

    const cards = cardsRef.current.querySelectorAll(':scope > *');
    if (cards.length === 0) return;

    gsap.fromTo(
      cards,
      { opacity: 0, y: 60, scale: 0.95 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.8,
        stagger: 0.15,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: cardsRef.current,
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        },
      }
    );

    return () => {
      ScrollTrigger.getAll().forEach((t) => {
        if (t.trigger === cardsRef.current) t.kill();
      });
    };
  }, [loading, repos]);

  return (
    <section
      ref={sectionRef}
      id="projects"
      className="relative z-10 section-padding mobile-snap-section"
    >
      <div className="max-w-7xl mx-auto content-backdrop">
        <SectionReveal className="text-center mb-16">
          <span className="text-sm font-mono uppercase tracking-[0.3em] text-[var(--color-primary-green)] mb-4 block">
            Portfolio
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold">
            Featured <span className="gradient-text">Projects</span>
          </h2>
          <p className="text-[var(--color-text-secondary)] mt-4 max-w-2xl mx-auto">
            A collection of my work pulled directly from GitHub. Each project represents
            a step in my journey as a developer.
          </p>
        </SectionReveal>

        {/* Loading state */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-full bg-[var(--color-primary-green)] animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="text-center py-16">
            <p className="text-[var(--color-text-muted)] font-mono text-sm">
              Failed to fetch repos — showing cached data
            </p>
          </div>
        )}

        {/* Cards grid */}
        {!loading && (
          <div
            ref={cardsRef}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {repos.length > 0 ? (
              repos.map((repo, index) => (
                <ProjectCard key={repo.id} repo={repo} index={index} />
              ))
            ) : (
              /* Placeholder if no repos returned */
              [
                { id: 1, name: 'project-alpha', description: 'A full-stack web application built with React and Node.js', language: 'TypeScript', stargazers_count: 12, forks_count: 3, html_url: '#', topics: [], updated_at: '', full_name: '', fork: false },
                { id: 2, name: 'neural-net', description: 'Machine learning experiments and neural network implementations', language: 'Python', stargazers_count: 8, forks_count: 1, html_url: '#', topics: [], updated_at: '', full_name: '', fork: false },
                { id: 3, name: 'design-system', description: 'A modern component library with accessibility built in', language: 'TypeScript', stargazers_count: 5, forks_count: 0, html_url: '#', topics: [], updated_at: '', full_name: '', fork: false },
              ].map((repo, index) => (
                <ProjectCard key={repo.id} repo={repo} index={index} />
              ))
            )}
          </div>
        )}

        {/* View all on GitHub */}
        <div className="text-center mt-12">
          <a
            href="https://github.com/fyrebolt"
            target="_blank"
            rel="noopener noreferrer"
            data-cursor-hover
            className="inline-flex items-center gap-2 text-sm font-medium
              text-[var(--color-text-secondary)] hover:text-[var(--color-primary-green)]
              transition-colors duration-300 group"
          >
            View all on GitHub
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="group-hover:translate-x-1 transition-transform"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
