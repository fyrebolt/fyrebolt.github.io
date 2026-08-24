// ===== Keyboard shortcuts reference — opened via the toolbar's info button or "/" =====

import { useEffect } from 'react';

interface Shortcut {
  keys: string[];
  label: string;
}
interface Group {
  title: string;
  shortcuts: Shortcut[];
}

const GROUPS: Group[] = [
  {
    title: 'Playback',
    shortcuts: [
      { keys: ['Space'], label: 'Play / pause' },
      { keys: ['J'], label: 'Shuttle backward (tap again to speed up)' },
      { keys: ['K'], label: 'Stop shuttling' },
      { keys: ['L'], label: 'Shuttle forward (tap again to speed up)' },
      { keys: ['←'], label: 'Step back one frame' },
      { keys: ['→'], label: 'Step forward one frame' },
      { keys: ['⌥', '←/→'], label: 'Jump to the previous / next marker' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['⌘/Ctrl', 'Z'], label: 'Undo' },
      { keys: ['⇧', '⌘/Ctrl', 'Z'], label: 'Redo' },
      { keys: ['⌘/Ctrl', 'D'], label: 'Duplicate the selected layer (or clip)' },
      { keys: ['Delete'], label: 'Delete the selected layer' },
      { keys: ['S'], label: 'Split the clip under the playhead' },
      { keys: ['M'], label: 'Drop a marker at the playhead' },
    ],
  },
  {
    title: 'Clips',
    shortcuts: [
      { keys: ['⌘/Ctrl', 'C'], label: 'Copy the selected clip' },
      { keys: ['⌘/Ctrl', 'V'], label: 'Paste the copied clip after the selection' },
    ],
  },
  {
    title: 'Selected layer',
    shortcuts: [
      { keys: ['←/→/↑/↓'], label: 'Nudge the selected layer on the canvas' },
      { keys: ['⇧', '←/→/↑/↓'], label: 'Nudge in bigger steps' },
    ],
  },
  {
    title: 'Captions',
    shortcuts: [{ keys: ['⌘/Ctrl', 'F'], label: 'Find & replace caption text' }],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['Esc'], label: 'Close a menu / dialog, exit crop, or exit full screen' },
      { keys: ['/'], label: 'Open this shortcuts panel' },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.6em] px-1.5 py-0.5 rounded-md border border-[var(--color-glass-border)] bg-[var(--color-bg-elevated)] text-[11px] font-mono font-medium leading-none">
      {children}
    </kbd>
  );
}

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative glass-card p-5 w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <span aria-hidden>⌨️</span>
            <span>Keyboard shortcuts</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto -mx-1 px-1 space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">{g.title}</div>
              <div className="space-y-1">
                {g.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm py-0.5">
                    <span className="text-[var(--color-text-secondary)]">{s.label}</span>
                    <span className="inline-flex items-center gap-1 shrink-0">
                      {s.keys.map((k, j) => (
                        <span key={j} className="inline-flex items-center gap-1">
                          <Kbd>{k}</Kbd>
                          {j < s.keys.length - 1 && <span className="text-[var(--color-text-muted)] text-[10px]">+</span>}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 pt-3 border-t border-[var(--color-glass-border)] text-[11px] text-[var(--color-text-muted)]">
          Shortcuts are suppressed while typing in a text field.
        </p>
      </div>
    </div>
  );
}
