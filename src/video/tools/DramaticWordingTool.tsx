import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { DramaticPlayer } from '../dramatic/DramaticPlayer';
import type { LoadedMedia, DramaticState } from '../dramatic/DramaticPlayer';
import DramaticTimeline from '../dramatic/DramaticTimeline';
import { createDramaticWord, elementEnd } from '../dramatic/types';
import type { DramaticWord, WordMode } from '../dramatic/types';
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

const round2 = (n: number) => Math.round(n * 100) / 100;

// Snap targets (normalised): centre + thirds + safe-zone-ish edges.
const SNAP_THRESHOLD = 0.02;
const SNAP_X = [0.5, 1 / 3, 2 / 3];
const SNAP_Y = [0.5, 1 / 3, 2 / 3, 0.15, 0.85];
function snap(v: number, targets: number[]): { v: number; guide: number | null } {
  for (const t of targets) if (Math.abs(v - t) < SNAP_THRESHOLD) return { v: t, guide: t };
  return { v, guide: null };
}

const DEFAULT_DUR = 2;

/** First non-overlapping gap of at least `want` seconds, else null. */
function findGap(words: DramaticWord[], total: number, want: number): { start: number; duration: number } | null {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const w of sorted) {
    const gap = w.start - cursor;
    if (gap >= 0.6) return { start: cursor, duration: Math.min(want, gap) };
    cursor = Math.max(cursor, elementEnd(w));
  }
  const tail = total - cursor;
  if (tail >= 0.6) return { start: cursor, duration: Math.min(want, tail) };
  return null;
}

