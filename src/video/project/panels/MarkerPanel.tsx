// ===== Markers panel: the list view of the timeline's marker pins =====
//
// The pins on the timeline are for placing and eyeballing; this panel is for
// naming, recolouring, and jumping. Both edit the same Project.markers array.

import type { Marker } from '../markers';
import { MARKER_COLORS, MARKER_LABEL_MAX, sortedMarkers } from '../markers';
import { NumberInput } from '../ui';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

interface Props {
  markers: Marker[];
  /** Output length — caps how far a marker's time field can be typed. */
  duration: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** `discrete` seals the change as its own undo entry (all edits here are). */
  onEdit: (id: string, patch: Partial<Marker>, discrete?: boolean) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

export default function MarkerPanel({ markers, duration, selectedId, onSelect, onEdit, onRemove, onAdd }: Props) {
  const list = sortedMarkers(markers);

  return (
    <>
      <button
        onClick={onAdd}
        className="w-full px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-xs font-medium"
      >
        ＋ Marker at playhead <span className="text-[var(--color-text-muted)]">(M)</span>
      </button>

      {list.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          No markers yet. Drop one with M, or double-click the marker lane above the clips. Layer edges snap to
          markers, and ⌥←/⌥→ jumps the playhead between them.
        </p>
      ) : (
        <div className="space-y-1.5">
          {list.map((m) => {
            const sel = m.id === selectedId;
            return (
              <div
                key={m.id}
                className={`rounded-md border p-2 space-y-1.5 ${
                  sel ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onSelect(m.id)}
                    title="Jump the playhead here"
                    className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/30"
                    style={{ background: m.color }}
                    aria-label={`Jump to ${m.label || 'marker'}`}
                  />
                  <input
                    value={m.label}
                    maxLength={MARKER_LABEL_MAX}
                    placeholder="Label"
                    onChange={(e) => onEdit(m.id, { label: e.target.value }, true)}
                    className="flex-1 min-w-0 px-2 py-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-glass-border)] text-xs"
                  />
                  <button
                    onClick={() => onRemove(m.id)}
                    title="Remove this marker"
                    aria-label={`Remove ${m.label || 'marker'}`}
                    className="px-1.5 text-[rgba(255,120,120,0.9)] hover:text-[rgba(255,80,80,1)] text-sm leading-none"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)] w-12">{fmt(m.t)}</span>
                  <NumberInput
                    min={0}
                    max={Math.max(0, duration)}
                    step={0.01}
                    value={Number(m.t.toFixed(2))}
                    onChange={(v) => onEdit(m.id, { t: v }, true)}
                    className="w-20 px-2 py-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-glass-border)] text-xs text-right tabular-nums"
                  />
                  <span className="text-[10px] text-[var(--color-text-muted)]">s</span>
                  <div className="ml-auto flex gap-1">
                    {MARKER_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => onEdit(m.id, { color: c }, true)}
                        title={`Colour ${c}`}
                        aria-label={`Set colour ${c}`}
                        className={`w-3.5 h-3.5 rounded-full border ${
                          m.color === c ? 'border-[var(--color-text-primary)]' : 'border-transparent'
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
