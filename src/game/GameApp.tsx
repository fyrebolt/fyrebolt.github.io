import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import AppShell from '../ios/AppShell';
import { Button } from '../ios';
import { createGame, type GameEvent, type GameHandle } from './engine';
import { sfx } from './sfx';
import { HARD_WARPS, WARP_BY_ID } from './warps';
import Console from './Console';
import { NO_CHEATS, type CheatState } from './cheats';
import { LESSONS } from './tutorial';
import type { HudSnapshot } from './types';
import './game.css';

const MUTE_KEY = 'drift.muted.v1';
const CHEAT_KEY = 'drift.yolo.v1';

const EMPTY_HUD: HudSnapshot = {
  phase: 'menu',
  score: 0,
  best: 0,
  combo: 0,
  shields: 3,
  wave: 1,
  warps: [],
  locked: false,
  tutorial: null,
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
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [cheats, setCheats] = useState<CheatState>(() => {
    try {
      return { yolo: localStorage.getItem(CHEAT_KEY) === '1' };
    } catch {
      return NO_CHEATS;
    }
  });
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

  // Declared after the engine effect on purpose: effects run in order, so on
  // mount this fires once `gameRef` is populated and can do the arming itself.
  //
  // The flag outlives the tab, like the mute preference — a code you were told
  // once shouldn't have to be re-entered after every reload. It reaches the
  // engine as a set of benched warps, which only the next `start()` reads.
  useEffect(() => {
    try {
      localStorage.setItem(CHEAT_KEY, cheats.yolo ? '1' : '0');
    } catch {
      /* private mode — the flag just won't stick */
    }
    gameRef.current?.benchWarps(cheats.yolo ? HARD_WARPS : []);
  }, [cheats]);

  // While the game owns the pointer, the site's soft trailing cursor would sit
  // frozen wherever the lock happened. Park it for the duration.
  useEffect(() => {
    const owned = hud.phase === 'playing';
    document.documentElement.classList.toggle('game-owns-cursor', owned);
    return () => document.documentElement.classList.remove('game-owns-cursor');
  }, [hud.phase]);

  const startRun = useCallback(() => gameRef.current?.start(), []);
  const resumeRun = useCallback(() => gameRef.current?.resume(), []);
  const startTutorial = useCallback(() => gameRef.current?.startTutorial(), []);
  const toMenu = useCallback(() => gameRef.current?.toMenu(), []);

  // Keys mirror whatever the visible buttons do, so a run can be restarted —
  // or a lesson abandoned — without ever going back to the mouse.
  // ⌘K / Ctrl+K anywhere in Drift. Nothing in the interface points at it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      e.preventDefault();
      setConsoleOpen((open) => {
        // Typing into a box while the arena has your mouse and a clock running
        // is nobody's idea of a good time — step out of the run first.
        if (!open && gameRef.current && hud.phase === 'playing') gameRef.current.pause();
        return !open;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hud.phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;
      // While the prompt is up it owns the keyboard.
      if (consoleOpen) return;

      if (e.key === 'Escape') {
        // Under pointer lock the browser eats this keydown and releases the
        // lock instead, which pauses us through `onLockChange`. This branch is
        // for the cases where there is no lock to lose: the unlocked fallback,
        // and the pause card itself, where a second Esc leaves the tutorial.
        if (hud.phase === 'playing' && !hud.locked) {
          e.preventDefault();
          game.pause();
        } else if (hud.phase === 'paused' && hud.tutorial) {
          e.preventDefault();
          toMenu();
        }
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
  }, [hud.phase, hud.locked, hud.tutorial, consoleOpen, toMenu, resumeRun, startRun]);

  const overlayClick = hud.phase === 'paused' ? resumeRun : startRun;

  // The tutorial owns the whole arena chrome: no score, no clock and no warp
  // chips, because the lesson card already names the one warp in force. That
  // holds through the closing card too, where the bar reads a full eleven of
  // eleven instead of flashing a meaningless clock back at you.
  const tut = hud.tutorial;
  const teaching = tut !== null && tut.step < tut.total;

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
          {tut ? (
            // Same bar, different quantity: lessons banked instead of seconds.
            <div
              key="lessons"
              className="game-timebar-fill"
              style={{ transform: `scaleX(${tut.step / tut.total})`, background: '#bf5af2' }}
            />
          ) : (
            <div key="clock" ref={barRef} className="game-timebar-fill" />
          )}
        </div>

        {!tut && (
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
        )}

        {!tut && (
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
        )}

        {banner && (
          <div key={banner.key} className="game-banner" style={{ color: banner.color }} role="status">
            <strong>{banner.name}</strong>
            <span>{banner.hint}</span>
          </div>
        )}

        {teaching && <LessonCard step={tut.step} total={tut.total} />}

        {hud.phase !== 'playing' && (
          <div
            className="game-overlay"
            // Only the backdrop restarts; clicks inside the card belong to the
            // card's own button.
            onClick={(e) => {
              if (e.target === e.currentTarget) overlayClick();
            }}
          >
            {hud.phase === 'menu' && (
              <Menu onStart={startRun} onLearn={startTutorial} best={hud.best} />
            )}
            {hud.phase === 'paused' && (
              <Paused
                onResume={resumeRun}
                onRestart={startRun}
                onMenu={toMenu}
                tutorial={hud.tutorial !== null}
              />
            )}
            {hud.phase === 'over' &&
              (hud.tutorial ? (
                <TutorialDone onPlay={startRun} onRepeat={startTutorial} />
              ) : (
                <Over hud={hud} onAgain={startRun} onLearn={startTutorial} />
              ))}
          </div>
        )}
        {consoleOpen && (
          <Console
            state={cheats}
            onState={setCheats}
            onClose={() => setConsoleOpen(false)}
          />
        )}
      </div>

      <p className="game-footnote">
        Drift takes your cursor with the Pointer Lock API and hands back a fake one, moved by the
        <em> fraction</em> of the arena your hand covered — so the arena always feels the same size,
        whatever the window is doing. Press <kbd>Esc</kbd> to give the cursor back, resume, or
        restart.
      </p>
    </AppShell>
  );
}

