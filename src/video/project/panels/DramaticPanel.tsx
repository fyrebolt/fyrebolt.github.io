// ===== Dramatic word layer property panel =====
// Ported from the classic DramaticWordingTool controls: text, effect mode
// (normal / inverse / reflection), colour, opacity, size, and timing. Position
// is set by dragging the word on the preview (caption-style). Words never
// overlap in time — the timeline drag clamps to neighbours.

import { Field } from '../ui';
import type { WordMode } from '../../dramatic/types';
import type { DramaticLayer } from '../types';

const round2 = (n: number) => Math.round(n * 100) / 100;

const MODES: [WordMode, string][] = [
  ['normal', 'Word'],
  ['inverse', 'Inverse'],
  ['reflection', 'Reflection'],
];

interface Props {
  layer: DramaticLayer;
  duration: number;
  onEdit: (patch: Partial<DramaticLayer['el']>) => void;
  onRemove: () => void;
}

export default function DramaticPanel({ layer, duration, onEdit, onRemove }: Props) {
  const w = layer.el;

  return (
    <>
      <Field label="Text">
        <input value={w.text} onChange={(e) => onEdit({ text: e.target.value })} className="input" placeholder="WORD" />
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Shown in ALL CAPS.</p>
      </Field>

      <Field label="Effect">
        <div className="grid grid-cols-3 gap-1.5">
          {MODES.map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => onEdit({ mode: v, color: v === 'inverse' ? '#000000' : '#dcdcdc' })}
              className={`px-2 py-2 rounded-md text-[11px] border ${
                w.mode === v ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
          {w.mode === 'inverse'
            ? 'Dims everything except the word (a clear window).'
            : w.mode === 'reflection'
              ? 'Colour-inverts the footage under the word (a negative/electronic look).'
              : 'Translucent word over the video.'}
        </p>
      </Field>

      <div className={w.mode === 'reflection' ? '' : 'grid grid-cols-2 gap-3'}>
        {w.mode !== 'reflection' && (
          <Field label={w.mode === 'inverse' ? 'Dim color' : 'Word color'}>
            <input
              type="color"
              value={w.color}
              onChange={(e) => onEdit({ color: e.target.value })}
              className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
            />
          </Field>
        )}
        <Field
          label={`${w.mode === 'inverse' ? 'Dim' : w.mode === 'reflection' ? 'Inversion strength' : 'Word'} ${
            w.mode === 'reflection' ? '' : 'opacity '
          }— ${Math.round(w.opacity * 100)}%`}
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={w.opacity}
            onChange={(e) => onEdit({ opacity: Number(e.target.value) })}
            className="w-full accent-[var(--color-primary-green)]"
          />
        </Field>
      </div>

      <Field label={`Size — ${w.sizeScale.toFixed(1)}×`}>
        <input
          type="range"
          min={0.4}
          max={2.5}
          step={0.1}
          value={w.sizeScale}
          onChange={(e) => onEdit({ sizeScale: Number(e.target.value) })}
          className="w-full accent-[var(--color-primary-green)]"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Start — ${round2(w.start)}s`}>
          <input
            type="number"
            min={0}
            max={Math.max(0, duration)}
            step={0.1}
            value={round2(w.start)}
            onChange={(e) => onEdit({ start: Math.max(0, Number(e.target.value) || 0) })}
            className="input"
          />
        </Field>
        <Field label={`Hold — ${round2(w.duration)}s`}>
          <input
            type="number"
            min={0.2}
            max={Math.max(0.2, duration)}
            step={0.1}
            value={round2(w.duration)}
            onChange={(e) => onEdit({ duration: Math.max(0.2, Number(e.target.value) || 0.2) })}
            className="input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Fade in — ${round2(w.fadeIn)}s`}>
          <input
            type="number"
            min={0}
            max={Math.max(0, w.duration)}
            step={0.05}
            value={round2(w.fadeIn)}
            onChange={(e) => onEdit({ fadeIn: Math.max(0, Math.min(w.duration, Number(e.target.value) || 0)) })}
            className="input"
          />
        </Field>
        <Field label={`Fade out — ${round2(w.fadeOut)}s`}>
          <input
            type="number"
            min={0}
            max={Math.max(0, w.duration)}
            step={0.05}
            value={round2(w.fadeOut)}
            onChange={(e) => onEdit({ fadeOut: Math.max(0, Math.min(w.duration, Number(e.target.value) || 0)) })}
            className="input"
          />
        </Field>
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)]">Drag the word on the preview to move it (snaps to centre / thirds). Words never overlap in time.</p>

      <button
        onClick={onRemove}
        className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
      >
        Remove word
      </button>
    </>
  );
}
