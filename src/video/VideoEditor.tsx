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
    <div className="ios-editor ios-wallpaper min-h-screen text-[var(--color-text-primary)]">
      {/* ---- Frosted top bar ---- */}
      <header className="sticky top-0 z-40 px-5 pt-3.5">
        <div className="ios-glass max-w-7xl mx-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 rounded-[20px]">
          <a href="/" className="justify-self-start inline-flex items-center gap-1 text-[15px] font-medium text-[var(--color-accent)] px-2.5 py-1.5 rounded-xl hover:bg-[rgba(0,122,255,0.08)] transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Home</span>
          </a>
          <div className="inline-flex items-center gap-2 text-[17px] font-semibold">
            <span aria-hidden>🎥</span>
            <span>Camera</span>
          </div>
          <span className="justify-self-end text-xs text-[var(--color-text-muted)] font-mono hidden sm:block">
            runs entirely in your browser
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-5 pt-6 pb-28 flex flex-col md:flex-row gap-7">
        {/* ---- Tool menu ---- */}
        <nav
          aria-label="Editing tools"
          className="md:w-60 md:flex-none flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0"
        >
          <div className="hidden md:block text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] px-3 mb-1">
            Tools
          </div>
          {TOOLS.map((tool) => {
            const isActive = tool.id === active.id;
            return (
              <button
                key={tool.id}
                onClick={() => select(tool.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`tool-nav-btn flex items-center gap-3 shrink-0 rounded-2xl px-3.5 py-3 text-left text-[15px] font-medium ${
                  isActive ? 'is-active' : ''
                }`}
              >
                <span aria-hidden="true" className="text-xl leading-none">
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
          <p className="text-[var(--color-text-secondary)] mt-2 mb-8 max-w-2xl text-[15px] leading-relaxed">
            {active.blurb}
          </p>

          <ActiveTool />
        </main>
      </div>
    </div>
  );
}
