import { useCallback, useEffect, useState } from 'react';
import AppShell from '../ios/AppShell';
import { Squircle } from '../ios';
import { PROJECTS, projectById, type Project } from './projects';
import './appstore.css';

function readHashId(): string | null {
  const raw = window.location.hash.replace(/^#/, '');
  return raw || null;
}

export default function AppStore() {
  const [selectedId, setSelectedId] = useState<string | null>(readHashId);

  useEffect(() => {
    const onHash = () => setSelectedId(readHashId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = useCallback((id: string) => {
    window.location.hash = id;
  }, []);
  const closeDetail = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '';
  }, []);

  const selected = projectById(selectedId);

  return (
    <AppShell title="App Store" glyph="🛍️" maxWidth={960}>
      {selected ? (
        <ProjectDetail project={selected} onBack={closeDetail} />
      ) : (
        <StoreList onOpen={open} />
      )}
    </AppShell>
  );
}

function AppIconTile({ project, size }: { project: Project; size: number }) {
  return (
    <Squircle
      radius={Infinity}
      className="store-icon"
      style={{ width: size, height: size, background: project.gradient, fontSize: size * 0.5 }}
    >
      <span aria-hidden>{project.glyph}</span>
    </Squircle>
  );
}

function StoreList({ onOpen }: { onOpen: (id: string) => void }) {
  const [featured, ...rest] = PROJECTS;
  return (
    <div className="store">
      <header className="store-head">
        <p className="store-eyebrow">Portfolio</p>
        <h1 className="store-h1">Projects</h1>
        <p className="store-sub">
          A collection of work — placeholder entries for now. Tap any card for details.
        </p>
      </header>

      <button className="store-featured ios-press" onClick={() => onOpen(featured.id)}>
        <Squircle radius={26} className="store-featured-card" style={{ background: featured.gradient }}>
          <span className="store-featured-label">Featured</span>
          <div className="store-featured-body">
            <div className="store-featured-glyph" aria-hidden>
              {featured.glyph}
            </div>
            <div className="store-featured-text">
              <h2>{featured.name}</h2>
              <p>{featured.tagline}</p>
            </div>
            <span className="store-get" aria-hidden>
              GET
            </span>
          </div>
        </Squircle>
      </button>

      <h3 className="store-section">All Projects</h3>
      <Squircle radius={22} className="store-list ios-card">
        {rest.map((p, i) => (
          <button
            key={p.id}
            className="store-row"
            onClick={() => onOpen(p.id)}
            style={{ borderTop: i === 0 ? 'none' : undefined }}
          >
            <AppIconTile project={p} size={58} />
            <div className="store-row-text">
              <span className="store-row-name">{p.name}</span>
              <span className="store-row-tag">{p.category} · {p.tagline}</span>
            </div>
            <span className="store-get small">GET</span>
          </button>
        ))}
      </Squircle>
    </div>
  );
}

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  return (
    <article className="detail">
      <button className="detail-back ios-press" onClick={onBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        App Store
      </button>

      <header className="detail-hero">
        <AppIconTile project={project} size={116} />
        <div className="detail-hero-text">
          <h1>{project.name}</h1>
          <p>{project.tagline}</p>
          <div className="detail-hero-actions">
            {project.url ? (
              <a className="store-get pill" href={project.url} target="_blank" rel="noopener noreferrer">
                OPEN
              </a>
            ) : (
              <span className="store-get pill">GET</span>
            )}
            <span className="detail-cat">{project.category}</span>
          </div>
        </div>
      </header>

      <section className="detail-screens" aria-label="Screenshots">
        {project.screens.map((g, i) => (
          <Squircle key={i} radius={22} className="detail-screen" style={{ background: g }}>
            <span aria-hidden>{project.glyph}</span>
          </Squircle>
        ))}
      </section>

      <section className="detail-section">
        <h2>About</h2>
        <p>{project.description}</p>
      </section>

      <section className="detail-section">
        <div className="detail-tags">
          {project.tags.map((t) => (
            <span key={t} className="detail-chip">{t}</span>
          ))}
        </div>
      </section>

      <section className="detail-info ios-card">
        <div className="detail-info-row">
          <span>Category</span>
          <span>{project.category}</span>
        </div>
        <div className="detail-info-row">
          <span>Year</span>
          <span>{project.year}</span>
        </div>
        <div className="detail-info-row">
          <span>Link</span>
          <span>{project.url ? new URL(project.url).host : 'Coming soon'}</span>
        </div>
      </section>
    </article>
  );
}
