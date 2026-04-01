import SectionReveal from '../ui/SectionReveal';
import BlogCard from '../ui/BlogCard';
import type { BlogPost } from '../../types';

/**
 * ============================================
 * TODO: Wire in real blog content here.
 *
 * Replace the PLACEHOLDER_POSTS array below
 * with your actual blog data. You can:
 *   1. Import from a local JSON/MDX file
 *   2. Fetch from a CMS API (Contentful, Sanity, etc.)
 *   3. Use a markdown-to-JSON build step
 *
 * Each post should match the BlogPost interface:
 *   { id, title, date, excerpt, readMoreUrl, tags }
 * ============================================
 */

const PLACEHOLDER_POSTS: BlogPost[] = [
  {
    id: '1',
    title: 'Getting Started with React and TypeScript',
    date: 'March 2026',
    excerpt:
      'A beginner-friendly guide to setting up a modern React project with TypeScript, Vite, and Tailwind CSS. Learn the patterns that will make your code cleaner and more maintainable.',
    readMoreUrl: '#',
    tags: ['React', 'TypeScript'],
  },
  {
    id: '2',
    title: 'Building Cinematic Scroll Animations with GSAP',
    date: 'February 2026',
    excerpt:
      'Dive deep into GSAP ScrollTrigger to create Apple-inspired parallax effects, pinned sections, and smooth scrubbed animations that make your website feel like a movie.',
    readMoreUrl: '#',
    tags: ['Animation', 'GSAP'],
  },
  {
    id: '3',
    title: 'My Journey into Neural Networks',
    date: 'January 2026',
    excerpt:
      'Exploring the fundamentals of neural networks — from perceptrons to deep learning. A reflection on my experience building my first ML project from scratch.',
    readMoreUrl: '#',
    tags: ['ML', 'Python'],
  },
];

export default function Blog() {
  return (
    <section id="blog" className="relative z-10 section-padding mobile-snap-section">
      <div className="max-w-7xl mx-auto content-backdrop">
        <SectionReveal className="text-center mb-16">
          <span className="text-sm font-mono uppercase tracking-[0.3em] text-[var(--color-primary-green)] mb-4 block">
            Thoughts
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold">
            Latest <span className="gradient-text">Blog Posts</span>
          </h2>
          <p className="text-[var(--color-text-secondary)] mt-4 max-w-2xl mx-auto">
            Writing about code, design, and the things I learn along the way.
          </p>
        </SectionReveal>

        <SectionReveal stagger={0.2}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PLACEHOLDER_POSTS.map((post, index) => (
              <BlogCard key={post.id} post={post} index={index} />
            ))}
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
