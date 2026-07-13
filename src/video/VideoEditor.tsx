import { useCallback, useEffect, useState } from 'react';
import { TOOLS, toolById } from './tools/registry';

/** Read the active tool id from the URL hash (/video/#<id>), falling back to the first tool. */
function readHashId(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return toolById(raw).id;
}

export default function VideoEditor() {
  const [activeId, setActiveId] = useState<string>(readHashId);

  // Keep in sync with back/forward and manual hash edits.
  useEffect(() => {
    const onHash = () => setActiveId(readHashId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = useCallback((id: string) => {
    if (window.location.hash.replace(/^#/, '') !== id) {
      window.location.hash = id; // fires hashchange -> updates state, keeps it bookmarkable
    } else {
      setActiveId(id);
    }
  }, []);

  const active = toolById(activeId);
  const ActiveTool = active.component;

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <header className="max-w-7xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between">
        <a
          href="/"
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          ← Back to site
        </a>
        <span className="text-xs text-[var(--color-text-muted)] font-mono">runs entirely in your browser</span>
      </header>

      <div className="max-w-7xl mx-auto px-6 pb-24 flex flex-col md:flex-row gap-8">
        {/* ---- Vertical tool menu ---- */}
        <nav
          aria-label="Editing tools"
          className="md:w-56 md:flex-none flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-2 md:pb-0"
        >
          <div className="hidden md:block text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] px-2 mb-1">
            Tools
          </div>
          {TOOLS.map((tool) => {
            const isActive = tool.id === active.id;
            return (
              <button
                key={tool.id}
                onClick={() => select(tool.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 shrink-0 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--color-glass-hover)] text-[var(--color-text-primary)] border border-[var(--color-primary-green)]'
                    : 'text-[var(--color-text-secondary)] border border-transparent hover:bg-[var(--color-glass-bg)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {tool.icon}
                </span>
                <span className="whitespace-nowrap">{tool.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ---- Active tool ---- */}
        <main className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <span aria-hidden="true">{active.icon}</span>
            <span className="gradient-text">{active.label}</span>
          </h1>
          <p className="text-[var(--color-text-secondary)] mt-2 mb-8 max-w-2xl">{active.blurb}</p>

          <ActiveTool />
        </main>
      </div>
    </div>
  );
}
