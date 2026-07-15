// ===== About Me content =====
// Filler/derived from the previous portfolio sections. Edit freely.

export const BIO: string[] = [
  "I'm an aspiring software developer passionate about building elegant, performant applications that make a difference. With a keen eye for design and a love for clean code, I'm always exploring new technologies and pushing the boundaries of what's possible on the web.",
  "From neural networks to full-stack web applications, I enjoy diving deep into complex problems and emerging with creative solutions. When I'm not coding, you can find me exploring new frameworks, contributing to open source, or participating in hackathons.",
];

export const SKILLS: string[] = [
  'React',
  'TypeScript',
  'Python',
  'Node.js',
  'GSAP',
  'Tailwind CSS',
  'Git',
  'JavaScript',
];

export interface Post {
  id: string;
  title: string;
  date: string;
  excerpt: string;
  url: string;
  tags: string[];
}

export const POSTS: Post[] = [
  {
    id: '1',
    title: 'Getting Started with React and TypeScript',
    date: 'March 2026',
    excerpt:
      'A beginner-friendly guide to setting up a modern React project with TypeScript, Vite, and Tailwind CSS.',
    url: '#',
    tags: ['React', 'TypeScript'],
  },
  {
    id: '2',
    title: 'Building Cinematic Scroll Animations with GSAP',
    date: 'February 2026',
    excerpt:
      'Dive into GSAP ScrollTrigger to create Apple-inspired parallax effects, pinned sections, and smooth scrubbed animations.',
    url: '#',
    tags: ['Animation', 'GSAP'],
  },
  {
    id: '3',
    title: 'My Journey into Neural Networks',
    date: 'January 2026',
    excerpt:
      'Exploring the fundamentals of neural networks — from perceptrons to deep learning — and building my first ML project from scratch.',
    url: '#',
    tags: ['ML', 'Python'],
  },
];

// Same Formspree placeholder as the original contact form — swap for a real
// endpoint to enable submissions.
export const FORMSPREE_ENDPOINT = 'https://formspree.io/f/YOUR_FORM_ID';
