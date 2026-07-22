// ===== Entrance banner layer property panel =====
// Ported from the classic EntranceBannerTool controls; timings are in SECONDS
// (the unified timeline's unit) rather than the classic tool's milliseconds.

import { Field, ColorField, Toggle } from '../ui';
import type { BannerPosition, BannerStyle } from '../../types';
import type { BannerLayer } from '../types';

const POSITIONS: { key: BannerPosition; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Middle' },
  { key: 'lower', label: 'Lower' },
  { key: 'bottom', label: 'Bottom' },
];

interface Props {
  layer: BannerLayer;
  duration: number;
  /** Set when the last freeze/hold edit was clamped to avoid an overlap. */
  conflict?: string | null;
  onEdit: (patch: Partial<BannerLayer>) => void;
  onEditStyle: (patch: Partial<BannerStyle>) => void;
  onRemove: () => void;
}

function SecSlider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <Field label={`${label} — ${value.toFixed(2)}s`}>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-primary-green)]" />
    </Field>
  );
}

export default function BannerPanel({ layer, duration, conflict, onEdit, onEditStyle, onRemove }: Props) {
  const s = layer.style;
  return (
    <>
      <Field label="Name">
        <input type="text" value={s.name} maxLength={24} onChange={(e) => onEditStyle({ name: e.target.value })} className="input" />
      </Field>
      <Field label="Tagline">
        <input type="text" value={s.tagline} maxLength={32} onChange={(e) => onEditStyle({ tagline: e.target.value })} className="input" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <ColorField label="Base" value={s.primary} onChange={(v) => onEditStyle({ primary: v })} />
        <ColorField label="Accent" value={s.accent} onChange={(v) => onEditStyle({ accent: v })} />
        <ColorField label="Text" value={s.text} onChange={(v) => onEditStyle({ text: v })} />
      </div>

      <div className="pt-3 border-t border-[var(--color-glass-border)] space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Game FX</div>
        <Toggle label="Glowing border" checked={!!s.glow} onChange={(v) => onEditStyle({ glow: v })} />
        <Toggle label="Metallic sheen" checked={!!s.metallic} onChange={(v) => onEditStyle({ metallic: v })} />
        <Toggle label="Speed lines" checked={!!s.speedLines} onChange={(v) => onEditStyle({ speedLines: v })} />
        <Toggle label="Chevrons" checked={!!s.chevrons} onChange={(v) => onEditStyle({ chevrons: v })} />
        <Toggle label="Scanlines" checked={!!s.scanlines} onChange={(v) => onEditStyle({ scanlines: v })} />
      </div>

      <Field label="Position">
        <div className="grid grid-cols-4 gap-1.5">
          {POSITIONS.map((p) => (
            <button
              key={p.key}
              onClick={() => onEdit({ position: p.key })}
              className={`px-1 py-2 rounded-md text-[11px] border ${
                layer.position === p.key ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="pt-3 border-t border-[var(--color-glass-border)] space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Timing</div>
        {conflict && (
          <p className="text-[11px] rounded-md px-2 py-1.5 bg-[rgba(255,180,60,0.12)] border border-[rgba(255,180,60,0.4)] text-[rgba(255,200,120,0.95)]">
            ⚠ {conflict}
          </p>
        )}
        <Field label={`Freeze point — ${layer.freeze.toFixed(2)}s`}>
          <input
            type="number"
            min={0}
            max={Math.max(0, duration)}
            step={0.05}
            value={Math.round(layer.freeze * 100) / 100}
            onChange={(e) => onEdit({ freeze: Math.max(0, Number(e.target.value) || 0) })}
            className="input"
          />
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">The clip freezes here as the banner locks; the whole composite holds. Drag the marker on the timeline too.</p>
        </Field>
        <SecSlider label="Slide-in" value={layer.slideIn} min={0.1} max={1.2} step={0.02} onChange={(v) => onEdit({ slideIn: v })} />
        <SecSlider label="Hold (freeze length)" value={layer.hold} min={0.2} max={4} step={0.05} onChange={(v) => onEdit({ hold: v })} />
        <SecSlider label="Fade-out" value={layer.fadeOut} min={0.1} max={1.2} step={0.02} onChange={(v) => onEdit({ fadeOut: v })} />
      </div>

      <Toggle label="Entrance slash SFX" hint="Musical hit when the banner locks" checked={layer.sfx} onChange={(v) => onEdit({ sfx: v })} />

      <button
        onClick={onRemove}
        className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
      >
        Remove banner
      </button>
    </>
  );
}
