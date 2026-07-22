// ===== Find & Replace panel (caption / typewriter text, current project) =====
//
// A floating panel opened with Cmd/Ctrl+F. It searches across every caption and
// typewriter element's text, navigates matches (next / prev), reveals the
// matched caption in context (the editor selects it + seeks to it), and replaces
// one or all. Replace-all is a single undo step — handled by the editor, which
// owns the mutations; this panel only computes matches and calls back.

import { useEffect, useMemo, useRef, useState } from 'react';
import { findCaptionMatches } from './search';
import type { CaptionText } from './search';

interface Props {
  /** Every caption/typewriter element's live text, in navigation order. */
  captions: CaptionText[];
  /** Select + scroll/seek to a caption so the match is visible in context. */
  onReveal: (layerId: string) => void;
  /** Replace the single occurrence at `at` in one caption (one undo step). */
  onReplaceOne: (layerId: string, at: number, search: string, replacement: string, caseSensitive: boolean) => void;
  /** Replace every occurrence across all captions in ONE undo step; returns count. */
  onReplaceAll: (search: string, replacement: string, caseSensitive: boolean) => number;
  onClose: () => void;
}

export default function FindReplace({ captions, onReveal, onReplaceOne, onReplaceAll, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => findCaptionMatches(captions, search, caseSensitive),
    [captions, search, caseSensitive],
  );

  // Focus the search field on open.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Keep the active index in range as matches change (typing, replacing, edits).
  useEffect(() => {
    setActive((a) => (matches.length === 0 ? 0 : Math.min(a, matches.length - 1)));
  }, [matches.length]);

  // Reveal the current match's caption whenever it changes (so the selection +
  // playhead follow the match you're on).
  const cur = matches.length > 0 ? matches[Math.min(active, matches.length - 1)] : null;
  const curKey = cur ? `${cur.layerId}:${cur.at}` : '';
  useEffect(() => {
    if (cur) onReveal(cur.layerId);
    // Reveal is keyed on the concrete match; onReveal is stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  // Esc closes the panel (capture, so it wins over full-screen's Esc handler).
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

  const go = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    setNote('');
    setActive((a) => (a + dir + matches.length) % matches.length);
  };

  const doReplaceOne = () => {
    if (!cur || !search) return;
    setNote('');
    onReplaceOne(cur.layerId, cur.at, search, replacement, caseSensitive);
    // Matches refresh via the captions prop; advance to the next one.
    setActive((a) => a); // clamp effect handles range; stay on the same slot
  };

  const doReplaceAll = () => {
    if (!search) return;
    const n = onReplaceAll(search, replacement, caseSensitive);
    setNote(n > 0 ? `Replaced ${n} occurrence${n === 1 ? '' : 's'}.` : 'No matches to replace.');
  };

  const total = matches.length;
  const position = total > 0 ? Math.min(active, total - 1) + 1 : 0;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[65] w-[min(92vw,420px)]">
      <div className="glass-card p-3 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] flex items-center gap-1.5">
            <span aria-hidden>🔎</span> Find &amp; replace
          </div>
          <button
            onClick={onClose}
            aria-label="Close find and replace"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-base leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* Find row */}
        <div className="flex items-center gap-2 mb-2">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Find in captions"
            className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-glass-border)] text-sm"
          />
          <span className="text-[11px] tabular-nums text-[var(--color-text-muted)] w-14 text-center">
            {search ? `${position}/${total}` : '—'}
          </span>
          <button
            onClick={() => go(-1)}
            disabled={total === 0}
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            className="px-2 py-1.5 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm"
          >
            ↑
          </button>
          <button
            onClick={() => go(1)}
            disabled={total === 0}
            title="Next match (Enter)"
            aria-label="Next match"
            className="px-2 py-1.5 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm"
          >
            ↓
          </button>
        </div>

        {/* Replace row */}
        <div className="flex items-center gap-2 mb-2">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="Replace with"
            className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-glass-border)] text-sm"
          />
          <button
            onClick={doReplaceOne}
            disabled={total === 0}
            className="px-2.5 py-1.5 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-xs font-medium whitespace-nowrap"
          >
            Replace
          </button>
          <button
            onClick={doReplaceAll}
            disabled={total === 0}
            className="px-2.5 py-1.5 rounded-md bg-[var(--color-primary-green)] text-black disabled:opacity-40 text-xs font-semibold whitespace-nowrap"
          >
            All
          </button>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="accent-[var(--color-primary-green)]"
            />
            Match case
          </label>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {note || (search && total === 0 ? 'No matches' : '')}
          </span>
        </div>
      </div>
    </div>
  );
}
