import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { HighlighterPlayer } from '../highlight/HighlighterPlayer';
import type { LoadedMedia, HighlighterState } from '../highlight/HighlighterPlayer';
import HighlightRectEditor from '../highlight/HighlightRectEditor';
import HighlightTimeline from '../highlight/HighlightTimeline';
import { createHighlighter, elementEnd } from '../highlight/types';
import type { Highlighter } from '../highlight/types';
import { transcodeToMp4, ensureFFmpeg } from '../ffmpeg';
import type { FillMode, RatioKey } from '../types';

type MediaKind = 'video' | 'image' | null;
type ExportStage = 'idle' | 'recording' | 'preparing' | 'encoding' | 'done' | 'error';

const RATIO_LABELS: { key: RatioKey; label: string; hint: string }[] = [
  { key: '9:16', label: '9:16', hint: 'Shorts / Reels / TikTok' },
  { key: '1:1', label: '1:1', hint: 'Square' },
  { key: '4:5', label: '4:5', hint: 'Portrait feed' },
  { key: 'original', label: 'Original', hint: 'No conversion' },
];

const ROW_COLORS = ['#ffe14d', '#8be9c7', '#74b9ff', '#ff9ff3', '#ffa07a', '#c4a7fb'];
const rowColor = (i: number) => ROW_COLORS[i % ROW_COLORS.length];

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function HighlighterTool() {
  const [mediaKind, setMediaKind] = useState<MediaKind>(null);
  const [duration, setDuration] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);

  const [elements, setElements] = useState<Highlighter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('crop');

  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo or video, then add a highlighter.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('highlighter.mp4');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<HighlighterPlayer | null>(null);
  const stateRef = useRef<HighlighterState>({ elements: [], fillMode: 'crop', ratio: '9:16' });
  const objectUrls = useRef<string[]>([]);

  const selected = elements.find((e) => e.id === selectedId) ?? null;

  const stateSnapshot: HighlighterState = useMemo(
    () => ({ elements, fillMode, ratio }),
    [elements, fillMode, ratio],
  );
  useEffect(() => {
    stateRef.current = stateSnapshot;
    playerRef.current?.renderStatic();
  }, [stateSnapshot]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const player = new HighlighterPlayer(canvasRef.current, () => stateRef.current, (sec) => setCurrentSec(sec));
    playerRef.current = player;
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const onFile = useCallback((file: File) => {
    const player = playerRef.current;
    if (!player) return;
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    setDownloadUrl(null);
    setStage('idle');
    setProgress(0);

    if (file.type.startsWith('video')) {
      const video = document.createElement('video');
      video.src = url;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.addEventListener('loadedmetadata', () => {
        setMediaKind('video');
        setDuration(video.duration);
        const media: LoadedMedia = { kind: 'video', video, duration: video.duration };
        player.attach(media);
        setStatus('Loaded. Add a highlighter, place the box, and set its timing below.');
      });
    } else if (file.type.startsWith('image')) {
      const image = new Image();
      image.onload = () => {
        setMediaKind('image');
        setDuration(Math.max(3, ...elements.map(elementEnd)));
        const media: LoadedMedia = { kind: 'image', image, duration: 0 };
        player.attach(media);
        setStatus('Photo loaded. Add a highlighter and set its timing.');
      };
      image.src = url;
    }
  }, [elements]);

  const timelineDuration = mediaKind === 'video' ? duration : Math.max(3, ...elements.map(elementEnd), duration);

  /** A moment when the highlighter is fully drawn (its hold), for placement. */
  const holdMoment = useCallback((hl: Highlighter) => {
    const hold = Math.max(0, hl.duration - hl.sweepIn - hl.sweepOut);
    return hl.start + hl.sweepIn + Math.min(0.3, hold / 2 || 0.1);
  }, []);

  const seekTo = useCallback((sec: number) => {
    playerRef.current?.scrubTo(sec);
    setCurrentSec(sec);
  }, []);

  const addHighlighter = useCallback(() => {
    const prevEnd = elements.reduce((m, e) => Math.max(m, elementEnd(e)), 0);
    const dur = 2;
    const start = Math.max(0, Math.min(prevEnd, Math.max(0, timelineDuration - dur)));
    const hl = createHighlighter({ start, duration: dur });
    setElements((es) => [...es, hl]);
    setSelectedId(hl.id);
    seekTo(holdMoment(hl));
    setStatus('Added. Drag the box to place/resize it; tune color, opacity and sweep on the right.');
  }, [elements, timelineDuration, holdMoment, seekTo]);

  const updateElement = useCallback((id: string, patch: Partial<Highlighter>) => {
    setElements((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const removeElement = useCallback((id: string) => {
    setElements((es) => es.filter((e) => e.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const selectElement = useCallback(
    (id: string) => {
      setSelectedId(id);
      const el = elements.find((e) => e.id === id);
      if (el) seekTo(holdMoment(el));
    },
    [elements, holdMoment, seekTo],
  );

  const onRectChange = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      if (selected) updateElement(selected.id, rect);
    },
    [selected, updateElement],
  );

  const onScrub = useCallback((sec: number) => {
    setCurrentSec(sec);
    playerRef.current?.scrubTo(sec);
  }, []);

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const player = playerRef.current;
      const el = canvasRef.current;
      if (!player || !el) return;
      const rect = el.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      const hit = player.hitTest(nx, ny);
      if (hit) selectElement(hit);
      else setSelectedId(null);
    },
    [selectElement],
  );

  const play = useCallback(() => {
    setSelectedId(null);
    playerRef.current?.playPreview();
  }, []);

  const busy = stage === 'recording' || stage === 'preparing' || stage === 'encoding';

  const doExport = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !mediaKind) return;
    if (typeof MediaRecorder === 'undefined') {
      setStatus('Recording is not supported in this browser.');
      return;
    }
    setSelectedId(null);
    setDownloadUrl(null);
    setStage('recording');
    setProgress(0);
    setStatus('Recording…');
    try {
      const total = player.totalSec();
      const webm = await player.record((sec) => setProgress(Math.min(0.99, sec / Math.max(0.1, total))));
      let outBlob: Blob = webm;
      let ext = 'webm';
      let type = 'video/webm';
      try {
        setStage('preparing');
        setStatus('Preparing the MP4 encoder (one-time download)…');
        await ensureFFmpeg();
        setStage('encoding');
        setStatus('Encoding MP4 (H.264)…');
        setProgress(0);
        outBlob = await transcodeToMp4(webm, (p) => setProgress(p));
        ext = 'mp4';
        type = 'video/mp4';
      } catch (err) {
        console.error('MP4 transcode failed, falling back to WebM', err);
        setStatus('MP4 encoding failed — providing the WebM instead.');
      }
      const blob = new Blob([outBlob], { type });
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      setDownloadUrl(url);
      setDownloadName(`highlighter.${ext}`);
      setStage('done');
      setProgress(1);
      if (ext === 'mp4') setStatus('Done — MP4 ready to download.');
    } catch (err) {
      console.error(err);
      setStage('error');
      setStatus('Export failed. See the console for details.');
    }
  }, [mediaKind]);

  const hold = selected ? Math.max(0, selected.duration - selected.sweepIn - selected.sweepOut) : 0;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
      <section>
        <label className="block glass-card p-4 mb-4 cursor-pointer hover:bg-[var(--color-glass-hover)] transition-colors">
          <span className="text-sm font-medium">Photo or video</span>
          <input
            type="file"
            accept="image/*,video/*"
            className="block mt-2 text-sm text-[var(--color-text-secondary)] file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-[var(--color-bg-elevated)] file:text-[var(--color-text-primary)]"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>

        <div className="glass-card p-3">
          <div className="relative mx-auto max-w-[420px]">
            <canvas
              ref={canvasRef}
              onPointerDown={onCanvasPointerDown}
              className="w-full h-auto rounded-lg bg-black block touch-none"
              width={1080}
              height={1920}
            />
            {selected && mediaKind && (
              <HighlightRectEditor
                rect={{ x: selected.x, y: selected.y, w: selected.w, h: selected.h }}
                color={selected.color}
                onChange={onRectChange}
              />
            )}
            {!mediaKind && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Upload to preview
              </div>
            )}
          </div>

          {mediaKind && (
            <HighlightTimeline
              duration={timelineDuration}
              elements={elements}
              currentSec={currentSec}
              selectedId={selectedId}
              rowColor={rowColor}
              onSelect={selectElement}
              onEdit={updateElement}
              onScrub={onScrub}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button onClick={play} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              ▶ Play preview
            </button>
            <button onClick={addHighlighter} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              + Highlighter
            </button>
            <button onClick={doExport} disabled={!mediaKind || busy || elements.length === 0} className="px-4 py-2 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold disabled:opacity-40 text-sm">
              {busy ? 'Working…' : 'Export MP4'}
            </button>
            {downloadUrl && (
              <a href={downloadUrl} download={downloadName} className="px-4 py-2 rounded-md border border-[var(--color-primary-green)] text-[var(--color-primary-green)] text-sm font-medium">
                ↓ Save {downloadName.endsWith('.mp4') ? 'MP4' : 'WebM'}
              </a>
            )}
          </div>

          {busy && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </div>
          )}
          <p className="text-xs text-[var(--color-text-secondary)] mt-2 font-mono">{status}</p>
        </div>
      </section>

      <aside className="space-y-6">
        <Panel title="Output">
          <Field label="Aspect ratio">
            <div className="grid grid-cols-2 gap-2">
              {RATIO_LABELS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRatio(r.key)}
                  className={`px-2 py-2 rounded-md text-xs border text-left ${
                    ratio === r.key ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  <div className="font-semibold">{r.label}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">{r.hint}</div>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Fill mode (when input ratio ≠ output)">
            <div className="grid grid-cols-2 gap-2">
              {(['crop', 'blur'] as FillMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setFillMode(m)}
                  className={`px-2 py-2 rounded-md text-xs border ${
                    fillMode === m ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  {m === 'crop' ? 'Crop to fill' : 'Blur pad'}
                </button>
              ))}
            </div>
          </Field>
        </Panel>

        {selected ? (
          <Panel title={`Highlighter ${elements.indexOf(selected) + 1}`}>
            <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">
              Drag the box on the preview to move it; drag its handles to set length &amp; height.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Color">
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => updateElement(selected.id, { color: e.target.value })}
                  className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
                />
              </Field>
              <Field label={`Opacity — ${Math.round(selected.opacity * 100)}%`}>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={selected.opacity}
                  onChange={(e) => updateElement(selected.id, { opacity: Number(e.target.value) })}
                  className="w-full accent-[var(--color-primary-green)]"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={`Width — ${Math.round(selected.w * 100)}%`}>
                <input
                  type="range"
                  min={0.02}
                  max={1}
                  step={0.01}
                  value={selected.w}
                  onChange={(e) => updateElement(selected.id, { w: Math.min(Number(e.target.value), 1 - selected.x) })}
                  className="w-full accent-[var(--color-primary-green)]"
                />
              </Field>
              <Field label={`Height — ${Math.round(selected.h * 100)}%`}>
                <input
                  type="range"
                  min={0.02}
                  max={1}
                  step={0.01}
                  value={selected.h}
                  onChange={(e) => updateElement(selected.id, { h: Math.min(Number(e.target.value), 1 - selected.y) })}
                  className="w-full accent-[var(--color-primary-green)]"
                />
              </Field>
            </div>

            <Field label={`Duration — ${round2(selected.duration)}s`}>
              <input
                type="number"
                min={0.2}
                max={Math.max(0.2, timelineDuration || 60)}
                step={0.1}
                value={round2(selected.duration)}
                onChange={(e) => {
                  const d = Math.max(0.2, Number(e.target.value) || 0.2);
                  updateElement(selected.id, {
                    duration: d,
                    sweepIn: Math.min(selected.sweepIn, d),
                    sweepOut: Math.min(selected.sweepOut, Math.max(0, d - Math.min(selected.sweepIn, d))),
                  });
                }}
                className="input"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={`Sweep in — ${round2(selected.sweepIn)}s`}>
                <input
                  type="number"
                  min={0}
                  max={round2(selected.duration - selected.sweepOut)}
                  step={0.05}
                  value={round2(selected.sweepIn)}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(selected.duration - selected.sweepOut, Number(e.target.value) || 0));
                    updateElement(selected.id, { sweepIn: v });
                  }}
                  className="input"
                />
              </Field>
              <Field label={`Sweep out — ${round2(selected.sweepOut)}s`}>
                <input
                  type="number"
                  min={0}
                  max={round2(selected.duration - selected.sweepIn)}
                  step={0.05}
                  value={round2(selected.sweepOut)}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(selected.duration - selected.sweepIn, Number(e.target.value) || 0));
                    updateElement(selected.id, { sweepOut: v });
                  }}
                  className="input"
                />
              </Field>
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)]">
              Hold {round2(hold)}s. Sweeps ease in/out; scrub the timeline to preview the wipe.
            </div>

            <button
              onClick={() => removeElement(selected.id)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
            >
              Remove highlighter
            </button>
          </Panel>
        ) : (
          <Panel title="Highlighters">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {mediaKind
                ? 'Add a highlighter, then place its box on the footage and set the sweep timing.'
                : 'Upload a photo or video to begin.'}
            </p>
            <button
              onClick={addHighlighter}
              disabled={!mediaKind}
              className="w-full px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
            >
              + Highlighter
            </button>
          </Panel>
        )}
      </aside>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-text-secondary)] mb-1.5">{label}</div>
      {children}
    </div>
  );
}
