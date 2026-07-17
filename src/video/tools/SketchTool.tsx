import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { SketchPlayer } from '../sketch/SketchPlayer';
import type { LoadedMedia, SketchState } from '../sketch/SketchPlayer';
import SketchPad from '../sketch/SketchPad';
import SketchTimeline from '../sketch/SketchTimeline';
import SketchRectEditor from '../sketch/SketchRectEditor';
import { createSketch, elementEnd } from '../sketch/types';
import type { SketchElement, SketchStroke } from '../sketch/types';
import { outputSizeFor } from '../render';
import { RATIOS } from '../types';
import type { FillMode, RatioKey } from '../types';
import { transcodeToMp4, ensureFFmpeg } from '../ffmpeg';

type MediaKind = 'video' | 'image' | null;
type ExportStage = 'idle' | 'recording' | 'preparing' | 'encoding' | 'done' | 'error';

const RATIO_LABELS: { key: RatioKey; label: string; hint: string }[] = [
  { key: '9:16', label: '9:16', hint: 'Shorts / Reels / TikTok' },
  { key: '1:1', label: '1:1', hint: 'Square' },
  { key: '4:5', label: '4:5', hint: 'Portrait feed' },
  { key: 'original', label: 'Original', hint: 'No conversion' },
];

const ROW_COLORS = ['#c4a7fb', '#8be9c7', '#74b9ff', '#ffeaa7', '#ff9ff3', '#ffa07a'];
const rowColor = (i: number) => ROW_COLORS[i % ROW_COLORS.length];

