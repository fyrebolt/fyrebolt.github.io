import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ZoomPlayer } from '../zoom/ZoomPlayer';
import type { LoadedMedia, ZoomState } from '../zoom/ZoomPlayer';
import ZoomTimeline from '../zoom/ZoomTimeline';
import ZoomRectEditor from '../zoom/ZoomRectEditor';
import { createZoom } from '../zoom/types';
import type { ZoomKeyframe, ZoomRect } from '../zoom/types';
import { outputSizeFor } from '../render';
import { transcodeToMp4, ensureFFmpeg } from '../ffmpeg';
import type { RatioKey } from '../types';

type ExportStage = 'idle' | 'recording' | 'preparing' | 'encoding' | 'done' | 'error';

const RATIO_LABELS: { key: RatioKey; label: string; hint: string }[] = [
  { key: 'original', label: 'Original', hint: 'Keep the photo' },
  { key: '9:16', label: '9:16', hint: 'Shorts / Reels' },
  { key: '1:1', label: '1:1', hint: 'Square' },
  { key: '4:5', label: '4:5', hint: 'Portrait feed' },
];

/** A centred crop at the output aspect ratio, ~65% scale — a clean default zoom-in. */
function defaultZoomRect(srcW: number, srcH: number, ratio: RatioKey): ZoomRect {
  if (srcW <= 0 || srcH <= 0) return { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
  const out = outputSizeFor(ratio, srcW, srcH);
  const outAR = out.w / out.h;
  const srcAR = srcW / srcH;
  const wOverH = outAR / srcAR;
  let w: number;
  let h: number;
  if (wOverH >= 1) {
    w = 0.65;
    h = w / wOverH;
  } else {
    h = 0.65;
    w = h * wOverH;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export default function StaticZoomTool() {
  const [loaded, setLoaded] = useState(false);
  const [total, setTotal] = useState(6);
  const [currentSec, setCurrentSec] = useState(0);
  const [srcDims, setSrcDims] = useState({ w: 0, h: 0 });

  const [keyframes, setKeyframes] = useState<ZoomKeyframe[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [ratio, setRatio] = useState<RatioKey>('original');
  const [sfxVolume, setSfxVolume] = useState(0.5);

  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo, set the total length, then add a zoom.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('static-zoom.mp4');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<ZoomPlayer | null>(null);
  const stateRef = useRef<ZoomState>({ keyframes: [], ratio: 'original', sfxVolume: 0.5, imageDuration: 6 });
  const objectUrls = useRef<string[]>([]);
  const editingRef = useRef(false);

  const selected = keyframes.find((k) => k.id === selectedId) ?? null;

  const stateSnapshot: ZoomState = useMemo(
    () => ({ keyframes, ratio, sfxVolume, imageDuration: total }),
    [keyframes, ratio, sfxVolume, total],
  );
  useEffect(() => {
    stateRef.current = stateSnapshot;
    const p = playerRef.current;
    if (!p) return;
    if (editingRef.current) p.redrawEdit();
    else p.renderStatic();
  }, [stateSnapshot]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const player = new ZoomPlayer(canvasRef.current, () => stateRef.current, (sec) => setCurrentSec(sec));
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

  const setEditingBoth = (v: boolean) => {
    editingRef.current = v;
    setEditing(v);
  };

  const onFile = useCallback((file: File) => {
    const player = playerRef.current;
    if (!player) return;
    if (!file.type.startsWith('image')) {
      setStatus('This tool is for photos — use the Zoom tool for videos.');
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    setDownloadUrl(null);
    setStage('idle');
    setProgress(0);
    setKeyframes([]);
    setSelectedId(null);
    setEditingBoth(false);

    const image = new Image();
    image.onload = () => {
      setLoaded(true);
      setSrcDims({ w: image.naturalWidth, h: image.naturalHeight });
      const media: LoadedMedia = { kind: 'image', image, duration: 0 };
      player.attach(media);
      setStatus('Photo loaded. Add a zoom, drag its crop rectangle, and position it on the timeline.');
    };
    image.src = url;
  }, []);

  const landingOf = useCallback((kf: ZoomKeyframe) => Math.min(kf.start + kf.duration, total), [total]);

  const selectKeyframe = useCallback(
    (id: string) => {
      setSelectedId(id);
      const kf = keyframes.find((k) => k.id === id);
      if (kf) {
        setEditingBoth(true);
        playerRef.current?.editAt(landingOf(kf));
        setCurrentSec(landingOf(kf));
      }
    },
    [keyframes, landingOf],
  );

  const addKeyframe = useCallback(
    (rect: ZoomRect) => {
      const isFirst = keyframes.length === 0;
      const prevEnd = keyframes.reduce((m, k) => Math.max(m, k.start + k.duration), 0);
      // First zoom: centre it so you get equal hold / zoom / hold (the classic look).
      const dur = isFirst ? Math.min(3, total * 0.5) : 1;
      const start = isFirst
        ? Math.max(0, (total - dur) / 2)
        : Math.min(prevEnd + 0.3, Math.max(0, total - 0.5));
      const kf = createZoom({ start, duration: dur, rect });
      setKeyframes((ks) => [...ks, kf]);
      setSelectedId(kf.id);
      setEditingBoth(true);
      playerRef.current?.editAt(Math.min(start + dur, total));
      setCurrentSec(Math.min(start + dur, total));
    },
    [keyframes, total],
  );

  const addZoom = useCallback(
    () => addKeyframe(defaultZoomRect(srcDims.w, srcDims.h, ratio)),
    [addKeyframe, ratio, srcDims],
  );
  const addUnzoom = useCallback(() => addKeyframe({ x: 0, y: 0, w: 1, h: 1 }), [addKeyframe]);

  const updateKeyframe = useCallback((id: string, patch: Partial<ZoomKeyframe>) => {
    setKeyframes((ks) => ks.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  }, []);

  const removeKeyframe = useCallback((id: string) => {
    setKeyframes((ks) => ks.filter((k) => k.id !== id));
    setSelectedId((s) => (s === id ? null : s));
    setEditingBoth(false);
    playerRef.current?.exitEdit();
  }, []);

  const onRectChange = useCallback(
    (rect: ZoomRect) => {
      if (selectedId) updateKeyframe(selectedId, { rect });
    },
    [selectedId, updateKeyframe],
  );

  const onScrub = useCallback((sec: number) => {
    setCurrentSec(sec);
    if (editingRef.current) playerRef.current?.editAt(sec);
    else playerRef.current?.scrubTo(sec);
  }, []);

  const play = useCallback(() => {
    setSelectedId(null);
    setEditingBoth(false);
    playerRef.current?.playPreview();
  }, []);

  const busy = stage === 'recording' || stage === 'preparing' || stage === 'encoding';

  const doExport = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !loaded) return;
    if (typeof MediaRecorder === 'undefined') {
      setStatus('Recording is not supported in this browser.');
      return;
    }
    setSelectedId(null);
    setEditingBoth(false);
    setDownloadUrl(null);
    setStage('recording');
    setProgress(0);
    setStatus('Recording…');
    try {
      const totalLen = player.totalSec();
      const webm = await player.record((sec) => setProgress(Math.min(0.99, sec / Math.max(0.1, totalLen))));
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
      setDownloadName(`static-zoom.${ext}`);
      setStage('done');
      setProgress(1);
      if (ext === 'mp4') setStatus('Done — MP4 ready to download.');
    } catch (err) {
      console.error(err);
      setStage('error');
      setStatus('Export failed. See the console for details.');
    }
  }, [loaded]);

  const out = srcDims.w > 0 ? outputSizeFor(ratio, srcDims.w, srcDims.h) : { w: 1080, h: 1920 };
  const selDur = selected ? Math.round(selected.duration * 100) / 100 : 0;
  const selStart = selected ? Math.round(selected.start * 100) / 100 : 0;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
      <section>
        <label className="block glass-card p-4 mb-4 cursor-pointer hover:bg-[var(--color-glass-hover)] transition-colors">
          <span className="text-sm font-medium">Photo</span>
          <input
            type="file"
            accept="image/*"
            className="block mt-2 text-sm text-[var(--color-text-secondary)] file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-[var(--color-bg-elevated)] file:text-[var(--color-text-primary)]"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>

        <div className="glass-card p-3">
          <div className="relative mx-auto max-w-[420px]">
            <canvas ref={canvasRef} className="w-full h-auto rounded-lg bg-black block" width={1080} height={1920} />
            {editing && selected && loaded && srcDims.w > 0 && (
              <ZoomRectEditor rect={selected.rect} srcW={srcDims.w} srcH={srcDims.h} out={out} onChange={onRectChange} />
            )}
            {!loaded && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Upload a photo to preview
              </div>
            )}
          </div>

          {editing && (
            <p className="text-[11px] text-[var(--color-primary-green)] mt-2 text-center">
              Editing zoom rectangle — you're seeing the full photo. Drag the box; it snaps to centre / output ratio.
            </p>
          )}

          {loaded && (
            <ZoomTimeline
              duration={total}
              keyframes={keyframes}
              currentSec={currentSec}
              selectedId={selectedId}
              onSelect={selectKeyframe}
              onEdit={updateKeyframe}
              onScrub={onScrub}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button onClick={play} disabled={!loaded || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              ▶ Play preview
            </button>
            <button onClick={addZoom} disabled={!loaded || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              + Zoom in
            </button>
            <button onClick={addUnzoom} disabled={!loaded || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
              + Unzoom
            </button>
            <button onClick={doExport} disabled={!loaded || busy || keyframes.length === 0} className="px-4 py-2 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold disabled:opacity-40 text-sm">
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
          <Field label={`Total length — ${Math.round(total * 100) / 100}s`}>
            <input
              type="number"
              min={0.5}
              max={120}
              step={0.5}
              value={Math.round(total * 100) / 100}
              onChange={(e) => setTotal(Math.max(0.5, Number(e.target.value) || 0.5))}
              className="input"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              The whole clip's length. Holds before/after your zooms fill the rest.
            </p>
          </Field>
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
          <Field label={`Whoosh volume — ${Math.round(sfxVolume * 100)}%`}>
            <input type="range" min={0} max={1} step={0.05} value={sfxVolume} onChange={(e) => setSfxVolume(Number(e.target.value))} className="w-full accent-[var(--color-primary-green)]" />
          </Field>
        </Panel>

        {selected ? (
          <Panel title={`Zoom ${keyframes.map((k) => k.id).indexOf(selected.id) + 1}`}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Start — ${selStart}s`}>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, total)}
                  step={0.1}
                  value={selStart}
                  onChange={(e) => updateKeyframe(selected.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                  className="input"
                />
              </Field>
              <Field label={`Zoom time — ${selDur}s`}>
                <input
                  type="number"
                  min={0.1}
                  max={Math.max(0.1, total)}
                  step={0.1}
                  value={selDur}
                  onChange={(e) => updateKeyframe(selected.id, { duration: Math.max(0.1, Number(e.target.value) || 0.1) })}
                  className="input"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => updateKeyframe(selected.id, { rect: defaultZoomRect(srcDims.w, srcDims.h, ratio) })}
                className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]"
              >
                Fit output ratio
              </button>
              <button
                onClick={() => updateKeyframe(selected.id, { rect: { x: 0, y: 0, w: 1, h: 1 } })}
                className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]"
              >
                Full frame
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={selected.whoosh} onChange={(e) => updateKeyframe(selected.id, { whoosh: e.target.checked })} />
              Whoosh at this zoom
            </label>

            <button
              onClick={() => removeKeyframe(selected.id)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
            >
              Remove zoom
            </button>
          </Panel>
        ) : (
          <Panel title="Zooms">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {loaded
                ? 'Add a zoom, drag its crop rectangle on the photo, then drag it on the timeline to set when it happens. Add an "Unzoom" to pull back out.'
                : 'Upload a photo to begin.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={addZoom} disabled={!loaded} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                + Zoom in
              </button>
              <button onClick={addUnzoom} disabled={!loaded} className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                + Unzoom
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
