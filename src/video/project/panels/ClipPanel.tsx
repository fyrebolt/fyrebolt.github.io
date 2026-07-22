// ===== Clip audio panel: free-form volume-automation curve + tremolo + mute =====
//
// Shown when a VIDEO clip is selected. The curve is an ordered list of
// {t, level} points (clip-local seconds from the in-point; level = gain
// multiplier, 1 = original). The lane is a free-form editor:
//   - click empty lane      → add a point
//   - drag a point          → move it (x = time, y = volume)
//   - select + Delete/right-click → remove it
// Volume interpolates linearly between points and holds flat outside them, so
// NO points == flat 100% (unchanged). The oscillation generator is just a curve
// helper: it writes ordinary points you can then drag/delete like any other.
// Mute is a separate flag that silences the clip regardless of the curve; while
// muted the editor greys out but keeps every point for a lossless un-mute.

import { useCallback, useMemo, useState } from 'react';
import { Field, Toggle } from '../ui';
import VolumeCurveEditor from './VolumeCurveEditor';
import type { VideoClip } from '../clips';
import { clipLen, applyOscillation } from '../clips';

interface Props {
  clip: VideoClip;
  /** Patch the clip. `discrete` seals a one-shot action as its own undo entry. */
  onEdit: (patch: Partial<VideoClip>, discrete?: boolean) => void;
}

export default function ClipPanel({ clip, onEdit }: Props) {
  const len = clipLen(clip);
  const points = useMemo(() => clip.volume ?? [], [clip.volume]);
  const muted = clip.muted === true;

  // ---- oscillation generator ----
  const [whole, setWhole] = useState(true);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(len);
  const [freq, setFreq] = useState(4);
  const [depthPct, setDepthPct] = useState(40);
  const [centerPct, setCenterPct] = useState(100);

  const generate = useCallback(() => {
    const start = whole ? 0 : Math.max(0, Math.min(rangeStart, len));
    const end = whole ? len : Math.max(start, Math.min(rangeEnd, len));
    onEdit(
      {
        volume: applyOscillation(points, {
          start,
          end,
          freq: Math.max(0, freq),
          depth: depthPct / 100,
          center: centerPct / 100,
        }),
      },
      true,
    );
  }, [whole, rangeStart, rangeEnd, len, freq, depthPct, centerPct, points, onEdit]);

  return (
    <>
      <Toggle
        label="Mute this clip"
        hint="Silences the original audio entirely. The curve below is kept for un-muting."
        checked={muted}
        onChange={(v) => onEdit({ muted: v }, true)}
      />

      <VolumeCurveEditor
        points={points}
        length={len}
        muted={muted}
        onEdit={(v, discrete) => onEdit({ volume: v }, discrete)}
      />

      {/* ---- tremolo / sine generator ---- */}
      <div className={`rounded-md border border-[var(--color-glass-border)] p-2.5 space-y-2 ${muted ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">Oscillation (tremolo)</div>
        <Toggle label="Whole clip" checked={whole} onChange={setWhole} />
        {!whole && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Start — ${rangeStart.toFixed(2)}s`}>
              <input type="number" min={0} max={len} step={0.05} value={Number(rangeStart.toFixed(2))} onChange={(e) => setRangeStart(Math.max(0, Math.min(len, Number(e.target.value) || 0)))} className="input" />
            </Field>
            <Field label={`End — ${rangeEnd.toFixed(2)}s`}>
              <input type="number" min={0} max={len} step={0.05} value={Number(rangeEnd.toFixed(2))} onChange={(e) => setRangeEnd(Math.max(0, Math.min(len, Number(e.target.value) || 0)))} className="input" />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label={`Freq — ${freq}/s`}>
            <input type="number" min={0.1} max={20} step={0.1} value={freq} onChange={(e) => setFreq(Math.max(0.1, Math.min(20, Number(e.target.value) || 0.1)))} className="input" />
          </Field>
          <Field label={`Depth — ${depthPct}%`}>
            <input type="number" min={0} max={100} step={5} value={depthPct} onChange={(e) => setDepthPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="input" />
          </Field>
          <Field label={`Center — ${centerPct}%`}>
            <input type="number" min={0} max={200} step={5} value={centerPct} onChange={(e) => setCenterPct(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} className="input" />
          </Field>
        </div>
        <button
          onClick={generate}
          className="w-full px-3 py-2 rounded-md border border-[var(--color-primary-green)] text-[var(--color-primary-green)] text-xs font-medium hover:bg-[var(--color-glass-hover)]"
        >
          Generate wave
        </button>
        <div className="text-[10px] text-[var(--color-text-muted)]">
          Writes regular curve points — drag or delete them afterward like any other.
        </div>
      </div>
    </>
  );
}
