import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import AppShell from '../ios/AppShell';
import { Button } from '../ios';
import { createGame, type GameEvent, type GameHandle } from './engine';
import { sfx } from './sfx';
import { WARP_BY_ID } from './warps';
import type { HudSnapshot } from './types';
import './game.css';

const MUTE_KEY = 'drift.muted.v1';

const EMPTY_HUD: HudSnapshot = {
  phase: 'menu',
  score: 0,
  best: 0,
  combo: 0,
  shields: 3,
  wave: 1,
  warps: [],
  locked: false,
};

interface Banner {
  key: number;
  name: string;
  hint: string;
  color: string;
}

export default function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameHandle | null>(null);

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
    const onEvent = (e: GameEvent) => {
      if (e.kind !== 'warp' || !e.warp) return;
      const w = e.warp;
      setBanner({ key: performance.now(), name: w.name, hint: w.hint, color: w.color });
      window.clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => setBanner(null), 2000);
    };

    const game = createGame(canvas, {
      onHud: setHud,
      onTick: (f) => {
        const bar = barRef.current;
        if (!bar) return;
        bar.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
        bar.style.background = f < 0.22 ? '#ff453a' : f < 0.45 ? '#ff9f0a' : '#5ac8fa';
      },
      onEvent,
    });
    gameRef.current = game;

    return () => {
      window.clearTimeout(bannerTimer);
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  // While the game owns the pointer, the site's soft trailing cursor would sit
  // frozen wherever the lock happened. Park it for the duration.
  useEffect(() => {
    const owned = hud.phase === 'playing';
    document.documentElement.classList.toggle('game-owns-cursor', owned);
    return () => document.documentElement.classList.remove('game-owns-cursor');
  }, [hud.phase]);

  const startRun = useCallback(() => gameRef.current?.start(), []);
  const resumeRun = useCallback(() => gameRef.current?.resume(), []);

  // Space / Enter mirrors whatever the visible primary button does, so a run
  // can be restarted without ever going back to the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if (hud.phase === 'playing') return;
      e.preventDefault();
      if (hud.phase === 'paused') resumeRun();
      else startRun();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hud.phase, resumeRun, startRun]);

  const overlayClick = hud.phase === 'paused' ? resumeRun : startRun;

  return (
    <AppShell
      title="Drift"
      glyph="🎯"
      maxWidth={1040}
      right={
        <button
          className="game-mute"
          onClick={() => setMuted((m) => !m)}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      }
    >
      <div className="game-stage">
        <canvas ref={canvasRef} className="game-canvas" aria-label="Drift arena" />

        <div className="game-timebar" aria-hidden>
          <div ref={barRef} className="game-timebar-fill" />
        </div>

        <div className="game-hud" aria-hidden={hud.phase !== 'playing'}>
          <div className="game-hud-left">
            <span className="game-score">{hud.score.toLocaleString()}</span>
            <span className="game-sub">
              WAVE {hud.wave} · BEST {hud.best.toLocaleString()}
            </span>
          </div>
          <div className="game-hud-right">
            {hud.combo > 1 && <span className="game-combo">×{hud.combo}</span>}
            <span className="game-shields">
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < hud.shields ? 'on' : ''} />
              ))}
            </span>
          </div>
        </div>

        <div className="game-warps" aria-live="polite">
          {hud.warps.map((w) => {
            const def = WARP_BY_ID[w.id];
            return (
              <span
                key={w.id}
                className="game-chip"
                style={{ '--chip': def.color } as CSSProperties}
                title={def.hint}
              >
                <b
                  className="game-chip-fill"
                  style={{ transform: `scaleX(${w.remaining / w.total})` }}
                />
                <span>{def.name}</span>
              </span>
            );
          })}
        </div>

        {banner && (
          <div key={banner.key} className="game-banner" style={{ color: banner.color }} role="status">
            <strong>{banner.name}</strong>
            <span>{banner.hint}</span>
          </div>
        )}

        {hud.phase !== 'playing' && (
          <div
            className="game-overlay"
            // Only the backdrop restarts; clicks inside the card belong to the
            // card's own button.
            onClick={(e) => {
              if (e.target === e.currentTarget) overlayClick();
            }}
          >
            {hud.phase === 'menu' && <Menu onStart={startRun} best={hud.best} />}
            {hud.phase === 'paused' && <Paused onResume={resumeRun} />}
            {hud.phase === 'over' && <Over hud={hud} onAgain={startRun} />}
          </div>
        )}
      </div>

      <p className="game-footnote">
        Drift takes your cursor with the Pointer Lock API and hands back a fake one, moved by the
        <em> fraction</em> of the arena your hand covered — so the arena always feels the same size,
        whatever the window is doing. Press <kbd>Esc</kbd> to give the cursor back.
      </p>
    </AppShell>
  );
}

// --- Overlays ---------------------------------------------------------------

function Menu({ onStart, best }: { onStart: () => void; best: number }) {
  return (
    <div className="game-card">
      <h1 className="game-title">DRIFT</h1>
      <p className="game-tag">Your cursor stops being yours.</p>
      <ul className="game-rules">
        <li>
          <b>Collect</b> the cyan orbs — each one buys you time and builds a combo.
        </li>
        <li>
          <b>Dodge</b> the red hunters. Three hits and the run is over.
        </li>
        <li>
          <b>Adapt.</b> Every few seconds a warp rewrites how your hand maps to the cursor. The
          floor grid always shows you the lie.
        </li>
      </ul>
      <Button variant="primary" onClick={onStart}>
        Take the cursor
      </Button>
      {best > 0 && <p className="game-best">Best {best.toLocaleString()}</p>}
    </div>
  );
}

function Paused({ onResume }: { onResume: () => void }) {
  return (
    <div className="game-card">
      <h2 className="game-heading">Paused</h2>
      <p className="game-tag">You have your cursor back.</p>
      <Button variant="primary" onClick={onResume}>
        Resume
      </Button>
    </div>
  );
}

function Over({ hud, onAgain }: { hud: HudSnapshot; onAgain: () => void }) {
  const record = hud.score > 0 && hud.score >= hud.best;
  return (
    <div className="game-card">
      <h2 className="game-heading">{record ? 'New best' : 'Run over'}</h2>
      <p className="game-final">{hud.score.toLocaleString()}</p>
      <p className="game-tag">
        Wave {hud.wave} · Best {hud.best.toLocaleString()}
      </p>
      <Button variant="primary" onClick={onAgain}>
        Again
      </Button>
    </div>
  );
}
