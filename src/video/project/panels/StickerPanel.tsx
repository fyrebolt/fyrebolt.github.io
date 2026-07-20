// ===== Sticker layer property panel =====
// Placement / size / rotation live on-canvas (the shared TransformBox); this
// panel owns timeline timing (start + hold) and the crop-mode toggle. Cropping
// is also entered by double-clicking the sticker on the preview.

import { Field } from '../ui';
import type { StickerLayer } from '../types';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Props {
  layer: StickerLayer;
  duration: number;
  cropping: boolean;
  onEdit: (patch: Partial<StickerLayer['el']>) => void;
  onToggleCrop: () => void;
  onRemove: () => void;
}

export default function StickerPanel({ layer, duration, cropping, onEdit, onToggleCrop, onRemove }: Props) {
  const s = layer.el;
  const isVideo = s.source === 'video';
  const maxStart = Math.max(0, (duration || 60) - 0.1);

  return (
    <>
      <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">
        Drag on the preview to move; use the handles to resize &amp; rotate. Double-click the sticker to crop.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Start — ${round2(s.start)}s`}>
          <input
            type="number"
            min={0}
            max={round2(maxStart)}
            step={0.1}
            value={round2(s.start)}
            onChange={(e) => onEdit({ start: Math.max(0, Math.min(maxStart, Number(e.target.value) || 0)) })}
            className="input"
          />
        </Field>
        <Field label={`Hold — ${round2(s.hold)}s`}>
          <input
            type="number"
            min={0.1}
            max={Math.max(0.1, duration || 60)}
            step={0.1}
            value={round2(s.hold)}
            onChange={(e) => onEdit({ hold: Math.max(0.1, Number(e.target.value) || 0.1) })}
            className="input"
          />
        </Field>
      </div>

      {isVideo && (
        <div className="text-[10px] text-[var(--color-text-muted)]">
          Clip is {round2(s.clipDur)}s. It loops if the hold is longer, and slows / freezes with the main clip's Time
          Machine. Its own audio is muted.
        </div>
      )}

      <button
        onClick={onToggleCrop}
        className={`w-full mt-1 px-3 py-2 rounded-md border text-xs font-medium ${
          cropping
            ? 'border-[var(--color-primary-green)] bg-[rgba(139,233,199,0.12)] text-[var(--color-primary-green)]'
            : 'border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]'
        }`}
      >
        {cropping ? 'Done cropping' : `Crop ${isVideo ? 'video' : 'image'}`}
      </button>
      <div className="text-[10px] text-[var(--color-text-muted)]">
        Cropping sets which part of the source shows inside the frame — the frame keeps the crop's shape.
      </div>

      <button
        onClick={onRemove}
        className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
      >
        Remove sticker
      </button>
    </>
  );
}
