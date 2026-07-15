import type { BlogCardProps } from '../../types';

export default function BlogCard({ post }: BlogCardProps) {
  return (
    <article
      className="glass-card gradient-border p-6 md:p-8 group
        hover:bg-[var(--color-glass-hover)] transition-all duration-300
        hover:-translate-y-2 hover:shadow-[0_8px_40px_rgba(0,200,83,0.1)]"
      data-cursor-hover
    >
      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {post.tags.map((tag) => (
          <span
            key={tag}
            className="text-[10px] font-mono font-medium uppercase tracking-wider
              px-2.5 py-1 rounded-full
              bg-[rgba(0,200,83,0.1)] text-[var(--color-primary-green)]
              border border-[rgba(0,200,83,0.2)]"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Date */}
      <time className="text-xs text-[var(--color-text-muted)] font-mono">
        {post.date}
      </time>

      {/* Title */}
      <h3 className="text-xl font-bold mt-2 mb-3 text-[var(--color-text-primary)]
        group-hover:gradient-text transition-colors duration-300">
        {post.title}
      </h3>

      {/* Excerpt */}
      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-6">
        {post.excerpt}
      </p>

      {/* Read More */}
      <a
        href={post.readMoreUrl}
        className="inline-flex items-center gap-2 text-sm font-medium
          text-[var(--color-primary-green)] hover:text-[var(--color-primary-yellow)]
          transition-colors duration-300 group/link"
        data-cursor-hover
      >
        Read More
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="group-hover/link:translate-x-1 transition-transform"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </a>
    </article>
  );
}
