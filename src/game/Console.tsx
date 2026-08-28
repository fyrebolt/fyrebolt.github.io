import { useEffect, useRef, useState } from 'react';
import { execute, statusLines, type CheatState, type Line } from './cheats';

/**
 * The prompt behind ⌘K.
 *
 * It says as little as it can get away with: no title, no list of commands, no
 * mention of it anywhere else in the interface. What it accepts is something
 * you have to already know. `help` is answered, in the sense that it is
 * refused.
 */
export default function Console({
  state,
  onState,
  onClose,
}: {
  state: CheatState;
  onState: (next: CheatState) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [
    { kind: 'dim', text: 'drift console' },
    ...statusLines(state),
  ]);
  /** Typed lines, newest last, for ↑ recall. */
  const historyRef = useRef<string[]>([]);
  const [recall, setRecall] = useState(-1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the newest output in view without yanking the page around it.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines]);

  const submit = () => {
    const raw = value;
    setValue('');
    setRecall(-1);
    if (raw.trim()) historyRef.current.push(raw.trim());
    const result = execute(raw, state);
    if (result.out.length) setLines((prev) => [...prev, ...result.out]);
    if (result.state !== state) onState(result.state);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Everything typed in here belongs to the box, not to the game underneath.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const hist = historyRef.current;
      if (!hist.length) return;
      e.preventDefault();
      const next =
        e.key === 'ArrowUp'
          ? Math.min(hist.length - 1, recall + 1)
          : Math.max(-1, recall - 1);
      setRecall(next);
      setValue(next < 0 ? '' : hist[hist.length - 1 - next]);
    }
  };

  return (
    <div
      className="game-console-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="game-console"
        role="dialog"
        aria-modal="true"
        aria-label="Console"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="game-console-bar" aria-hidden>
          <i />
          <i />
          <i />
        </div>

        <div className="game-console-log" ref={logRef}>
          {lines.map((line, i) => (
            <p key={i} className={`game-console-line is-${line.kind}`}>
              {line.kind === 'in' && <span className="game-console-caret" aria-hidden>›</span>}
              {line.text}
            </p>
          ))}
        </div>

        <label className="game-console-input">
          <span className="game-console-caret" aria-hidden>
            ›
          </span>
          <input
            ref={inputRef}
            value={value}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Command"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
      </div>
    </div>
  );
}
