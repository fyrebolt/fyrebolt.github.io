// ===== Asset-library browser (choose from library, or upload new) =====
//
// A modal shown when adding a clip / sticker / music track. It lists previously
// uploaded assets (thumbnail + name) compatible with the current insertion
// intent, alongside an "Upload new" action. Picking an entry copies it into the
// current project (handled by the caller); renaming / deleting only affects the
// library's future availability — copies already placed in a project are never
// touched (their bytes were copied on insert).

import { useEffect, useRef, useState } from 'react';
import type { LibraryEntry } from './persist';

interface Props {
  title: string;
  /** Entries already filtered to the media kinds valid for this intent. */
  entries: LibraryEntry[];
  emptyHint: string;
  onClose: () => void;
  onUploadNew: () => void;
  onPick: (entry: LibraryEntry) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function LibraryBrowser({
  title,
  entries,
  emptyHint,
  onClose,
  onUploadNew,
  onPick,
  onRename,
  onDelete,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // Escape closes the browser (unless mid-rename, where it cancels the rename).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (renamingId) setRenamingId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, renamingId]);

  useEffect(() => {
    if (renamingId) renameRef.current?.select();
  }, [renamingId]);

  const startRename = (entry: LibraryEntry) => {
    setConfirmDeleteId(null);
    setRenameText(entry.name);
    setRenamingId(entry.id);
  };
  const commitRename = () => {
    if (renamingId) {
      const name = renameText.trim();
      if (name) onRename(renamingId, name);
    }
    setRenamingId(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative glass-card p-5 w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <span aria-hidden>📚</span>
            <span>{title}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        <button
          onClick={onUploadNew}
          className="mb-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary-green)] text-black font-semibold text-sm hover:opacity-90"
        >
          <span aria-hidden>⬆</span> Upload new file
        </button>

        <div className="text-[11px] font-medium text-[var(--color-text-muted)] mb-2">
          {entries.length > 0 ? 'Or reuse from your library' : 'Your library'}
        </div>

        <div className="overflow-y-auto -mx-1 px-1">
          {entries.length === 0 ? (
            <p className="text-xs text-[var(--color-text-secondary)] py-6 text-center">{emptyHint}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {entries.map((e) => {
                const isRenaming = renamingId === e.id;
                const isConfirming = confirmDeleteId === e.id;
                return (
                  <div
                    key={e.id}
                    className="group relative rounded-lg border border-[var(--color-glass-border)] overflow-hidden bg-[var(--color-bg-elevated)]"
                  >
                    <button
                      onClick={() => onPick(e)}
                      title="Add to this project"
                      className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-green)]"
                    >
                      <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
                        {e.thumb ? (
                          <img src={e.thumb} alt={e.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-2xl" aria-hidden>
                            {e.media === 'audio' ? '🎵' : e.media === 'video' ? '🎬' : '🖼️'}
                          </span>
                        )}
                      </div>
                    </button>

                    <div className="px-2 py-1.5">
                      {isRenaming ? (
                        <input
                          ref={renameRef}
                          value={renameText}
                          onChange={(ev) => setRenameText(ev.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') {
                              ev.preventDefault();
                              commitRename();
                            }
                          }}
                          className="w-full px-1.5 py-1 rounded bg-[var(--color-bg-surface)] border border-[var(--color-glass-border)] text-xs"
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="truncate text-xs flex-1" title={e.name}>
                            {e.name}
                          </span>
                          <button
                            onClick={() => startRename(e)}
                            title="Rename"
                            aria-label="Rename"
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-0.5 text-[11px]"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(isConfirming ? null : e.id)}
                            title="Delete from library"
                            aria-label="Delete from library"
                            className="text-[var(--color-text-muted)] hover:text-[rgba(255,90,90,1)] px-0.5 text-[11px]"
                          >
                            🗑
                          </button>
                        </div>
                      )}
                    </div>

                    {isConfirming && !isRenaming && (
                      <div className="px-2 pb-2">
                        <div className="text-[10px] text-[var(--color-text-secondary)] mb-1">
                          Remove from library? Projects already using it keep their copy.
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              onDelete(e.id);
                              setConfirmDeleteId(null);
                            }}
                            className="flex-1 px-2 py-1 rounded bg-[rgba(255,80,80,0.92)] text-white text-[11px] font-semibold"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="flex-1 px-2 py-1 rounded bg-[var(--color-bg-surface)] text-[11px]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
