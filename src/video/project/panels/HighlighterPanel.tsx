// ===== Highlighter layer property panel =====
// Ported from the classic HighlighterTool controls. Placement is on-canvas (the
// HighlightRectEditor); this panel owns colour / opacity / size / sweep timing.

import { DangerButton, Field, NumberField, Slider } from '../ui';
import { round2 } from '../constants';
import type { HighlighterLayer } from '../types';

interface Props {
  layer: HighlighterLayer;
  duration: number;
  onEdit: (patch: Partial<HighlighterLayer['el']>) => void;
  onRemove: () => void;
}

export default function HighlighterPanel({ layer, duration, onEdit, onRemove }: Props) {
  const h = layer.el;
  const hold = Math.max(0, h.duration - h.sweepIn - h.sweepOut);

  return (
    <>
      <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">
        Drag the box on the preview to move it; drag its handles to set length &amp; height.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Color">
          <input
            type="color"
            value={h.color}
            onChange={(e) => onEdit({ color: e.target.value })}
            className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
          />
        </Field>
        <Slider
          label={`Opacity — ${Math.round(h.opacity * 100)}%`}
          min={0.05}
          max={1}
          step={0.05}
          value={h.opacity}
          onChange={(v) => onEdit({ opacity: v })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Slider
          label={`Width — ${Math.round(h.w * 100)}%`}
          min={0.02}
          max={1}
          step={0.01}
          value={h.w}
          onChange={(v) => onEdit({ w: Math.min(v, 1 - h.x) })}
        />
        <Slider
          label={`Height — ${Math.round(h.h * 100)}%`}
          min={0.02}
          max={1}
          step={0.01}
          value={h.h}
          onChange={(v) => onEdit({ h: Math.min(v, 1 - h.y) })}
        />
      </div>

      <NumberField
        label={`Duration — ${round2(h.duration)}s`}
        min={0.2}
        max={Math.max(0.2, duration || 60)}
        step={0.1}
        value={round2(h.duration)}
        onChange={(v) =>
          onEdit({
            duration: v,
            sweepIn: Math.min(h.sweepIn, v),
            sweepOut: Math.min(h.sweepOut, Math.max(0, v - Math.min(h.sweepIn, v))),
          })
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={`Sweep in — ${round2(h.sweepIn)}s`}
          min={0}
          max={round2(h.duration - h.sweepOut)}
          step={0.05}
          value={round2(h.sweepIn)}
          onChange={(v) => onEdit({ sweepIn: v })}
        />
        <NumberField
          label={`Sweep out — ${round2(h.sweepOut)}s`}
          min={0}
          max={round2(h.duration - h.sweepIn)}
          step={0.05}
          value={round2(h.sweepOut)}
          onChange={(v) => onEdit({ sweepOut: v })}
        />
      </div>
      <div className="text-[10px] text-[var(--color-text-muted)]">
        Hold {round2(hold)}s. Sweeps ease in/out; scrub the timeline to preview the wipe.
      </div>

      <DangerButton onClick={onRemove} className="mt-1">Remove highlighter</DangerButton>
    </>
  );
}
