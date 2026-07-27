// ===== Time Machine panel: presets for the free-form speed curve =====
//
// The curve itself is edited directly in the timeline lane (SpeedCurveRow) — the
// same free-form model as the clip volume curve. This side panel just adds
// convenience: presets that drop a localised speed region at the playhead, a
// fine slider for the selected point, a whoosh toggle, and clear / remove.

import { DangerButton, Field } from '../ui';
import { round2 } from '../constants';
import { FREEZE_EPS, MAX_SPEED, sortedSpeeds } from '../../timemachine/types';
import type { TimeMachineLayer } from '../types';

function speedLabel(speed: number): string {
  if (speed <= FREEZE_EPS) return 'Freeze';
  if (Math.abs(speed - 1) < 0.02) return '1× normal';
  return `${round2(speed).toString()}× ${speed < 1 ? 'slow-mo' : 'fast'}`;
}

interface Props {
  layer: TimeMachineLayer;
  selectedIdx: number | null;
  /** Drop a localised region (leading 1× → held `speed` → trailing 1×) at the playhead. */
  onAddRegion: (speed: number) => void;
  /** Set the selected point's speed (fine slider). */
  onSetPointSpeed: (idx: number, speed: number) => void;
  onRemovePoint: (idx: number) => void;
  onClear: () => void;
  onEditLayer: (patch: Partial<TimeMachineLayer>) => void;
  onRemoveLayer: () => void;
}

export default function TimeMachinePanel({
  layer,
  selectedIdx,
  onAddRegion,
  onSetPointSpeed,
  onRemovePoint,
  onClear,
  onEditLayer,
  onRemoveLayer,
}: Props) {
  const points = layer.points;
  const selected = selectedIdx !== null && selectedIdx < points.length ? points[selectedIdx] : null;
  const sorted = sortedSpeeds(points);

  return (
    <>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Draw a free-form speed curve right on the timeline lane: click to add a point, drag to set its speed (up/down) and
        time (left/right). Speed ramps linearly between points and holds flat outside them — no points means normal speed. A
        flat run at 0× is a freeze. The exported MP4 reflects the variable speed.
      </p>

      <Field label="Add a region at the playhead">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onAddRegion(0.4)} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
            + Slow-mo
          </button>
          <button onClick={() => onAddRegion(2)} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
            + Speed up
          </button>
          <button onClick={() => onAddRegion(0)} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
            + Freeze
          </button>
          <button onClick={() => onAddRegion(1)} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
            + Back to 1×
          </button>
        </div>
      </Field>

      {selected && (
        <div className="pt-3 border-t border-[var(--color-glass-border)] space-y-2">
          <Field label={`Selected point @ ${selected.t.toFixed(2)}s — ${speedLabel(selected.speed)}`}>
            <input
              type="range"
              min={0}
              max={MAX_SPEED}
              step={0.05}
              value={selected.speed}
              onChange={(e) => onSetPointSpeed(selectedIdx!, Number(e.target.value))}
              className="w-full accent-[var(--color-primary-green)]"
            />
            <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-0.5">
              <span>freeze</span>
              <span>1×</span>
              <span>{MAX_SPEED}×</span>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onSetPointSpeed(selectedIdx!, 0)} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              Freeze (0×)
            </button>
            <button onClick={() => onSetPointSpeed(selectedIdx!, 1)} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              Normal (1×)
            </button>
          </div>
          <DangerButton onClick={() => onRemovePoint(selectedIdx!)}>Remove point</DangerButton>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        <input type="checkbox" checked={layer.whoosh} onChange={(e) => onEditLayer({ whoosh: e.target.checked })} />
        Whoosh at each slow-mo / replay onset
      </label>

      {sorted.length > 0 && (
        <button onClick={onClear} className="w-full px-3 py-2 rounded-md border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-glass-hover)]">
          Clear curve ({sorted.length} point{sorted.length === 1 ? '' : 's'})
        </button>
      )}

      <button onClick={onRemoveLayer} className="w-full mt-1 px-3 py-2 rounded-md border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-glass-hover)]">
        Remove Time Machine track
      </button>
    </>
  );
}
