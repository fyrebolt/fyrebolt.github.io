// ===== Clip speed panel: how fast one clip runs, and freezing =====
//
// Speed is per-clip and lives BELOW the base clock, which is what makes it
// different from the Time Machine layer next door: that one re-times the whole
// output, this one re-times a single clip's slice of it. Split a clip and set
// the back half to 0.5× and only that half is slow.
//
// Freeze is speed zero, and it is the one setting that cannot derive its own
// length — source span over rate is infinite at rate zero — so it asks for the
// hold in seconds instead. Everything else reports the length it works out to,
// because "how long does this clip become" is the question anyone changing a
// rate is actually asking.

import { NumberField, ChoiceGrid, Field } from '../ui';
import {
  HOLD_MAX,
  MIN_CLIP_LEN,
  SPEED_MAX,
  SPEED_MIN,
  clipHold,
  clipLen,
  clipSourceSpan,
  clipSpeed,
  isFrozen,
  type VideoClip,
} from '../clips';

interface Props {
  clip: VideoClip;
  /** Patch the clip. `discrete` seals a one-shot action as its own undo entry. */
  onEdit: (patch: Partial<VideoClip>, discrete?: boolean) => void;
}

/** The presets worth one click. Everything between them is typed. */
const PRESETS: { key: string; label: string; hint: string; speed: number }[] = [
  { key: 'freeze', label: 'Freeze', hint: 'hold a frame', speed: 0 },
  { key: 'quarter', label: '0.25×', hint: 'very slow', speed: 0.25 },
  { key: 'half', label: '0.5×', hint: 'slow', speed: 0.5 },
  { key: 'normal', label: '1×', hint: 'normal', speed: 1 },
  { key: 'double', label: '2×', hint: 'fast', speed: 2 },
  { key: 'quad', label: '4×', hint: 'very fast', speed: 4 },
];

const fmt = (s: number) => `${s.toFixed(2)}s`;

export default function ClipSpeedPanel({ clip, onEdit }: Props) {
  const speed = clipSpeed(clip);
  const frozen = isFrozen(clip);
  const source = clipSourceSpan(clip);
  const length = clipLen(clip);

  // A preset is "current" only on an exact match; a typed 1.37× lights none of
  // them rather than rounding itself onto the nearest.
  const current = PRESETS.find((p) => Math.abs(p.speed - speed) < 1e-6)?.key ?? '';

  const setSpeed = (v: number, discrete = true) => {
    // Leaving a freeze restores a normal rate rather than the slowest legal one,
    // which is what "not frozen any more" means to anyone pressing it.
    onEdit({ speed: v === 1 ? undefined : v }, discrete);
  };

  return (
    <>
      <ChoiceGrid
        cols={3}
        value={current}
        options={PRESETS.map((p) => ({ key: p.key, label: p.label, hint: p.hint }))}
        onChange={(k) => {
          const p = PRESETS.find((o) => o.key === k);
          if (p) setSpeed(p.speed);
        }}
      />

      {!frozen && (
        <NumberField
          label="Speed"
          hint={`${SPEED_MIN}×–${SPEED_MAX}×. Higher is faster and shorter.`}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.05}
          value={Number(speed.toFixed(2))}
          onChange={(v) => setSpeed(v, false)}
        />
      )}

      {frozen && (
        <NumberField
          label="Hold for"
          hint="Seconds this frame stays on screen."
          min={MIN_CLIP_LEN}
          max={HOLD_MAX}
          step={0.1}
          value={Number(clipHold(clip).toFixed(2))}
          onChange={(v) => onEdit({ hold: v }, false)}
        />
      )}

      {/* The point of the panel, stated: what this does to the timeline. */}
      <Field label="On the timeline">
        <div className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          {frozen ? (
            <>
              Holds the frame at <b>{fmt(clip.in)}</b> for <b>{fmt(length)}</b>.
            </>
          ) : (
            <>
              <b>{fmt(source)}</b> of source becomes <b>{fmt(length)}</b> on the timeline.
              {Math.abs(speed - 1) > 0.02 && ' This clip’s own audio is silenced off 1×.'}
            </>
          )}
        </div>
      </Field>
    </>
  );
}
