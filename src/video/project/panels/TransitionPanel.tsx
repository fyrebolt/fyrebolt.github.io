// ===== Clip-boundary transition panel =====
// Edits the transition entering the selected boundary (see project/transitions.ts).
// The boundary itself is picked on the clip strip; the duration is editable here
// and by dragging the chip sideways, mirroring the zoom track's duration handle.

import { ChoiceGrid, Field, NumberInput, Toggle } from '../ui';
import type { VideoClip } from '../clips';
import type { Transition, TransitionDir, TransitionKind } from '../transitions';
import {
  DIR_OPTIONS,
  MIN_TRANSITION_DUR,
  TRANSITION_OPTIONS,
  defaultFor,
  labelOf,
  maxDurationAt,
  transitionAt,
} from '../transitions';

interface Props {
  clips: VideoClip[];
  /** Boundary index == the index of the INCOMING clip. */
  index: number;
  onEdit: (index: number, tr: Transition, discrete: boolean) => void;
  onRandomizeAll: () => void;
}

export default function TransitionPanel({ clips, index, onEdit, onRandomizeAll }: Props) {
  if (index <= 0 || index >= clips.length) return null;
  const tr = transitionAt(clips, index);
  const maxDur = maxDurationAt(clips, index);
  const from = clips[index - 1];
  const to = clips[index];
  const sameSource = from.srcId === to.srcId;

  const setKind = (kind: TransitionKind): void => {
    if (kind === tr.kind) return;
    onEdit(index, kind === 'cut' ? { kind: 'cut', duration: 0 } : defaultFor(kind, clips, index), true);
  };
  const patch = (p: Partial<Transition>, discrete: boolean): void => onEdit(index, { ...tr, ...p }, discrete);

  return (
    <>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Boundary {index} — <span className="text-[var(--color-text-secondary)]">{from.name}</span> →{' '}
        <span className="text-[var(--color-text-secondary)]">{to.name}</span>. The window straddles the cut, so the
        timeline length never changes.
      </p>

      <Field label="Type">
        <ChoiceGrid
          cols={2}
          value={tr.kind}
          options={TRANSITION_OPTIONS.map((o) => ({ key: o.kind, label: `${o.glyph} ${o.label}`, hint: o.hint }))}
          onChange={setKind}
        />
      </Field>

      {tr.kind !== 'cut' && (
        <>
          <Field label={`Duration — ${tr.duration.toFixed(2)}s`}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={MIN_TRANSITION_DUR}
                max={maxDur}
                step={0.01}
                value={Math.min(maxDur, tr.duration)}
                onChange={(e) => patch({ duration: Number(e.target.value) }, false)}
                className="flex-1 accent-[var(--color-primary-green)]"
              />
              <NumberInput
                min={MIN_TRANSITION_DUR}
                max={maxDur}
                step={0.01}
                value={Number(tr.duration.toFixed(2))}
                onChange={(v) => patch({ duration: v }, false)}
                className="w-20 px-2 py-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-glass-border)] text-xs"
              />
            </div>
            <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
              Up to {maxDur.toFixed(1)}s here — a window may never take more than half of either clip. Each side plays
              the frames its trim discarded, holding a freeze-frame if the trim sits at the end of the media.
            </div>
          </Field>

          {(tr.kind === 'wipe' || tr.kind === 'push') && (
            <Field label="Direction">
              <ChoiceGrid
                cols={4}
                value={tr.dir ?? 'left'}
                options={DIR_OPTIONS.map((d) => ({ key: d.key as TransitionDir, label: d.label }))}
                onChange={(v) => patch({ dir: v }, true)}
              />
            </Field>
          )}

          {tr.kind === 'iris' && (
            <Field label="Iris">
              <ChoiceGrid
                cols={2}
                value={tr.iris ?? 'in'}
                options={[
                  { key: 'in' as const, label: 'Open', hint: 'Circle expands' },
                  { key: 'out' as const, label: 'Close', hint: 'Circle contracts' },
                ]}
                onChange={(v) => patch({ iris: v }, true)}
              />
            </Field>
          )}

          {tr.kind === 'flash' && (
            <Field label="Flash colour">
              <ChoiceGrid
                cols={2}
                value={tr.flash ?? 'white'}
                options={[
                  { key: 'white' as const, label: 'White' },
                  { key: 'black' as const, label: 'Black' },
                ]}
                onChange={(v) => patch({ flash: v }, true)}
              />
            </Field>
          )}

          <Toggle
            label="Sound at the cut"
            hint={
              tr.kind === 'glitch' || tr.kind === 'flash'
                ? 'Synthesized digital stutter — no audio file.'
                : 'Synthesized whoosh — no audio file.'
            }
            checked={tr.sfx === true}
            onChange={(v) => patch({ sfx: v }, true)}
          />

          {sameSource && (
            <p className="text-[10px] text-[var(--color-text-muted)] leading-snug">
              Both sides of this boundary come from the same source file (a razor split or a duplicate), so one media
              element can't play both at once: the outgoing side holds a freeze-frame and the audio ducks through the
              splice instead of crossfading. {labelOf(tr.kind)} still animates normally.
            </p>
          )}
        </>
      )}

      <button
        onClick={onRandomizeAll}
        className="w-full px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium"
      >
        🎲 Randomize every boundary
      </button>
    </>
  );
}
