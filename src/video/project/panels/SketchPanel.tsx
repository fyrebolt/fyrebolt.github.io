// ===== Sketch layer property panel (draw + pen + replay timing) =====
// Ported from the classic SketchTool controls. In the layer editor the sketch
// layer IS the drawing: the pad stays editable (draw / undo / clear strokes),
// placement happens via the on-canvas SketchRectEditor, and timing lives here.

import { DangerButton, Field, NumberField, Slider } from '../ui';
import { round2 } from '../constants';
import SketchPad from '../../sketch/SketchPad';
import type { SketchStroke } from '../../sketch/types';
import type { SketchLayer } from '../types';

export interface Pen {
  color: string;
  width: number;
  smoothness: number;
}

interface Props {
  layer: SketchLayer;
  pen: Pen;
  onPen: (patch: Partial<Pen>) => void;
  onCommitStroke: (s: SketchStroke) => void;
  onUndoStroke: () => void;
  onClearStrokes: () => void;
  onEdit: (patch: Partial<SketchLayer['el']>) => void;
  onRemove: () => void;
}

export default function SketchPanel({
  layer,
  pen,
  onPen,
  onCommitStroke,
  onUndoStroke,
  onClearStrokes,
  onEdit,
  onRemove,
}: Props) {
  const el = layer.el;
  const animDur = round2(el.animationDur);
  const freezeDur = round2(el.freezeDur);
  const hasStrokes = el.strokes.length > 0;

  return (
    <>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Draw on the pad below. Drag the box on the preview to place / resize the drawing; edit its timing here or on the timeline.
      </p>

      <SketchPad
        strokes={el.strokes}
        padAspect={el.padAspect}
        editable
        pen={pen}
        onCommitStroke={onCommitStroke}
        animationDur={el.animationDur}
        tracer={el.tracer}
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onUndoStroke}
          disabled={!hasStrokes}
          className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)] disabled:opacity-40"
        >
          Undo stroke
        </button>
        <button
          onClick={onClearStrokes}
          disabled={!hasStrokes}
          className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)] disabled:opacity-40"
        >
          Clear pad
        </button>
      </div>

      <div className="pt-3 border-t border-[var(--color-glass-border)] space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pen color">
            <input
              type="color"
              value={pen.color}
              onChange={(e) => onPen({ color: e.target.value })}
              className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
            />
          </Field>
          <Slider
            label={`Pen width — ${Math.round(pen.width * 1000)}`}
            min={0.006}
            max={0.06}
            step={0.002}
            value={pen.width}
            onChange={(v) => onPen({ width: v })}
          />
        </div>
        <Slider
          label={`Pixelated ↔ Smooth — ${Math.round(pen.smoothness * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          value={pen.smoothness}
          hint="Applies to the next stroke — each stroke keeps its own style."
          onChange={(v) => onPen({ smoothness: v })}
        />
      </div>

      <div className="pt-3 border-t border-[var(--color-glass-border)] space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label={`Animation — ${animDur}s`}
            min={0}
            max={60}
            step={0.1}
            value={animDur}
            onChange={(v) => onEdit({ animationDur: v })}
          />
          <NumberField
            label={`Freeze — ${freezeDur}s`}
            min={0.2}
            max={60}
            step={0.1}
            value={freezeDur}
            onChange={(v) => onEdit({ freezeDur: v })}
          />
        </div>
        {el.animationDur === 0 && (
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Animation 0s → the completed drawing shows immediately (static), no tracer or pencil sound.
          </p>
        )}
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <input type="checkbox" checked={el.tracer} onChange={(e) => onEdit({ tracer: e.target.checked })} />
          Pencil-tip tracer (during animation)
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <input type="checkbox" checked={el.sound} onChange={(e) => onEdit({ sound: e.target.checked })} />
          Pencil sound (during animation)
        </label>
      </div>

      <DangerButton onClick={onRemove} className="mt-1">Remove sketch</DangerButton>
    </>
  );
}