export default function SketchTool() {
  const [mediaKind, setMediaKind] = useState<MediaKind>(null);
  const [duration, setDuration] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [srcDims, setSrcDims] = useState({ w: 0, h: 0 });

  const [elements, setElements] = useState<SketchElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SketchElement | null>(() => createSketch());

  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('crop');
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [sfxVolume, setSfxVolume] = useState(0.5);

  const [pen, setPen] = useState({ color: '#ff4d4d', width: 0.02, smoothness: 0.8 });

  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Draw on the pad, then upload a photo or video to project onto.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('sketch.mp4');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<SketchPlayer | null>(null);
  const stateRef = useRef<SketchState>({ elements: [], fillMode: 'crop', ratio: '9:16', sfxEnabled: true, sfxVolume: 0.5 });
  const objectUrls = useRef<string[]>([]);

  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const current = selected ?? draft;
  const editable = !selected && !!draft; // draft mode = drawing new strokes

  const out = srcDims.w > 0 ? outputSizeFor(ratio, srcDims.w, srcDims.h) : ratio === 'original' ? { w: 1080, h: 1920 } : RATIOS[ratio];
  const outAR = out.w / out.h;
  const padAspect = selected ? selected.padAspect : outAR;

  const stateSnapshot: SketchState = useMemo(
    () => ({ elements, fillMode, ratio, sfxEnabled, sfxVolume }),
    [elements, fillMode, ratio, sfxEnabled, sfxVolume],
  );
  useEffect(() => {
    stateRef.current = stateSnapshot;
    playerRef.current?.renderStatic();
  }, [stateSnapshot]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const player = new SketchPlayer(canvasRef.current, () => stateRef.current, (sec) => setCurrentSec(sec));
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
        setSrcDims({ w: video.videoWidth, h: video.videoHeight });
        const media: LoadedMedia = { kind: 'video', video, duration: video.duration };
        player.attach(media);
        setStatus('Loaded. Draw a sketch and press “Project onto video”.');
      });
    } else if (file.type.startsWith('image')) {
      const image = new Image();
      image.onload = () => {
        setMediaKind('image');
        setSrcDims({ w: image.naturalWidth, h: image.naturalHeight });
        setDuration(Math.max(3, ...elements.map(elementEnd)));
        const media: LoadedMedia = { kind: 'image', image, duration: 0 };
        player.attach(media);
        setStatus('Photo loaded. Draw a sketch and press “Project onto video”.');
      };
      image.src = url;
    }
  }, [elements]);

  const timelineDuration = mediaKind === 'video' ? duration : Math.max(3, ...elements.map(elementEnd), duration);

  // ---- current-sketch editing (draft or selected element) ----
  const updateCurrent = useCallback(
    (patch: Partial<SketchElement>) => {
      if (selected) setElements((es) => es.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)));
      else setDraft((d) => (d ? { ...d, ...patch } : d));
    },
    [selected],
  );

  const updateElement = useCallback((id: string, patch: Partial<SketchElement>) => {
    setElements((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const commitStroke = useCallback((s: SketchStroke) => {
    setDraft((d) => (d ? { ...d, strokes: [...d.strokes, s] } : d));
  }, []);

  const undoStroke = useCallback(() => {
    setDraft((d) => (d ? { ...d, strokes: d.strokes.slice(0, -1) } : d));
  }, []);

  const clearStrokes = useCallback(() => {
    setDraft((d) => (d ? { ...d, strokes: [] } : d));
  }, []);

  const newSketch = useCallback(() => {
    setSelectedId(null);
    setDraft(createSketch({ padAspect: outAR }));
  }, [outAR]);

  // Seek to a moment where the element is fully drawn (its freeze), for placement.
  const freezeMoment = useCallback((el: SketchElement) => el.start + el.animationDur + Math.min(0.3, el.freezeDur / 2), []);

  const selectElement = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDraft(null);
      const el = elements.find((e) => e.id === id);
      if (el) {
        const t = freezeMoment(el);
        playerRef.current?.scrubTo(t);
        setCurrentSec(t);
      }
    },
    [elements, freezeMoment],
  );

  const project = useCallback(() => {
    if (!draft || draft.strokes.length === 0) return;
    const len = draft.animationDur + draft.freezeDur;
    const prevEnd = elements.reduce((m, e) => Math.max(m, elementEnd(e)), 0);
    const start = Math.max(0, Math.min(prevEnd, Math.max(0, timelineDuration - len)));
    const el: SketchElement = { ...draft, padAspect: outAR, x: 0, y: 0, w: 1, h: 1, start };
    setElements((es) => [...es, el]);
    setSelectedId(el.id);
    setDraft(null);
    const t = freezeMoment(el);
    playerRef.current?.scrubTo(t);
    setCurrentSec(t);
    setStatus('Projected. Drag the box to place/resize; edit timing on the row below.');
  }, [draft, elements, freezeMoment, outAR, timelineDuration]);

  const removeElement = useCallback((id: string) => {
    setElements((es) => es.filter((e) => e.id !== id));
    setSelectedId((s) => (s === id ? null : s));
    setDraft((d) => d ?? createSketch());
  }, []);

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

  const onCanvasPointerDown = useCallback((e: ReactPointerEvent) => {
    const player = playerRef.current;
    const el = canvasRef.current;
    if (!player || !el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const hit = player.hitTest(nx, ny);
    if (hit) selectElement(hit);
  }, [selectElement]);

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
      setDownloadName(`sketch.${ext}`);
      setStage('done');
      setProgress(1);
      if (ext === 'mp4') setStatus('Done — MP4 ready to download.');
    } catch (err) {
      console.error(err);
      setStage('error');
      setStatus('Export failed. See the console for details.');
    }
  }, [mediaKind]);

  const animDur = current ? Math.round(current.animationDur * 100) / 100 : 0;
  const freezeDur = current ? Math.round(current.freezeDur * 100) / 100 : 0;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-8 items-start">
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
            {selected && mediaKind && srcDims.w > 0 && (
              <SketchRectEditor rect={{ x: selected.x, y: selected.y, w: selected.w, h: selected.h }} padAspect={selected.padAspect} out={out} onChange={onRectChange} />
            )}
            {!mediaKind && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Upload to preview
              </div>
            )}
          </div>

          {mediaKind && (
            <SketchTimeline
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
          </Field>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={sfxEnabled} onChange={(e) => setSfxEnabled(e.target.checked)} />
            Sound effects (pencil-on-paper during drawing)
          </label>
          {sfxEnabled && (
            <Field label={`SFX volume — ${Math.round(sfxVolume * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={sfxVolume} onChange={(e) => setSfxVolume(Number(e.target.value))} className="w-full accent-[var(--color-primary-green)]" />
            </Field>
          )}
        </Panel>

        <Panel title={selected ? `Sketch ${elements.indexOf(selected) + 1} (strokes locked)` : 'Drawing pad'}>
          <SketchPad
            strokes={current?.strokes ?? []}
            padAspect={padAspect}
            editable={editable}
            pen={pen}
            onCommitStroke={commitStroke}
            animationDur={current?.animationDur ?? 0}
            tracer={current?.tracer ?? true}
          />

          {editable ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={undoStroke} disabled={!draft || draft.strokes.length === 0} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)] disabled:opacity-40">
                  Undo stroke
                </button>
                <button onClick={clearStrokes} disabled={!draft || draft.strokes.length === 0} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)] disabled:opacity-40">
                  Clear pad
                </button>
              </div>
              <button
                onClick={project}
                disabled={!mediaKind || !draft || draft.strokes.length === 0}
                className="w-full px-3 py-2 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold disabled:opacity-40 text-sm"
              >
                ＋ Project onto video
              </button>
              {!mediaKind && <p className="text-[10px] text-[var(--color-text-muted)] text-center">Upload a photo or video to project.</p>}
            </>
          ) : (
            <button onClick={newSketch} className="w-full px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium">
              ＋ New sketch
            </button>
          )}
        </Panel>

        {editable && (
          <Panel title="Pen">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Color">
                <input type="color" value={pen.color} onChange={(e) => setPen((p) => ({ ...p, color: e.target.value }))} className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5" />
              </Field>
              <Field label={`Width — ${Math.round(pen.width * 1000)}`}>
                <input type="range" min={0.006} max={0.06} step={0.002} value={pen.width} onChange={(e) => setPen((p) => ({ ...p, width: Number(e.target.value) }))} className="w-full accent-[var(--color-primary-green)]" />
              </Field>
            </div>
            <Field label={`Pixelated ↔ Smooth — ${Math.round(pen.smoothness * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} value={pen.smoothness} onChange={(e) => setPen((p) => ({ ...p, smoothness: Number(e.target.value) }))} className="w-full accent-[var(--color-primary-green)]" />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Applies to the next stroke — each stroke keeps its own style.</p>
            </Field>
          </Panel>
        )}

        {current && (
          <Panel title={selected ? `Timing · Sketch ${elements.indexOf(selected) + 1}` : 'Timing · draft'}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Animation — ${animDur}s`}>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.1}
                  value={animDur}
                  onChange={(e) => updateCurrent({ animationDur: Math.max(0, Number(e.target.value) || 0) })}
                  className="input"
                />
              </Field>
              <Field label={`Freeze — ${freezeDur}s`}>
                <input
                  type="number"
                  min={0.2}
                  max={60}
                  step={0.1}
                  value={freezeDur}
                  onChange={(e) => updateCurrent({ freezeDur: Math.max(0.2, Number(e.target.value) || 0.2) })}
                  className="input"
                />
              </Field>
            </div>
            {current.animationDur === 0 && (
              <p className="text-[10px] text-[var(--color-text-muted)]">Animation 0s → the completed drawing shows immediately (static), no tracer or pencil sound.</p>
            )}
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={current.tracer} onChange={(e) => updateCurrent({ tracer: e.target.checked })} />
              Pencil-tip tracer (during animation)
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={current.sound} onChange={(e) => updateCurrent({ sound: e.target.checked })} />
              Pencil sound (during animation)
            </label>
            {selected && (
              <button
                onClick={() => removeElement(selected.id)}
                className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
              >
                Remove sketch
              </button>
            )}
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
