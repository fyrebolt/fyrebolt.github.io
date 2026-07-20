// ===== Time Machine layer property panel (add speed keyframes + edit selected) =====
// Mirrors ZoomPanel: presets add a keyframe, then each keyframe's start / ramp /
// target speed are editable. A freeze is a speed-0 keyframe.

import { Field } from '../ui';
import type { SpeedKeyframe } from '../../timemachine/types';
import { FREEZE_EPS, MAX_SPEED, sortedSpeeds } from '../../timemachine/types';
import type { TimeMachineLayer } from '../types';

/** Human label for a target speed (e.g. "0.5× slow-mo", "Freeze", "2× fast"). */
function speedLabel(speed: number): string {
  if (speed <= FREEZE_EPS) return 'Freeze';
  if (Math.abs(speed - 1) < 0.02) return '1× normal';
  return `${(Math.round(speed * 100) / 100).toString()}× ${speed < 1 ? 'slow-mo' : 'fast'}`;
}

interface Props {
  layer: TimeMachineLayer;
  duration: number;
  selectedKfId: string | null;
  /** Add a single ramp-to-`speed` keyframe (0 = a plain freeze). */
  onAddKeyframe: (speed: number) => void;
  /** Add a freeze block: a snap to speed 0 plus a resume-to-1× keyframe after it. */
  onAddFreeze: () => void;
  onSelectKf: (kfId: string) => void;
  onEditKf: (kfId: string, patch: Partial<SpeedKeyframe>) => void;
  onRemoveKf: (kfId: string) => void;
  onRemoveLayer: () => void;
}

export default function TimeMachinePanel({
  layer,
  duration,
  selectedKfId,
  onAddKeyframe,
  onAddFreeze,
  onSelectKf,
  onEditKf,
  onRemoveKf,
  onRemoveLayer,
}: Props) {
  const sorted = sortedSpeeds(layer.keyframes);
  const selected = layer.keyframes.find((k) => k.id === selectedKfId) ?? null;

  return (
    <>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Add a speed change; playback ramps from the previous speed and holds until the next keyframe. A freeze pauses on the
        current frame. The exported MP4 reflects the variable speed.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onAddKeyframe(0.4)} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
          + Slow-mo
        </button>
        <button onClick={() => onAddKeyframe(2)} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
          + Speed up
        </button>
        <button onClick={onAddFreeze} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
          + Freeze
        </button>
        <button onClick={() => onAddKeyframe(1)} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
          + Back to 1×
        </button>
      </div>

      {sorted.length > 0 && (
        <Field label="Keyframes">
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((kf, i) => (
              <button
                key={kf.id}
                onClick={() => onSelectKf(kf.id)}
                className={`px-2 py-1 rounded-md text-[11px] border ${
                  kf.id === selectedKfId ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                }`}
              >
                {kf.speed <= FREEZE_EPS ? '⏸' : '⏱'}{i + 1} · {kf.start.toFixed(1)}s · {speedLabel(kf.speed)}
              </button>
            ))}
          </div>
        </Field>
      )}

      {selected && (
        <div className="pt-3 border-t border-[var(--color-glass-border)] space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Start — ${(Math.round(selected.start * 100) / 100).toFixed(2)}s`}>
              <input
                type="number"
                min={0}
                max={Math.max(0, duration)}
                step={0.1}
                value={Math.round(selected.start * 100) / 100}
                onChange={(e) => onEditKf(selected.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                className="input"
              />
            </Field>
            <Field label={`Ramp — ${(Math.round(selected.duration * 100) / 100).toFixed(2)}s`}>
              <input
                type="number"
                min={0}
                max={Math.max(0, duration)}
                step={0.1}
                value={Math.round(selected.duration * 100) / 100}
                onChange={(e) => onEditKf(selected.id, { duration: Math.max(0, Number(e.target.value) || 0) })}
                className="input"
              />
            </Field>
          </div>

          <Field label={`Target speed — ${speedLabel(selected.speed)}`}>
            <input
              type="range"
              min={0}
              max={MAX_SPEED}
              step={0.05}
              value={selected.speed}
              onChange={(e) => onEditKf(selected.id, { speed: Number(e.target.value) })}
              className="w-full accent-[var(--color-primary-green)]"
            />
            <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-0.5">
              <span>freeze</span>
              <span>1×</span>
              <span>{MAX_SPEED}×</span>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onEditKf(selected.id, { speed: 0 })} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              Freeze (0×)
            </button>
            <button onClick={() => onEditKf(selected.id, { speed: 1 })} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              Normal (1×)
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={selected.whoosh} onChange={(e) => onEditKf(selected.id, { whoosh: e.target.checked })} />
            Whoosh at this transition
          </label>

          <button onClick={() => onRemoveKf(selected.id)} className="w-full px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]">
            Remove keyframe
          </button>
        </div>
      )}

      <button onClick={onRemoveLayer} className="w-full mt-1 px-3 py-2 rounded-md border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-glass-hover)]">
        Remove Time Machine track
      </button>
    </>
  );
}
