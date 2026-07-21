// ===== Colour-grade editor: preset "looks" + brightness / contrast / saturation =====
//
// A single reusable control used for BOTH the per-clip grade and the project-wide
// global grade. Presets are pre-filled brightness/contrast/saturation values (no
// LUT): picking one just sets the three sliders, which the user can then tweak.
// Slider drags coalesce into one undo entry (non-discrete); preset picks and
// reset are discrete one-shot entries.

import { Field } from '../ui';
import type { ColorGrade } from '../grade';
import {
  GRADE_PRESETS,
  GRADE_MIN,
  GRADE_MAX,
  NEUTRAL_GRADE,
  clampGrade,
  isNeutralGrade,
  matchPreset,
} from '../grade';

interface Props {
  grade: ColorGrade;
  /** Patch the grade. `discrete` seals a one-shot action as its own undo entry. */
  onChange: (grade: ColorGrade, discrete?: boolean) => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function GradePanel({ grade, onChange }: Props) {
  const active = matchPreset(grade);
  const set = (patch: Partial<ColorGrade>) => onChange({ ...grade, ...patch });

  const channels: Array<{ label: string; key: keyof ColorGrade }> = [
    { label: 'Brightness', key: 'brightness' },
    { label: 'Contrast', key: 'contrast' },
    { label: 'Saturation', key: 'saturation' },
  ];

  return (
    <div className="space-y-3">
      <Field label="Preset looks">
        <div className="grid grid-cols-3 gap-1.5">
          {GRADE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onChange({ ...p.grade }, true)}
              className={`px-1 py-1.5 rounded-md text-[11px] border font-medium ${
                active === p.id
                  ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                  : 'border-[var(--color-glass-border)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {channels.map((ch) => (
        <Field key={ch.key} label={`${ch.label} — ${pct(grade[ch.key])}`}>
          <input
            type="range"
            min={GRADE_MIN}
            max={GRADE_MAX}
            step={0.01}
            value={grade[ch.key]}
            onChange={(e) => set({ [ch.key]: clampGrade(Number(e.target.value)) })}
            className="w-full accent-[var(--color-primary-green)]"
          />
        </Field>
      ))}

      {!isNeutralGrade(grade) && (
        <button
          onClick={() => onChange({ ...NEUTRAL_GRADE }, true)}
          className="w-full px-3 py-1.5 rounded-md border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] text-xs font-medium hover:bg-[var(--color-glass-hover)]"
        >
          Reset to neutral
        </button>
      )}
    </div>
  );
}
