// ===== Base-clip timeline lane (boundaries + waveform, shared axis) =====
//
// Shows the base sequence as a row IN the timeline (not a disconnected strip), so
// clip boundaries sit in the same visual context as the overlay layers and line
// up by eye. Each clip segment spans its OUTPUT-time extent (already warped by the
// caller) and draws its cached audio waveform underneath — the visual companion
// to the volume-automation curve. Trimming/reordering still live in ClipStrip.

import { useEffect, useState } from 'react';
import type { Waveform } from './waveform';
import { getWaveform, waveformPolygon } from './waveform';

export interface ClipExtent {
  id: string;
  srcId: string;
  name: string;
  kind: 'video' | 'image';
  /** Trim in/out in SOURCE seconds (for slicing the waveform). */
  inSec: number;
  outSec: number;
  /** OUTPUT-time extent of the clip on the shared timeline. */
  start: number;
  end: number;
}

const H = 44; // lane height, px

interface Props {
  extents: ClipExtent[];
  duration: number;
  currentSec: number;
  selectedClipId: string | null;
  getClipBlob: (srcId: string) => Blob | undefined;
  onSelectClip: (id: string) => void;
}

const CLIP_COLORS = ['rgba(116,185,255,0.20)', 'rgba(139,233,199,0.20)', 'rgba(255,234,167,0.18)', 'rgba(255,159,243,0.18)'];

export default function ClipLane({ extents, duration, currentSec, selectedClipId, getClipBlob, onSelectClip }: Props) {
  const dur = Math.max(0.001, duration);
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / dur) * 100))}%`;
  const playLeft = pct(currentSec);

  return (
    <div className="relative rounded-md bg-[var(--color-bg-elevated)] overflow-hidden" style={{ height: H }}>
      {extents.map((c, i) => {
        const leftPct = (c.start / dur) * 100;
        const widthPct = Math.max(0.5, ((c.end - c.start) / dur) * 100);
        const selected = c.id === selectedClipId;
        return (
          <div
            key={c.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelectClip(c.id);
            }}
            title={`${c.name} — click to select`}
            className={`absolute top-0 bottom-0 overflow-hidden cursor-pointer border-l border-r border-[var(--color-glass-border)] ${
              selected ? 'ring-2 ring-inset ring-[var(--color-primary-green)] z-10' : ''
            }`}
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: CLIP_COLORS[i % CLIP_COLORS.length] }}
          >
            {c.kind === 'video' ? (
              <ClipWave clip={c} getClipBlob={getClipBlob} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[9px] text-[var(--color-text-muted)]">🖼️</div>
            )}
            <span className="absolute left-1 top-0.5 text-[9px] font-medium text-[var(--color-text-secondary)] truncate max-w-[92%] pointer-events-none">
              {c.kind === 'video' ? '🎬' : '🖼️'} {c.name}
            </span>
          </div>
        );
      })}

      {/* playhead */}
      <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.7)] pointer-events-none z-20" style={{ left: playLeft }} />
    </div>
  );
}

/** Per-clip waveform: decode once (cached), draw as a mirrored polygon. */
function ClipWave({ clip, getClipBlob }: { clip: ClipExtent; getClipBlob: (srcId: string) => Blob | undefined }) {
  const [wf, setWf] = useState<Waveform | null>(null);

  useEffect(() => {
    let live = true;
    const blob = getClipBlob(clip.srcId);
    if (!blob) return;
    getWaveform(clip.srcId, blob).then((w) => {
      if (live) setWf(w);
    });
    return () => {
      live = false;
    };
  }, [clip.srcId, getClipBlob]);

  if (!wf || wf.duration <= 0) return null;
  const inFrac = clip.inSec / wf.duration;
  const outFrac = clip.outSec / wf.duration;
  const poly = waveformPolygon(wf, inFrac, outFrac, 100, H);
  if (!poly) return null;
  return (
    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" width="100%" height={H} className="absolute inset-0 block pointer-events-none">
      <polygon points={poly} fill="rgba(116,185,255,0.5)" />
    </svg>
  );
}
