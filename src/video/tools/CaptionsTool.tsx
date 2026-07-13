import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { CaptionsPlayer } from '../captions/CaptionsPlayer';
import type { CaptionsState, LoadedMedia } from '../captions/CaptionsPlayer';
import { BOIL_FONTS, preloadBoilFonts } from '../captions/fonts';
import { createCaption } from '../captions/types';
import type { BoilMode, Caption, Legibility, TextAlign } from '../captions/types';
import MultiTrackTimeline from '../captions/MultiTrackTimeline';
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

const ROW_COLORS = ['#8be9c7', '#74b9ff', '#ffeaa7', '#ff9ff3', '#ffa07a', '#81ecec'];
const rowColor = (i: number) => ROW_COLORS[i % ROW_COLORS.length];

// Snap targets (normalised): centre + TikTok/Reels safe-zone edges.
const SNAP_THRESHOLD = 0.018;
const SNAP_X = [0.5, 0.07, 0.93];
const SNAP_Y = [0.5, 0.13, 0.8];

function snap(v: number, targets: number[], enabled: boolean): { v: number; guide: number | null } {
  if (!enabled) return { v, guide: null };
  for (const t of targets) {
    if (Math.abs(v - t) < SNAP_THRESHOLD) return { v: t, guide: t };
  }
  return { v, guide: null };
}

