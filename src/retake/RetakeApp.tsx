import { useEffect, useRef, useState } from 'react';
import AppShell from '../ios/AppShell';
import { Button } from '../ios';
import { createEngine, type Hud } from './engine';
import { LEVELS } from './levels';
import { sfx } from './sfx';
import './retake.css';

const MUTE_KEY = 'retake.muted.v1';

const EMPTY_HUD: Hud = {
  levelIndex: 0,
  levelCount: LEVELS.length,
  levelName: LEVELS[0].name,
  hint: LEVELS[0].hint,
  take: 1,
  takes: LEVELS[0].takes,
  ghosts: 0,
  secondsLeft: LEVELS[0].seconds,
  phase: 'slate',
  ending: null,
  muted: false,
  aspect: 30 / 12,
};

const ENDING_COPY: Record<string, { title: string; line: string }> = {
  cut: { title: 'Cut.', line: 'That take is in the can — it plays back with the next one.' },
  died: { title: 'Cut!', line: "Didn't survive the stunt. It still counts as a take." },
  expired: { title: "That's time.", line: 'The take ran long. It still counts.' },
  made: { title: "That's a wrap.", line: 'You hit the mark.' },
};

export default function RetakeApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ReturnType<typeof createEngine> | null>(null);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = createEngine(canvas, { onHud: setHud });
    engineRef.current = engine;
    engine.setMuted(muted);
    engine.start();
    // A dev-only handle on the loop. The game is driven by requestAnimationFrame,
    // which never fires in a hidden document, so an automated browser cannot
    // play it — but it can step the world through this and screenshot the
    // result. Vite drops the whole branch from a production build.
    if (import.meta.env.DEV) {
      (window as unknown as { __retake?: unknown }).__retake = engine;
    }
    return () => {
      engine.stop();
      engineRef.current = null;
    };
    // The engine owns its own loop for the life of the page; muting is pushed
    // to it separately rather than by tearing it down and rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted]);

  const { phase } = hud;
  const ending = hud.ending ? ENDING_COPY[hud.ending] : null;
  const takesLeft = Math.max(0, hud.takes - hud.ghosts);

  return (
    <AppShell
      title="Retake"
      glyph="🎬"
      maxWidth={1100}
      right={
        <Button variant="ghost" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </Button>
      }
    >
      <div className="rt-wrap">
        <div
          className="rt-stage"
          style={{ '--rt-aspect': hud.aspect } as React.CSSProperties}
        >
          <canvas ref={canvasRef} className="rt-canvas" aria-label={`${hud.levelName} — the stage`} />

          {/* The slate: what a take opens on. */}
          {phase === 'slate' && (
            <Slate hud={hud} onRoll={() => engineRef.current?.advance()} />
          )}

          {phase === 'cut' && ending && (
            <div className="rt-card rt-card-cut">
              <p className="rt-card-title">{ending.title}</p>
              <p className="rt-card-line">{ending.line}</p>
            </div>
          )}

          {phase === 'wrap' && (
            <div className="rt-card rt-card-wrap">
              <p className="rt-card-title">That&apos;s a wrap.</p>
              <p className="rt-card-line">
                {hud.levelName} — printed in {hud.ghosts + 1} take{hud.ghosts ? 's' : ''}.
              </p>
              <Button variant="primary" onClick={() => engineRef.current?.advance()}>
                {hud.levelIndex + 1 < hud.levelCount ? 'Next setup →' : 'Back to the first setup'}
              </Button>
            </div>
          )}

          {phase === 'out-of-takes' && (
            <div className="rt-card rt-card-out">
              <p className="rt-card-title">Out of takes.</p>
              <p className="rt-card-line">
                The stand-ins are in the wrong places. Shoot the scene again.
              </p>
              <Button variant="primary" onClick={() => engineRef.current?.reshoot()}>
                Reshoot the scene
              </Button>
            </div>
          )}
        </div>

        {/* ===== The film strip: one frame per take, spent and remaining ===== */}
        <div className="rt-hud">
          <div className="rt-hud-left">
            <span className="rt-shot">
              Shot {hud.levelIndex + 1}/{hud.levelCount}
            </span>
            <span className="rt-name">{hud.levelName}</span>
          </div>

          <div className="rt-strip" aria-label={`${takesLeft} of ${hud.takes} takes left`}>
            {Array.from({ length: hud.takes }, (_, i) => (
              <span
                key={i}
                className={`rt-frame ${i < hud.ghosts ? 'is-spent' : ''} ${
                  i === hud.ghosts && phase === 'rolling' ? 'is-rolling' : ''
                }`}
              />
            ))}
          </div>

          <div className="rt-hud-right">
            {phase === 'rolling' && <span className="rt-rolling">● REC {hud.secondsLeft}s</span>}
            <Button onClick={() => engineRef.current?.cut()} disabled={phase !== 'rolling'}>
              Cut (R)
            </Button>
            <Button variant="ghost" onClick={() => engineRef.current?.reshoot()}>
              Reshoot
            </Button>
          </div>
        </div>

        <p className="rt-keys">
          <kbd>←</kbd> <kbd>→</kbd> move · <kbd>Space</kbd> jump · <kbd>R</kbd> cut the take ·
          <kbd>Esc</kbd> reshoot the scene
        </p>
      </div>
    </AppShell>
  );
}

function Slate({ hud, onRoll }: { hud: Hud; onRoll: () => void }) {
  return (
    <div className="rt-card rt-card-slate">
      <div className="rt-slate-top" aria-hidden>
        <span className="rt-clap" />
      </div>
      <p className="rt-slate-shot">
        Shot {hud.levelIndex + 1} · Take {hud.take} of {hud.takes}
      </p>
      <p className="rt-card-title">{hud.levelName}</p>
      <p className="rt-card-line">{hud.hint}</p>
      <Button variant="primary" onClick={onRoll}>
        Roll it (Space)
      </Button>
    </div>
  );
}
