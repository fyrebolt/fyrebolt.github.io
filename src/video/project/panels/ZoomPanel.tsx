// ===== Zoom layer property panel (add keyframes + edit the selected keyframe) =====
// Ported from the classic ZoomTool controls.

import { DangerButton, Field, NumberField } from '../ui';
import { round2 } from '../constants';
import { outputSizeFor } from '../../render';
import type { RatioKey } from '../../types';
import type { ZoomKeyframe, ZoomRect } from '../../zoom/types';
import { sortedZooms } from '../../zoom/types';
import type { ZoomLayer } from '../types';

/** A centred crop at the output aspect ratio, ~65% scale — a clean default zoom-in. */
function defaultZoomRect(srcW: number, srcH: number, ratio: RatioKey): ZoomRect {
  if (srcW <= 0 || srcH <= 0) return { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
  const out = outputSizeFor(ratio, srcW, srcH);
  const wOverH = out.w / out.h / (srcW / srcH);
  let w: number;
  let h: number;
  if (wOverH >= 1) {
    w = 0.65;
    h = w / wOverH;
  } else {
    h = 0.65;
    w = h * wOverH;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

interface Props {
  layer: ZoomLayer;
  duration: number;
  ratio: RatioKey;
  srcDims: { w: number; h: number };
  selectedKfId: string | null;
  onAddKeyframe: (rect: ZoomRect) => void;
  onSelectKf: (kfId: string) => void;
  onEditKf: (kfId: string, patch: Partial<ZoomKeyframe>) => void;
  onRemoveKf: (kfId: string) => void;
  onRemoveLayer: () => void;
}

export default function ZoomPanel({
  layer,
  duration,
  ratio,
  srcDims,
  selectedKfId,
  onAddKeyframe,
  onSelectKf,
  onEditKf,
  onRemoveKf,
  onRemoveLayer,
}: Props) {
  const sorted = sortedZooms(layer.keyframes);
  const selected = layer.keyframes.find((k) => k.id === selectedKfId) ?? null;

  return (
    <>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Add a zoom, then drag its crop rectangle on the full frame. Each zoom animates from the previous state; add an “Unzoom” to return to full frame.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onAddKeyframe(defaultZoomRect(srcDims.w, srcDims.h, ratio))} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
          + Zoom in
        </button>
        <button onClick={() => onAddKeyframe({ x: 0, y: 0, w: 1, h: 1 })} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
          + Unzoom
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
                ⤢{i + 1} · {kf.start.toFixed(1)}s
              </button>
            ))}
          </div>
        </Field>
      )}

      {selected && (
        <div className="pt-3 border-t border-[var(--color-glass-border)] space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={`Start — ${round2(selected.start).toFixed(2)}s`}
              min={0}
              max={Math.max(0, duration)}
              step={0.1}
              value={round2(selected.start)}
              onChange={(v) => onEditKf(selected.id, { start: v })}
            />
            <NumberField
              label={`Transition — ${round2(selected.duration).toFixed(2)}s`}
              min={0.1}
              max={Math.max(0.1, duration)}
              step={0.1}
              value={round2(selected.duration)}
              onChange={(v) => onEditKf(selected.id, { duration: v })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onEditKf(selected.id, { rect: defaultZoomRect(srcDims.w, srcDims.h, ratio) })} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              Fit output ratio
            </button>
            <button onClick={() => onEditKf(selected.id, { rect: { x: 0, y: 0, w: 1, h: 1 } })} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              Full frame
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={selected.whoosh} onChange={(e) => onEditKf(selected.id, { whoosh: e.target.checked })} />
            Whoosh at this transition
          </label>

          <DangerButton onClick={() => onRemoveKf(selected.id)}>Remove keyframe</DangerButton>
        </div>
      )}

      <button onClick={onRemoveLayer} className="w-full mt-1 px-3 py-2 rounded-md border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-glass-hover)]">
        Remove zoom track
      </button>
    </>
  );
}