export default function DramaticWordingTool() {
  const [mediaKind, setMediaKind] = useState<MediaKind>(null);
  const [duration, setDuration] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);

  const [words, setWords] = useState<DramaticWord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('fit');
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo or video, then add a word.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('dramatic.mp4');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<DramaticPlayer | null>(null);
  const stateRef = useRef<DramaticState>({ words: [], fillMode: 'fit', ratio: '9:16' });
  const objectUrls = useRef<string[]>([]);
  const drag = useRef<{ id: string; grabDX: number; grabDY: number } | null>(null);

  const selected = words.find((w) => w.id === selectedId) ?? null;

  // Load the heavy clean sans up front so canvas draws/exports never fall back.
  useEffect(() => {
    const href = 'https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap';
    if (!document.querySelector(`link[href="${href}"]`)) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      document.head.appendChild(l);
    }
    document.fonts.load('64px "Archivo Black"').then(() => playerRef.current?.renderStatic()).catch(() => undefined);
  }, []);

  const stateSnapshot: DramaticState = useMemo(
    () => ({ words, fillMode, ratio }),
    [words, fillMode, ratio],
  );
  useEffect(() => {
    stateRef.current = stateSnapshot;
    playerRef.current?.renderStatic();
  }, [stateSnapshot]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const player = new DramaticPlayer(canvasRef.current, () => stateRef.current, (sec) => setCurrentSec(sec));
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
        setStatus('Loaded. Add a word, place it, and set its timing below.');
      });
    } else if (file.type.startsWith('image')) {
      const image = new Image();
      image.onload = () => {
        setMediaKind('image');
        setDuration(Math.max(3, ...words.map(elementEnd)));
        const media: LoadedMedia = { kind: 'image', image, duration: 0 };
        player.attach(media);
        setStatus('Photo loaded. Add a word and set its timing.');
      };
      image.src = url;
    }
  }, [words]);

  const timelineDuration = mediaKind === 'video' ? duration : Math.max(3, ...words.map(elementEnd), duration);

  const seekTo = useCallback((sec: number) => {
    playerRef.current?.scrubTo(sec);
    setCurrentSec(sec);
  }, []);
  const midOf = useCallback((w: DramaticWord) => w.start + Math.min(0.5, w.duration / 2), []);

  const selectWord = useCallback(
    (id: string) => {
      setSelectedId(id);
      const w = words.find((x) => x.id === id);
      if (w) seekTo(midOf(w));
    },
    [words, midOf, seekTo],
  );

  const addWord = useCallback(
    (mode: WordMode) => {
      const gap = findGap(words, timelineDuration, DEFAULT_DUR);
      if (!gap) {
        setStatus('No free space on the timeline — shorten or remove a word first.');
        return;
      }
      const w = createDramaticWord({ mode, start: gap.start, duration: gap.duration });
      setWords((ws) => [...ws, w]);
      setSelectedId(w.id);
      seekTo(midOf(w));
    },
    [words, timelineDuration, midOf, seekTo],
  );

  const updateWord = useCallback((id: string, patch: Partial<DramaticWord>) => {
    setWords((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, []);

  const removeWord = useCallback((id: string) => {
    setWords((ws) => ws.filter((w) => w.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  // ---- canvas drag-to-place + snap guides ----
  const normFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { nx: 0.5, ny: 0.5 };
    const rect = el.getBoundingClientRect();
    return { nx: (clientX - rect.left) / rect.width, ny: (clientY - rect.top) / rect.height };
  }, []);

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const player = playerRef.current;
      if (!player) return;
      const { nx, ny } = normFromPointer(e.clientX, e.clientY);
      const hit = player.hitTest(nx, ny);
      if (!hit) {
        setSelectedId(null);
        return;
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const w = words.find((x) => x.id === hit)!;
      setSelectedId(hit);
      drag.current = { id: hit, grabDX: w.x - nx, grabDY: w.y - ny };
    },
    [words, normFromPointer],
  );

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || e.buttons === 0) return;
      const { nx, ny } = normFromPointer(e.clientX, e.clientY);
      const sx = snap(nx + d.grabDX, SNAP_X);
      const sy = snap(ny + d.grabDY, SNAP_Y);
      setGuides({ x: sx.guide, y: sy.guide });
      updateWord(d.id, { x: Math.max(0, Math.min(1, sx.v)), y: Math.max(0, Math.min(1, sy.v)) });
    },
    [normFromPointer, updateWord],
  );

  const onCanvasPointerUp = useCallback((e: ReactPointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
    setGuides({ x: null, y: null });
  }, []);

  const onScrub = useCallback((sec: number) => {
    setCurrentSec(sec);
    playerRef.current?.scrubTo(sec);
  }, []);

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
      setDownloadName(`dramatic.${ext}`);
      setStage('done');
      setProgress(1);
      if (ext === 'mp4') setStatus('Done — MP4 ready to download.');
    } catch (err) {
      console.error(err);
      setStage('error');
      setStatus('Export failed. See the console for details.');
    }
  }, [mediaKind]);

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
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              className="w-full h-auto rounded-lg bg-black block touch-none"
              width={1080}
              height={1920}
            />
            {guides.x !== null && (
              <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#b57cff] shadow-[0_0_6px_#b57cff]" style={{ left: `${guides.x * 100}%` }} />
            )}
            {guides.y !== null && (
              <div className="pointer-events-none absolute left-0 right-0 h-px bg-[#b57cff] shadow-[0_0_6px_#b57cff]" style={{ top: `${guides.y * 100}%` }} />
            )}
            {!mediaKind && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Upload to preview
              </div>
            )}
          </div>

          {mediaKind && (
            <DramaticTimeline
              duration={timelineDuration}
              words={words}
              currentSec={currentSec}
              selectedId={selectedId}
              onSelect={selectWord}
              onEdit={updateWord}
              onScrub={onScrub}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button onClick={play} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              ▶ Play preview
            </button>
            <button onClick={() => addWord('normal')} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              + Word
            </button>
            <button onClick={() => addWord('inverse')} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              + Inverse
            </button>
            <button onClick={doExport} disabled={!mediaKind || busy || words.length === 0} className="px-4 py-2 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold disabled:opacity-40 text-sm">
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
            <div className="grid grid-cols-3 gap-2">
              {(['crop', 'fit', 'blur'] as FillMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setFillMode(m)}
                  className={`px-2 py-2 rounded-md text-xs border ${
                    fillMode === m ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  {m === 'crop' ? 'Crop' : m === 'fit' ? 'Fit' : 'Blur'}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Fit shows the whole clip (black bars); great for horizontal clips in a vertical output.</p>
          </Field>
        </Panel>

        {selected ? (
          <Panel title={`${selected.mode === 'inverse' ? 'Inverse' : 'Word'} ${words.indexOf(selected) + 1}`}>
            <Field label="Text">
              <input value={selected.text} onChange={(e) => updateWord(selected.id, { text: e.target.value })} className="input" placeholder="WORD" />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Shown in ALL CAPS.</p>
            </Field>

            <Field label="Effect">
              <div className="grid grid-cols-2 gap-1.5">
                {([['normal', 'Word'], ['inverse', 'Inverse']] as [WordMode, string][]).map(([v, lbl]) => (
                  <button
                    key={v}
                    onClick={() => updateWord(selected.id, { mode: v, color: v === 'inverse' ? '#000000' : '#dcdcdc' })}
                    className={`px-2 py-2 rounded-md text-[11px] border ${
                      selected.mode === v ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                {selected.mode === 'inverse' ? 'Dims everything except the word (a clear window).' : 'Translucent word over the video.'}
              </p>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={selected.mode === 'inverse' ? 'Dim color' : 'Word color'}>
                <input type="color" value={selected.color} onChange={(e) => updateWord(selected.id, { color: e.target.value })} className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5" />
              </Field>
              <Field label={`${selected.mode === 'inverse' ? 'Dim' : 'Word'} opacity — ${Math.round(selected.opacity * 100)}%`}>
                <input type="range" min={0} max={1} step={0.05} value={selected.opacity} onChange={(e) => updateWord(selected.id, { opacity: Number(e.target.value) })} className="w-full accent-[var(--color-primary-green)]" />
              </Field>
            </div>

            <Field label={`Size — ${selected.sizeScale.toFixed(1)}×`}>
              <input type="range" min={0.4} max={2.5} step={0.1} value={selected.sizeScale} onChange={(e) => updateWord(selected.id, { sizeScale: Number(e.target.value) })} className="w-full accent-[var(--color-primary-green)]" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={`Start — ${round2(selected.start)}s`}>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, timelineDuration)}
                  step={0.1}
                  value={round2(selected.start)}
                  onChange={(e) => updateWord(selected.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                  className="input"
                />
              </Field>
              <Field label={`Hold — ${round2(selected.duration)}s`}>
                <input
                  type="number"
                  min={0.2}
                  max={Math.max(0.2, timelineDuration)}
                  step={0.1}
                  value={round2(selected.duration)}
                  onChange={(e) => updateWord(selected.id, { duration: Math.max(0.2, Number(e.target.value) || 0.2) })}
                  className="input"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={`Fade in — ${round2(selected.fadeIn)}s`}>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, selected.duration)}
                  step={0.05}
                  value={round2(selected.fadeIn)}
                  onChange={(e) => updateWord(selected.id, { fadeIn: Math.max(0, Math.min(selected.duration, Number(e.target.value) || 0)) })}
                  className="input"
                />
              </Field>
              <Field label={`Fade out — ${round2(selected.fadeOut)}s`}>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, selected.duration)}
                  step={0.05}
                  value={round2(selected.fadeOut)}
                  onChange={(e) => updateWord(selected.id, { fadeOut: Math.max(0, Math.min(selected.duration, Number(e.target.value) || 0)) })}
                  className="input"
                />
              </Field>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)]">Drag the word on the preview to move it (snaps to centre / thirds). Words never overlap in time.</p>

            <button onClick={() => removeWord(selected.id)} className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]">
              Remove word
            </button>
          </Panel>
        ) : (
          <Panel title="Words">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {mediaKind
                ? 'Add a word (translucent over the video) or an inverse word (dims everything except the word). Drag to place, drag the timeline to time it — no two overlap.'
                : 'Upload a photo or video to begin.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => addWord('normal')} disabled={!mediaKind} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                + Word
              </button>
              <button onClick={() => addWord('inverse')} disabled={!mediaKind} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                + Inverse
              </button>
            </div>
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
