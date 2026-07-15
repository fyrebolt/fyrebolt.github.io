// ===== TypeScript Interfaces & Types =====

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  updated_at: string;
  fork: boolean;
}

export interface BlogPost {
  id: string;
  title: string;
  date: string;
  excerpt: string;
  readMoreUrl: string;
  tags: string[];
}

export interface ContactFormData {
  name: string;
  email: string;
  message: string;
}

export interface NavLink {
  label: string;
  href: string;
}

export interface SectionRevealProps {
  children: React.ReactNode;
  className?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  delay?: number;
  duration?: number;
  stagger?: number;
}

export interface MagneticButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
  strength?: number;
}

export interface ProjectCardProps {
  repo: GitHubRepo;
  index: number;
}

export interface BlogCardProps {
  post: BlogPost;
  index: number;
}
