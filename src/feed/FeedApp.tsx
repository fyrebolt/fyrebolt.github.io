import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import AppShell from '../ios/AppShell';
import { Button } from '../ios';
import { createFeed, type FeedEvent, type FeedHandle } from './engine';
import { sfx } from './sfx';
import { QUIRK_BY_ID } from './quirks';
import type { HudSnapshot } from './types';
import './feed.css';

const MUTE_KEY = 'doomscroll.muted.v1';

const EMPTY_HUD: HudSnapshot = {
  phase: 'menu',
  score: 0,
  best: 0,
  combo: 0,
  shields: 3,
  wave: 1,
  quirks: [],
  pinned: null,
};

interface Banner {
  key: number;
  name: string;
  hint: string;
  color: string;
}

export default function FeedApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<FeedHandle | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(EMPTY_HUD);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    sfx.setMuted(muted);
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* private mode — the preference just won't stick */
    }
  }, [muted]);

  // --- Engine ---------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let bannerTimer = 0;
    const onEvent = (e: FeedEvent) => {
      if (e.kind !== 'quirk' || !e.quirk) return;
      const q = e.quirk;
      setBanner({ key: performance.now(), name: q.name, hint: q.hint, color: q.color });
      window.clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => setBanner(null), 2000);
    };

    const feed = createFeed(canvas, {
      onHud: setHud,
      onTick: (f) => {
        const bar = barRef.current;
        if (!bar) return;
        bar.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
        bar.style.background = f < 0.22 ? '#ff453a' : f < 0.45 ? '#ff9f0a' : '#5ac8fa';
      },
      onEvent,
    });
    feedRef.current = feed;

    return () => {
      window.clearTimeout(bannerTimer);
      feed.destroy();
      feedRef.current = null;
    };
  }, []);

  const startRun = useCallback(() => feedRef.current?.start(), []);
  const resumeRun = useCallback(() => feedRef.current?.resume(), []);
  const pauseRun = useCallback(() => feedRef.current?.pause(), []);
  const toMenu = useCallback(() => feedRef.current?.toMenu(), []);

  // There is no pointer lock to lose here, so Esc is a plain toggle: it is the
  // one gesture that has to work whether or not the mouse is over the feed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!feedRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (hud.phase === 'playing') pauseRun();
        else if (hud.phase === 'paused') resumeRun();
        return;
      }
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if (hud.phase === 'playing') return;
      e.preventDefault();
      if (hud.phase === 'paused') resumeRun();
      else startRun();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hud.phase, pauseRun, resumeRun, startRun]);

  const overlayClick = hud.phase === 'paused' ? resumeRun : startRun;

  return (
    <AppShell
      title="Doomscroll"
      glyph="📱"
      maxWidth={1040}
      right={
        <button
          className="feed-mute"
          onClick={() => setMuted((m) => !m)}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      }
    >
      <div className="feed-stage">
        <canvas ref={canvasRef} className="feed-canvas" aria-label="Doomscroll feed" />

        <div className="feed-timebar" aria-hidden>
          <div ref={barRef} className="feed-timebar-fill" />
        </div>

        <div className="feed-hud" aria-hidden={hud.phase !== 'playing'}>
          <div className="feed-hud-left">
            <span className="feed-score">{hud.score.toLocaleString()}</span>
            <span className="feed-sub">
              WAVE {hud.wave} · BEST {hud.best.toLocaleString()}
            </span>
          </div>
          <div className="feed-hud-right">
            {hud.combo > 1 && <span className="feed-combo">×{hud.combo}</span>}
            <span className="feed-shields" aria-label={`${hud.shields} hooks left`}>
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < hud.shields ? 'on' : ''} />
              ))}
            </span>
          </div>
        </div>

        <div className="feed-quirks" aria-live="polite">
          {hud.quirks.map((q) => {
            const def = QUIRK_BY_ID[q.id];
            return (
              <span
                key={q.id}
                className="feed-chip"
                style={{ '--chip': def.color } as CSSProperties}
                title={def.hint}
              >
                <b
                  className="feed-chip-fill"
                  style={{ transform: `scaleX(${q.remaining / q.total})` }}
                />
                <span>{def.name}</span>
              </span>
            );
          })}
        </div>

        {banner && (
          <div
            key={banner.key}
            className="feed-banner"
            style={{ color: banner.color }}
            role="status"
          >
            <strong>{banner.name}</strong>
            <span>{banner.hint}</span>
          </div>
        )}

        {hud.phase !== 'playing' && (
          <div
            className="feed-overlay"
            // Only the backdrop restarts; clicks inside the card belong to the
            // card's own button.
            onClick={(e) => {
              if (e.target === e.currentTarget) overlayClick();
            }}
          >
            {hud.phase === 'menu' && <Menu onStart={startRun} best={hud.best} />}
            {hud.phase === 'paused' && (
              <Paused onResume={resumeRun} onRestart={startRun} onMenu={toMenu} />
            )}
            {hud.phase === 'over' && <Over hud={hud} onAgain={startRun} onMenu={toMenu} />}
          </div>
        )}
      </div>

      <p className="feed-footnote">
        Doomscroll takes the wheel. Everything the feed does to you is scaled by how fast you are
        moving, so the only defence is speed — and the only way to score is to stop. Scroll with the
        wheel, a drag, or <kbd>↑</kbd> <kbd>↓</kbd>; <kbd>Esc</kbd> pauses.
      </p>
    </AppShell>
  );
}

