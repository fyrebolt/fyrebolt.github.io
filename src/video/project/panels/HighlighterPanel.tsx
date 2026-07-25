// ===== Highlighter layer property panel =====
// Ported from the classic HighlighterTool controls. Placement is on-canvas (the
// HighlightRectEditor); this panel owns colour / opacity / size / sweep timing.

import { Field, Slider } from '../ui';
import type { HighlighterLayer } from '../types';

const round2 = (n: number) => Math.round(n * 100) / 100;

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

      <Field label={`Duration — ${round2(h.duration)}s`}>
        <input
          type="number"
          min={0.2}
          max={Math.max(0.2, duration || 60)}
          step={0.1}
          value={round2(h.duration)}
          onChange={(e) => {
            const d = Math.max(0.2, Number(e.target.value) || 0.2);
            onEdit({
              duration: d,
              sweepIn: Math.min(h.sweepIn, d),
              sweepOut: Math.min(h.sweepOut, Math.max(0, d - Math.min(h.sweepIn, d))),
            });
          }}
          className="input"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Sweep in — ${round2(h.sweepIn)}s`}>
          <input
            type="number"
            min={0}
            max={round2(h.duration - h.sweepOut)}
            step={0.05}
            value={round2(h.sweepIn)}
            onChange={(e) => onEdit({ sweepIn: Math.max(0, Math.min(h.duration - h.sweepOut, Number(e.target.value) || 0)) })}
            className="input"
          />
        </Field>
        <Field label={`Sweep out — ${round2(h.sweepOut)}s`}>
          <input
            type="number"
            min={0}
            max={round2(h.duration - h.sweepIn)}
            step={0.05}
            value={round2(h.sweepOut)}
            onChange={(e) => onEdit({ sweepOut: Math.max(0, Math.min(h.duration - h.sweepIn, Number(e.target.value) || 0)) })}
            className="input"
          />
        </Field>
      </div>
      <div className="text-[10px] text-[var(--color-text-muted)]">
        Hold {round2(hold)}s. Sweeps ease in/out; scrub the timeline to preview the wipe.
      </div>

      <button
        onClick={onRemove}
        className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
      >
        Remove highlighter
      </button>
    </>
  );
}