// --- The lesson card --------------------------------------------------------

/**
 * The persistent caption for the warp currently being taught. It sits inside
 * the arena rather than under it because under pointer lock the arena is the
 * whole world — a caption below the slab is a caption nobody reads.
 */
function LessonCard({ step, total }: { step: number; total: number }) {
  const lesson = LESSONS[step];
  if (!lesson) return null;
  // Warp lessons borrow their name, one-liner and colour from the catalogue, so
  // the card and the HUD chip can never describe the same warp differently.
  const { name, hint, color } = lesson.warp
    ? WARP_BY_ID[lesson.warp]
    : { name: lesson.title, hint: lesson.hint, color: lesson.color };
  return (
    <div
      key={step}
      className="game-lesson"
      style={{ '--lesson': color } as CSSProperties}
      role="status"
      aria-live="polite"
    >
      <div className="game-lesson-bar">
        <span className="game-lesson-step">
          Lesson {step + 1} / {total}
        </span>
        <span className="game-lesson-exit">
          <kbd>Esc</kbd> to leave
        </span>
      </div>
      <strong>{name}</strong>
      <em>{hint}</em>
      <p>{lesson.body}</p>
      <span className="game-lesson-go">Collect the orb to continue</span>
    </div>
  );
}

// --- Overlays ---------------------------------------------------------------

function Menu({
  onStart,
  onLearn,
  best,
}: {
  onStart: () => void;
  onLearn: () => void;
  best: number;
}) {
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
      <div className="game-actions">
        <Button variant="primary" onClick={onStart}>
          Take the cursor
        </Button>
        <Button onClick={onLearn}>Learn the warps</Button>
      </div>
      {best > 0 && <p className="game-best">Best {best.toLocaleString()}</p>}
    </div>
  );
}

/**
 * Esc is the only pause gesture (see pointer.ts), so this card is where every
 * "I want out of this" lands: restart the run, or drop back to the title —
 * which is the one route from a run to the tutorial that isn't dying first.
 */
function Paused({
  onResume,
  onRestart,
  onMenu,
  tutorial,
}: {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  tutorial: boolean;
}) {
  return (
    <div className="game-card">
      <h2 className="game-heading">Paused</h2>
      <p className="game-tag">You have your cursor back.</p>
      <div className="game-actions">
        <Button variant="primary" onClick={onResume}>
          Resume
        </Button>
        {tutorial ? (
          <Button onClick={onMenu}>Leave tutorial</Button>
        ) : (
          <>
            <Button onClick={onRestart}>Restart</Button>
            <Button variant="ghost" onClick={onMenu}>
              Menu
            </Button>
          </>
        )}
      </div>
      <p className="game-best">{tutorial ? 'Esc again to leave' : 'Space to resume'}</p>
    </div>
  );
}

function TutorialDone({ onPlay, onRepeat }: { onPlay: () => void; onRepeat: () => void }) {
  return (
    <div className="game-card">
      <h2 className="game-heading">That's every warp</h2>
      <p className="game-tag">
        In a real run they arrive on a clock, up to three at once, and the hunters don't miss.
      </p>
      <div className="game-actions">
        <Button variant="primary" onClick={onPlay}>
          Take the cursor
        </Button>
        <Button onClick={onRepeat}>Run it again</Button>
      </div>
    </div>
  );
}

function Over({
  hud,
  onAgain,
  onLearn,
}: {
  hud: HudSnapshot;
  onAgain: () => void;
  onLearn: () => void;
}) {
  const record = hud.score > 0 && hud.score >= hud.best;
  return (
    <div className="game-card">
      <h2 className="game-heading">{record ? 'New best' : 'Run over'}</h2>
      <p className="game-final">{hud.score.toLocaleString()}</p>
      <p className="game-tag">
        Wave {hud.wave} · Best {hud.best.toLocaleString()}
      </p>
      <div className="game-actions">
        <Button variant="primary" onClick={onAgain}>
          Again
        </Button>
        <Button onClick={onLearn}>Learn the warps</Button>
      </div>
    </div>
  );
}