// --- Overlays ---------------------------------------------------------------

function Menu({ onStart, best }: { onStart: () => void; best: number }) {
  return (
    <div className="feed-card">
      <h1 className="feed-title">DOOMSCROLL</h1>
      <p className="feed-tag">The feed reads you back.</p>
      <ul className="feed-rules">
        <li>
          <b>Stop</b> on a post to read it. Reading banks points and buys back attention — but only
          while you are slow enough to actually be reading.
        </li>
        <li>
          <b>Fly past</b> the red bait. It drains you while you look at it, and if you linger it
          hooks you. Three hooks ends the run.
        </li>
        <li>
          <b>Ads</b> take the feed for a second unless you were already moving.
        </li>
        <li>
          <b>Adapt.</b> Every few seconds the algorithm rewrites what your scroll does. The rail on
          the right always shows you the lie.
        </li>
      </ul>
      <div className="feed-actions">
        <Button variant="primary" onClick={onStart}>
          Start scrolling
        </Button>
      </div>
      {best > 0 && <p className="feed-best">Best {best.toLocaleString()}</p>}
    </div>
  );
}

function Paused({
  onResume,
  onRestart,
  onMenu,
}: {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="feed-card">
      <h2 className="feed-heading">Paused</h2>
      <p className="feed-tag">The feed will wait. It always waits.</p>
      <div className="feed-actions">
        <Button variant="primary" onClick={onResume}>
          Resume
        </Button>
        <Button onClick={onRestart}>Restart</Button>
        <Button variant="ghost" onClick={onMenu}>
          Menu
        </Button>
      </div>
      <p className="feed-best">Space to resume</p>
    </div>
  );
}

function Over({
  hud,
  onAgain,
  onMenu,
}: {
  hud: HudSnapshot;
  onAgain: () => void;
  onMenu: () => void;
}) {
  const record = hud.score > 0 && hud.score >= hud.best;
  return (
    <div className="feed-card">
      <h2 className="feed-heading">{record ? 'New best' : hud.shields > 0 ? 'Out of attention' : 'Hooked'}</h2>
      <p className="feed-final">{hud.score.toLocaleString()}</p>
      <p className="feed-tag">
        Wave {hud.wave} · Best {hud.best.toLocaleString()}
      </p>
      <div className="feed-actions">
        <Button variant="primary" onClick={onAgain}>
          Again
        </Button>
        <Button variant="ghost" onClick={onMenu}>
          Menu
        </Button>
      </div>
    </div>
  );
}
