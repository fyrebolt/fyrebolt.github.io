// ===== Background-music track panel: trim + loop + volume curve + mute =====
//
// Shown when a music layer is selected. Trim (`in`/`out`) selects a segment of
// the source; `start`/`dur` place it on the OUTPUT timeline (start is dragged on
// the timeline row; dur is set here / by the row's right edge). Looping repeats
// the trimmed segment to fill `dur`. Fades reuse the exact VolumeCurveEditor +
// mute the base clips use — one curve mechanism, no second implementation. The
// curve time runs across the placed duration (placement-local output seconds).

import { Field, Toggle } from '../ui';
import VolumeCurveEditor from './VolumeCurveEditor';
import type { MusicElement } from '../../music/types';
import { segLen } from '../../music/types';
import { MIN_CLIP_LEN } from '../clips';

interface Props {
  el: MusicElement;
  /** Patch the element. `discrete` seals a one-shot action as its own undo entry. */
  onEdit: (patch: Partial<MusicElement>, discrete?: boolean) => void;
}

const fmt = (s: number) => `${s.toFixed(2)}s`;

export default function MusicPanel({ el, onEdit }: Props) {
  const muted = el.muted === true;
  const seg = segLen(el);
  const src = Math.max(MIN_CLIP_LEN, el.srcDuration);

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-[var(--color-text-muted)] truncate" title={el.name}>
        🎵 {el.name}
      </div>

      {/* Source trim (in / out within the file). */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Trim in — ${fmt(el.in)}`}>
          <input
            type="range"
            min={0}
            max={Math.max(0, src - MIN_CLIP_LEN)}
            step={0.05}
            value={el.in}
            onChange={(e) => {
              const inP = Math.min(Number(e.target.value), el.out - MIN_CLIP_LEN);
              onEdit({ in: Math.max(0, inP) });
            }}
            className="w-full accent-[var(--color-primary-green)]"
          />
        </Field>
        <Field label={`Trim out — ${fmt(el.out)}`}>
          <input
            type="range"
            min={MIN_CLIP_LEN}
            max={src}
            step={0.05}
            value={el.out}
            onChange={(e) => {
              const outP = Math.max(Number(e.target.value), el.in + MIN_CLIP_LEN);
              onEdit({ out: Math.min(src, outP) });
            }}
            className="w-full accent-[var(--color-primary-green)]"
          />
        </Field>
      </div>

      {/* Placed duration on the timeline. */}
      <Field label={`Track length on timeline — ${fmt(el.dur)}`}>
        <input
          type="range"
          min={MIN_CLIP_LEN}
          max={Math.max(seg, 120)}
          step={0.1}
          value={el.dur}
          onChange={(e) => onEdit({ dur: Math.max(MIN_CLIP_LEN, Number(e.target.value)) })}
          className="w-full accent-[var(--color-primary-green)]"
        />
      </Field>

      <Toggle
        label="Loop to fill"
        hint={
          el.dur > seg + 0.01
            ? 'Repeats the trimmed segment to fill the track length.'
            : 'Repeats the segment when the track is longer than it.'
        }
        checked={el.loop}
        onChange={(v) => onEdit({ loop: v }, true)}
      />

      <Toggle
        label="Mute this track"
        hint="Silences the music entirely. The curve below is kept for un-muting."
        checked={muted}
        onChange={(v) => onEdit({ muted: v }, true)}
      />

      <VolumeCurveEditor
        points={el.volume ?? []}
        length={el.dur}
        muted={muted}
        onEdit={(v, discrete) => onEdit({ volume: v }, discrete)}
      />
    </div>
  );
}