export default function CaptionsTool() {
  const [mediaKind, setMediaKind] = useState<MediaKind>(null);
  const [duration, setDuration] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);

  const [captions, setCaptions] = useState<Caption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('crop');
  const [guidesOn, setGuidesOn] = useState(true);
  const [showSafeZones, setShowSafeZones] = useState(true);

  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo or video, then add captions.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('captions.mp4');

  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<CaptionsPlayer | null>(null);
  const stateRef = useRef<CaptionsState>({ captions: [], fillMode: 'crop', ratio: '9:16' });
  const objectUrls = useRef<string[]>([]);
  const canvasDrag = useRef<{ id: string; grabDX: number; grabDY: number } | null>(null);

  const selected = captions.find((c) => c.id === selectedId) ?? null;

  // Preload the font-boil pool up front.
  useEffect(() => {
    preloadBoilFonts().then(() => playerRef.current?.renderStatic());
  }, []);

  // Keep the player's state source current, and redraw when edits change the frame.
  const stateSnapshot: CaptionsState = useMemo(
    () => ({ captions, fillMode, ratio }),
    [captions, fillMode, ratio],
  );
  useEffect(() => {
    stateRef.current = stateSnapshot;
    playerRef.current?.renderStatic();
  }, [stateSnapshot]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const player = new CaptionsPlayer(
      canvasRef.current,
      () => stateRef.current,
      (sec) => setCurrentSec(sec),
    );
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
        setStatus('Loaded. Add a caption, drag it on the video, and set its timing below.');
      });
    } else if (file.type.startsWith('image')) {
      const image = new Image();
      image.onload = () => {
        setMediaKind('image');
        setDuration(Math.max(2, ...captions.map((c) => c.end)));
        const media: LoadedMedia = { kind: 'image', image, duration: 0 };
        player.attach(media);
        setStatus('Photo loaded. Add captions and set their timing.');
      };
      image.src = url;
    }
  }, [captions]);

  // ---- caption CRUD ----
  const seekTo = useCallback((sec: number) => {
    playerRef.current?.scrubTo(sec);
    setCurrentSec(sec);
  }, []);

  const selectCaption = useCallback(
    (id: string) => {
      setSelectedId(id);
      const c = captions.find((x) => x.id === id);
      if (c) seekTo((c.start + c.end) / 2);
    },
    [captions, seekTo],
  );

  const addCaption = useCallback(() => {
    const total = mediaKind === 'video' ? duration : Math.max(duration, 4);
    const prevEnd = captions.reduce((m, c) => Math.max(m, c.end), 0);
    const start = Math.min(prevEnd, Math.max(0, total - 0.5));
    const end = Math.min(total || start + 2, start + 2);
    const cap = createCaption({
      text: `Caption ${captions.length + 1}`,
      start,
      end: end > start ? end : start + 2,
      x: 0.5,
      y: 0.72,
    });
    setCaptions((cs) => [...cs, cap]);
    setSelectedId(cap.id);
    seekTo((cap.start + cap.end) / 2);
  }, [captions, duration, mediaKind, seekTo]);

  const updateCaption = useCallback((id: string, patch: Partial<Caption>) => {
    setCaptions((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeCaption = useCallback(
    (id: string) => {
      setCaptions((cs) => cs.filter((c) => c.id !== id));
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [],
  );

  // ---- canvas drag-to-place + guides ----
  const normFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { nx: 0.5, ny: 0.5 };
    const rect = el.getBoundingClientRect();
    return {
      nx: (clientX - rect.left) / rect.width,
      ny: (clientY - rect.top) / rect.height,
    };
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
      const cap = captions.find((c) => c.id === hit)!;
      setSelectedId(hit);
      canvasDrag.current = { id: hit, grabDX: cap.x - nx, grabDY: cap.y - ny };
    },
    [captions, normFromPointer],
  );

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = canvasDrag.current;
      if (!d || e.buttons === 0) return;
      const { nx, ny } = normFromPointer(e.clientX, e.clientY);
      const sx = snap(nx + d.grabDX, SNAP_X, guidesOn);
      const sy = snap(ny + d.grabDY, SNAP_Y, guidesOn);
      setGuides({ x: sx.guide, y: sy.guide });
      updateCaption(d.id, {
        x: Math.max(0, Math.min(1, sx.v)),
        y: Math.max(0, Math.min(1, sy.v)),
      });
    },
    [guidesOn, normFromPointer, updateCaption],
  );

  const onCanvasPointerUp = useCallback((e: ReactPointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    canvasDrag.current = null;
    setGuides({ x: null, y: null });
  }, []);

  // ---- timeline ----
  const onChangeRange = useCallback(
    (id: string, start: number, end: number) => {
      updateCaption(id, { start, end });
    },
    [updateCaption],
  );

  const play = useCallback(() => {
    setSelectedId(null);
    playerRef.current?.playPreview();
  }, []);

  // ---- export ----
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
      setDownloadName(`captions.${ext}`);
      setStage('done');
      setProgress(1);
      if (ext === 'mp4') setStatus('Done — MP4 ready to download.');
    } catch (err) {
      console.error(err);
      setStage('error');
      setStatus('Export failed. See the console for details.');
    }
  }, [mediaKind]);

  const selDuration = selected ? Math.round((selected.end - selected.start) * 100) / 100 : 0;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
      {/* ---- Preview + timeline ---- */}
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
          <div ref={wrapRef} className="relative mx-auto max-w-[420px]">
            <canvas
              ref={canvasRef}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              className="w-full h-auto rounded-lg bg-black block touch-none"
              width={1080}
              height={1920}
            />
            {/* safe zones */}
            {showSafeZones && ratio === '9:16' && (
              <div className="pointer-events-none absolute inset-0 rounded-lg overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-[12%] bg-[rgba(255,0,80,0.1)] border-b border-[rgba(255,0,80,0.3)]" />
                <div className="absolute inset-x-0 bottom-0 h-[20%] bg-[rgba(255,0,80,0.1)] border-t border-[rgba(255,0,80,0.3)]" />
                <div className="absolute top-[12%] bottom-[20%] right-0 w-[7%] bg-[rgba(255,0,80,0.08)] border-l border-[rgba(255,0,80,0.25)]" />
              </div>
            )}
            {/* alignment guides */}
            {guides.x !== null && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#b57cff] shadow-[0_0_6px_#b57cff]"
                style={{ left: `${guides.x * 100}%` }}
              />
            )}
            {guides.y !== null && (
              <div
                className="pointer-events-none absolute left-0 right-0 h-px bg-[#b57cff] shadow-[0_0_6px_#b57cff]"
                style={{ top: `${guides.y * 100}%` }}
              />
            )}
            {!mediaKind && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Upload to preview
              </div>
            )}
          </div>

          {mediaKind && (
            <MultiTrackTimeline
              duration={mediaKind === 'video' ? duration : Math.max(2, ...captions.map((c) => c.end), duration)}
              captions={captions}
              currentSec={currentSec}
              selectedId={selectedId}
              rowColor={rowColor}
              onSelect={selectCaption}
              onChangeRange={onChangeRange}
              onScrub={seekTo}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={play}
              disabled={!mediaKind || busy}
              className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
            >
              ▶ Play preview
            </button>
            <button
              onClick={addCaption}
              disabled={!mediaKind || busy}
              className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
            >
              + Add caption
            </button>
            <button
              onClick={doExport}
              disabled={!mediaKind || busy}
              className="px-4 py-2 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold disabled:opacity-40 text-sm"
            >
              {busy ? 'Working…' : 'Export MP4'}
            </button>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={downloadName}
                className="px-4 py-2 rounded-md border border-[var(--color-primary-green)] text-[var(--color-primary-green)] text-sm font-medium"
              >
                ↓ Save {downloadName.endsWith('.mp4') ? 'MP4' : 'WebM'}
              </a>
            )}
          </div>

          {busy && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] transition-[width] duration-150"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}
          <p className="text-xs text-[var(--color-text-secondary)] mt-2 font-mono">{status}</p>
        </div>
      </section>

      {/* ---- Controls ---- */}
      <aside className="space-y-6">
        <Panel title="Output">
          <Field label="Aspect ratio">
            <div className="grid grid-cols-2 gap-2">
              {RATIO_LABELS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRatio(r.key)}
                  className={`px-2 py-2 rounded-md text-xs border text-left ${
                    ratio === r.key
                      ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                      : 'border-[var(--color-glass-border)]'
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
                    fillMode === m
                      ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                      : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  {m === 'crop' ? 'Crop to fill' : 'Blur pad'}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={guidesOn} onChange={(e) => setGuidesOn(e.target.checked)} />
              Guides
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showSafeZones} onChange={(e) => setShowSafeZones(e.target.checked)} />
              Safe zones
            </label>
          </div>
        </Panel>

        {selected ? (
          <Panel title={`Caption${captions.length > 1 ? ` ${captions.indexOf(selected) + 1}` : ''}`}>
            <Field label="Text (line breaks respected)">
              <textarea
                value={selected.text}
                rows={3}
                onChange={(e) => updateCaption(selected.id, { text: e.target.value })}
                className="input resize-y"
              />
            </Field>

            <Field label={`Duration — ${selDuration}s`}>
              <input
                type="number"
                min={0.2}
                max={Math.max(0.2, duration || 60)}
                step={0.1}
                value={selDuration}
                onChange={(e) => {
                  const d = Math.max(0.2, Number(e.target.value) || 0.2);
                  updateCaption(selected.id, { end: selected.start + d });
                }}
                className="input"
              />
            </Field>

            <Field label="Font boil">
              <div className="grid grid-cols-3 gap-1.5">
                {(['off', 'intro', 'continuous'] as BoilMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => updateCaption(selected.id, { boil: m })}
                    className={`px-1 py-2 rounded-md text-[11px] border capitalize ${
                      selected.boil === m
                        ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                        : 'border-[var(--color-glass-border)]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Settle font">
              <select
                value={selected.settleFontIndex}
                onChange={(e) => updateCaption(selected.id, { settleFontIndex: Number(e.target.value) })}
                className="input"
              >
                {BOIL_FONTS.map((f, i) => (
                  <option key={f.family} value={i}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Color">
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => updateCaption(selected.id, { color: e.target.value })}
                  className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
                />
              </Field>
              <Field label={`Size — ${selected.sizeScale.toFixed(1)}×`}>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  value={selected.sizeScale}
                  onChange={(e) => updateCaption(selected.id, { sizeScale: Number(e.target.value) })}
                  className="w-full accent-[var(--color-primary-green)]"
                />
              </Field>
            </div>

            <Field label="Alignment">
              <div className="grid grid-cols-3 gap-1.5">
                {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => updateCaption(selected.id, { align: a })}
                    className={`px-1 py-2 rounded-md text-[11px] border capitalize ${
                      selected.align === a
                        ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                        : 'border-[var(--color-glass-border)]'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Legibility">
              <div className="grid grid-cols-3 gap-1.5">
                {(['outline', 'shadow', 'none'] as Legibility[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => updateCaption(selected.id, { legibility: l })}
                    className={`px-1 py-2 rounded-md text-[11px] border capitalize ${
                      selected.legibility === l
                        ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                        : 'border-[var(--color-glass-border)]'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>

            <button
              onClick={() => removeCaption(selected.id)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
            >
              Remove caption
            </button>
          </Panel>
        ) : (
          <Panel title="Captions">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {mediaKind ? 'Select a caption on the timeline or canvas to edit it, or add a new one.' : 'Upload a photo or video to begin.'}
            </p>
            <button
              onClick={addCaption}
              disabled={!mediaKind}
              className="w-full px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
            >
              + Add caption
            </button>
          </Panel>
        )}
      </aside>
    </div>
  );
}

// ---- local presentational helpers ----

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">
        {title}
      </h2>
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
