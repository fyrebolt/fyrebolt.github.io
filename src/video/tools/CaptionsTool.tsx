import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { CaptionsPlayer } from '../captions/CaptionsPlayer';
import type { CaptionsState, LoadedMedia } from '../captions/CaptionsPlayer';
import { FONT_POOLS, poolById, preloadAllFontPools, ALL_FONTS } from '../captions/fonts';
import type { BoilPoolId } from '../captions/fonts';
import {
  createCaption,
  createTypewriter,
  createAttachment,
  captionWords,
  staticWindowOf,
  elementEnd,
} from '../captions/types';
import type {
  Attachment,
  AttachmentType,
  BoilMode,
  Caption,
  CaptionEl,
  DeleteStyle,
  Legibility,
  TextAlign,
  TypewriterCaption,
} from '../captions/types';
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

  const [captions, setCaptions] = useState<CaptionEl[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);

  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('crop');
  const [guidesOn, setGuidesOn] = useState(true);
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [boilPool, setBoilPool] = useState<BoilPoolId>('default');
  const [normalize, setNormalize] = useState(true);
  const [sfxEnabled, setSfxEnabled] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(0.5);

  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo or video, then add captions.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('captions.mp4');

  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<CaptionsPlayer | null>(null);
  const stateRef = useRef<CaptionsState>({
    captions: [],
    fillMode: 'crop',
    ratio: '9:16',
    boilPool: 'default',
    normalize: true,
    sfxEnabled: false,
    sfxVolume: 0.5,
  });
  const objectUrls = useRef<string[]>([]);
  const canvasDrag = useRef<{ id: string; grabDX: number; grabDY: number } | null>(null);

  const selected = captions.find((c) => c.id === selectedId) ?? null;
  const selectedStatic = selected ? staticWindowOf(selected) : null;
  const selectedAttachment = selected?.attachments.find((a) => a.id === selectedAttachmentId) ?? null;

  // Preload every font pool up front (so switching pools is instant).
  useEffect(() => {
    preloadAllFontPools().then(() => playerRef.current?.renderStatic());
  }, []);

  // Keep the player's state source current, and redraw when edits change the frame.
  const stateSnapshot: CaptionsState = useMemo(
    () => ({ captions, fillMode, ratio, boilPool, normalize, sfxEnabled, sfxVolume }),
    [captions, fillMode, ratio, boilPool, normalize, sfxEnabled, sfxVolume],
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
        setDuration(Math.max(2, ...captions.map(elementEnd)));
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

  // Seek to a moment where the element is fully on screen (for placement).
  const midOf = useCallback((el: CaptionEl): number => {
    if (el.kind === 'boil') return (el.start + el.end) / 2;
    return el.start + el.typingDur + Math.min(0.3, el.holdDur / 2);
  }, []);

  const selectCaption = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSelectedAttachmentId(null);
      const c = captions.find((x) => x.id === id);
      if (c) seekTo(midOf(c));
    },
    [captions, midOf, seekTo],
  );

  const staggerStart = useCallback(() => {
    const total = mediaKind === 'video' ? duration : Math.max(duration, 4);
    const prevEnd = captions.reduce((m, c) => Math.max(m, elementEnd(c)), 0);
    return Math.min(prevEnd, Math.max(0, total - 0.5));
  }, [captions, duration, mediaKind]);

  const addBoil = useCallback(() => {
    const start = staggerStart();
    const cap = createCaption({ text: `Caption ${captions.length + 1}`, start, end: start + 2, x: 0.5, y: 0.72 });
    setCaptions((cs) => [...cs, cap]);
    setSelectedId(cap.id);
    seekTo(midOf(cap));
  }, [captions.length, midOf, seekTo, staggerStart]);

  const addTypewriter = useCallback(() => {
    const start = staggerStart();
    const cap = createTypewriter({ text: 'Typewriter', start, x: 0.5, y: 0.72 });
    setCaptions((cs) => [...cs, cap]);
    setSelectedId(cap.id);
    seekTo(midOf(cap));
  }, [midOf, seekTo, staggerStart]);

  const updateCaption = useCallback((id: string, patch: Partial<Caption> | Partial<TypewriterCaption>) => {
    setCaptions((cs) => cs.map((c) => (c.id === id ? ({ ...c, ...patch } as CaptionEl) : c)));
  }, []);

  const removeCaption = useCallback(
    (id: string) => {
      setCaptions((cs) => cs.filter((c) => c.id !== id));
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [],
  );

  // ---- attachments (highlight / underline over static words) ----

  /** Seek to a moment when an attachment is on screen (mid of its lifetime). */
  const attachMid = useCallback((cap: CaptionEl, att: Attachment): number => {
    const sw = staticWindowOf(cap);
    if (!sw) return midOf(cap);
    const t = sw.start + att.startInStatic + att.duration / 2;
    return Math.max(sw.start, Math.min(sw.end - 0.01, t));
  }, [midOf]);

  const addAttachment = useCallback(
    (capId: string, type: AttachmentType) => {
      const cap = captions.find((c) => c.id === capId);
      if (!cap) return;
      const sw = staticWindowOf(cap);
      if (!sw) return;
      const swLen = sw.end - sw.start;
      const duration = Math.max(0.2, Math.min(1.2, swLen));
      const att = createAttachment({ type, duration, startInStatic: 0, wordStart: 0, wordEnd: 0 });
      setCaptions((cs) =>
        cs.map((c) => (c.id === capId ? ({ ...c, attachments: [...c.attachments, att] } as CaptionEl) : c)),
      );
      setSelectedId(capId);
      setSelectedAttachmentId(att.id);
      seekTo(attachMid(cap, att));
    },
    [captions, seekTo, attachMid],
  );

  const updateAttachment = useCallback((capId: string, attId: string, patch: Partial<Attachment>) => {
    setCaptions((cs) =>
      cs.map((c) =>
        c.id === capId
          ? ({ ...c, attachments: c.attachments.map((a) => (a.id === attId ? { ...a, ...patch } : a)) } as CaptionEl)
          : c,
      ),
    );
  }, []);

  const removeAttachment = useCallback((capId: string, attId: string) => {
    setCaptions((cs) =>
      cs.map((c) =>
        c.id === capId ? ({ ...c, attachments: c.attachments.filter((a) => a.id !== attId) } as CaptionEl) : c,
      ),
    );
    setSelectedAttachmentId((sel) => (sel === attId ? null : sel));
  }, []);

  const selectAttachment = useCallback(
    (capId: string, attId: string) => {
      setSelectedId(capId);
      setSelectedAttachmentId(attId);
      const cap = captions.find((c) => c.id === capId);
      const att = cap?.attachments.find((a) => a.id === attId);
      if (cap && att) seekTo(attachMid(cap, att));
    },
    [captions, seekTo, attachMid],
  );

  // Switching pool globally: clamp each caption's settle-font index into the new pool.
  const changeBoilPool = useCallback((id: BoilPoolId) => {
    setBoilPool(id);
    const len = poolById(id).fonts.length;
    setCaptions((cs) =>
      cs.map((c) => (c.kind === 'boil' && c.settleFontIndex >= len ? { ...c, settleFontIndex: len - 1 } : c)),
    );
  }, []);

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
              duration={mediaKind === 'video' ? duration : Math.max(2, ...captions.map(elementEnd), duration)}
              captions={captions}
              currentSec={currentSec}
              selectedId={selectedId}
              selectedAttachmentId={selectedAttachmentId}
              rowColor={rowColor}
              onSelect={selectCaption}
              onEdit={updateCaption}
              onSelectAttachment={selectAttachment}
              onEditAttachment={updateAttachment}
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
              onClick={addBoil}
              disabled={!mediaKind || busy}
              className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
            >
              + Caption
            </button>
            <button
              onClick={addTypewriter}
              disabled={!mediaKind || busy}
              className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
            >
              + Typewriter
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
            <div className="grid grid-cols-3 gap-2">
              {(['crop', 'fit', 'blur'] as FillMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setFillMode(m)}
                  className={`px-2 py-2 rounded-md text-xs border ${
                    fillMode === m
                      ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                      : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  {m === 'crop' ? 'Crop' : m === 'fit' ? 'Fit' : 'Blur'}
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

        <Panel title="Font boil">
          <Field label="Font pool (applies to all captions)">
            <div className="grid grid-cols-3 gap-1.5">
              {FONT_POOLS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => changeBoilPool(p.id)}
                  className={`px-1 py-2 rounded-md text-[11px] border ${
                    boilPool === p.id
                      ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                      : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
            Even sizing (normalize each font to a consistent height)
          </label>
        </Panel>

        <Panel title="Sound effects">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={sfxEnabled} onChange={(e) => setSfxEnabled(e.target.checked)} />
            Enable (riffle on font-boil, key-clicks on typewriter)
          </label>
          {sfxEnabled && (
            <Field label={`SFX volume — ${Math.round(sfxVolume * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sfxVolume}
                onChange={(e) => setSfxVolume(Number(e.target.value))}
                className="w-full accent-[var(--color-primary-green)]"
              />
            </Field>
          )}
        </Panel>

        {selected ? (
          <Panel
            title={`${selected.kind === 'typewriter' ? 'Typewriter' : 'Caption'} ${captions.indexOf(selected) + 1}`}
          >
            <Field label="Text (line breaks respected)">
              <textarea
                value={selected.text}
                rows={3}
                onChange={(e) => updateCaption(selected.id, { text: e.target.value })}
                className="input resize-y"
              />
            </Field>

            {selected.kind === 'boil' ? (
              <>
                <Field label={`Duration — ${Math.round((selected.end - selected.start) * 100) / 100}s`}>
                  <input
                    type="number"
                    min={0.2}
                    max={Math.max(0.2, duration || 60)}
                    step={0.1}
                    value={Math.round((selected.end - selected.start) * 100) / 100}
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
                    value={Math.min(selected.settleFontIndex, poolById(boilPool).fonts.length - 1)}
                    onChange={(e) => updateCaption(selected.id, { settleFontIndex: Number(e.target.value) })}
                    className="input"
                  >
                    {poolById(boilPool).fonts.map((f, i) => (
                      <option key={f.family} value={i}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field label="Font">
                  <select
                    value={selected.fontKey}
                    onChange={(e) => updateCaption(selected.id, { fontKey: e.target.value })}
                    className="input"
                  >
                    {ALL_FONTS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} · {f.poolLabel}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Typing — ${selected.typingDur.toFixed(1)}s`}>
                    <input
                      type="number"
                      min={0.2}
                      max={Math.max(0.2, duration || 60)}
                      step={0.1}
                      value={Math.round(selected.typingDur * 100) / 100}
                      onChange={(e) => updateCaption(selected.id, { typingDur: Math.max(0.2, Number(e.target.value) || 0.2) })}
                      className="input"
                    />
                  </Field>
                  <Field label={`Hold — ${selected.holdDur.toFixed(1)}s`}>
                    <input
                      type="number"
                      min={0.2}
                      max={Math.max(0.2, duration || 60)}
                      step={0.1}
                      value={Math.round(selected.holdDur * 100) / 100}
                      onChange={(e) => updateCaption(selected.id, { holdDur: Math.max(0.2, Number(e.target.value) || 0.2) })}
                      className="input"
                    />
                  </Field>
                </div>

                <Field label="Deletion">
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] mb-2">
                    <input
                      type="checkbox"
                      checked={selected.deleteEnabled}
                      onChange={(e) => updateCaption(selected.id, { deleteEnabled: e.target.checked })}
                    />
                    Enable (otherwise it cuts at end of hold)
                  </label>
                  {selected.deleteEnabled && (
                    <>
                      <div className="grid grid-cols-2 gap-1.5 mb-2">
                        {([['char', 'Backspace'], ['selectAll', 'Select all']] as [DeleteStyle, string][]).map(
                          ([v, lbl]) => (
                            <button
                              key={v}
                              onClick={() => updateCaption(selected.id, { deleteStyle: v })}
                              className={`px-1 py-2 rounded-md text-[11px] border ${
                                selected.deleteStyle === v
                                  ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                                  : 'border-[var(--color-glass-border)]'
                              }`}
                            >
                              {lbl}
                            </button>
                          ),
                        )}
                      </div>
                      <input
                        type="number"
                        min={0.2}
                        max={Math.max(0.2, duration || 60)}
                        step={0.1}
                        value={Math.round(selected.deleteDur * 100) / 100}
                        onChange={(e) => updateCaption(selected.id, { deleteDur: Math.max(0.2, Number(e.target.value) || 0.2) })}
                        className="input"
                      />
                      <div className="text-[10px] text-[var(--color-text-muted)] mt-1">Deletion duration (s)</div>
                    </>
                  )}
                </Field>
              </>
            )}

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

            <AttachmentsSection
              cap={selected}
              staticWin={selectedStatic}
              selected={selectedAttachment}
              onAdd={addAttachment}
              onSelect={selectAttachment}
              onUpdate={updateAttachment}
              onRemove={removeAttachment}
            />

            <button
              onClick={() => removeCaption(selected.id)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
            >
              Remove {selected.kind === 'typewriter' ? 'typewriter' : 'caption'}
            </button>
          </Panel>
        ) : (
          <Panel title="Elements">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {mediaKind
                ? 'Select an element on the timeline or canvas to edit it, or add one below.'
                : 'Upload a photo or video to begin.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={addBoil}
                disabled={!mediaKind}
                className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
              >
                + Caption
              </button>
              <button
                onClick={addTypewriter}
                disabled={!mediaKind}
                className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium"
              >
                + Typewriter
              </button>
            </div>
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

const round2 = (n: number) => Math.round(n * 100) / 100;
const ATTACH_MIN = 0.2;

// ---- word attachments (highlight / underline) ----

function AttachmentsSection({
  cap,
  staticWin,
  selected,
  onAdd,
  onSelect,
  onUpdate,
  onRemove,
}: {
  cap: CaptionEl;
  staticWin: { start: number; end: number } | null;
  selected: Attachment | null;
  onAdd: (capId: string, type: AttachmentType) => void;
  onSelect: (capId: string, attId: string) => void;
  onUpdate: (capId: string, attId: string, patch: Partial<Attachment>) => void;
  onRemove: (capId: string, attId: string) => void;
}) {
  const words = captionWords(cap.text);
  const swLen = staticWin ? staticWin.end - staticWin.start : 0;

  return (
    <div className="pt-3 mt-1 border-t border-[var(--color-glass-border)]">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
        Word attachments
      </div>

      {!staticWin ? (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {cap.kind === 'boil'
            ? 'Set boil to “off” or “intro” (with some duration) to underline/highlight static words.'
            : 'Give this typewriter a hold to underline/highlight static words.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              onClick={() => onAdd(cap.id, 'underline')}
              className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]"
            >
              + Underline
            </button>
            <button
              onClick={() => onAdd(cap.id, 'highlight')}
              className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]"
            >
              + Highlight
            </button>
          </div>

          {cap.attachments.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              None yet — add one, then pick the words it covers.
            </p>
          ) : (
            <div className="space-y-1 mb-1">
              {cap.attachments.map((a) => {
                const lo = Math.min(a.wordStart, a.wordEnd);
                const hi = Math.max(a.wordStart, a.wordEnd);
                const summary = words.slice(lo, hi + 1).join(' ') || '(no words)';
                const isSel = selected?.id === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelect(cap.id, a.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] border ${
                      isSel
                        ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                        : 'border-[var(--color-glass-border)]'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-sm shrink-0 border border-black/20" style={{ background: a.color }} />
                    <span className="capitalize font-medium">{a.type}</span>
                    <span className="text-[var(--color-text-muted)] truncate">{summary}</span>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <AttachmentEditor
              key={selected.id}
              capId={cap.id}
              att={selected}
              words={words}
              swLen={swLen}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          )}
        </>
      )}
    </div>
  );
}

function AttachmentEditor({
  capId,
  att,
  words,
  swLen,
  onUpdate,
  onRemove,
}: {
  capId: string;
  att: Attachment;
  words: string[];
  swLen: number;
  onUpdate: (capId: string, attId: string, patch: Partial<Attachment>) => void;
  onRemove: (capId: string, attId: string) => void;
}) {
  const lo = Math.min(att.wordStart, att.wordEnd);
  const hi = Math.max(att.wordStart, att.wordEnd);
  const patch = (p: Partial<Attachment>) => onUpdate(capId, att.id, p);
  const holdPct = Math.max(0, Math.round((1 - att.inFrac - att.outFrac) * 100));

  // Plain click selects one word; shift-click extends from it to a range.
  const [anchor, setAnchor] = useState(lo);
  const clickWord = (i: number, shift: boolean) => {
    if (shift) {
      patch({ wordStart: Math.min(anchor, i), wordEnd: Math.max(anchor, i) });
    } else {
      setAnchor(i);
      patch({ wordStart: i, wordEnd: i });
    }
  };

  const maxStart = Math.max(0, swLen - ATTACH_MIN);
  const maxDur = Math.max(ATTACH_MIN, swLen - att.startInStatic);

  return (
    <div className="mt-2 p-2.5 rounded-md bg-[var(--color-bg-elevated)] space-y-3">
      <Field label="Words (click one; shift-click another for a range)">
        {words.length === 0 ? (
          <span className="text-[11px] text-[var(--color-text-muted)]">Add text to the caption first.</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {words.map((w, i) => {
              const on = i >= lo && i <= hi;
              return (
                <button
                  key={i}
                  onClick={(e) => clickWord(i, e.shiftKey)}
                  className={`px-1.5 py-0.5 rounded text-[11px] ${
                    on
                      ? 'bg-[var(--color-primary-green)] text-black'
                      : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  {w}
                </button>
              );
            })}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Color">
          <input
            type="color"
            value={att.color}
            onChange={(e) => patch({ color: e.target.value })}
            className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
          />
        </Field>
        {att.type === 'highlight' && (
          <Field label={`Opacity — ${Math.round(att.opacity * 100)}%`}>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={att.opacity}
              onChange={(e) => patch({ opacity: Number(e.target.value) })}
              className="w-full accent-[var(--color-primary-green)]"
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Start — ${att.startInStatic.toFixed(2)}s`}>
          <input
            type="number"
            min={0}
            max={round2(maxStart)}
            step={0.05}
            value={round2(att.startInStatic)}
            onChange={(e) => {
              const v = Math.max(0, Math.min(maxStart, Number(e.target.value) || 0));
              patch({ startInStatic: v, duration: Math.min(att.duration, Math.max(ATTACH_MIN, swLen - v)) });
            }}
            className="input"
          />
        </Field>
        <Field label={`Time — ${att.duration.toFixed(2)}s`}>
          <input
            type="number"
            min={ATTACH_MIN}
            max={round2(maxDur)}
            step={0.05}
            value={round2(att.duration)}
            onChange={(e) => patch({ duration: Math.max(ATTACH_MIN, Math.min(maxDur, Number(e.target.value) || ATTACH_MIN)) })}
            className="input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Sweep in — ${Math.round(att.inFrac * 100)}%`}>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={att.inFrac}
            onChange={(e) => patch({ inFrac: Math.min(Number(e.target.value), 1 - att.outFrac) })}
            className="w-full accent-[var(--color-primary-green)]"
          />
        </Field>
        <Field label={`Sweep out — ${Math.round(att.outFrac * 100)}%`}>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={att.outFrac}
            onChange={(e) => patch({ outFrac: Math.min(Number(e.target.value), 1 - att.inFrac) })}
            className="w-full accent-[var(--color-primary-green)]"
          />
        </Field>
      </div>

      <div className="text-[10px] text-[var(--color-text-muted)]">
        Hold {holdPct}%. Drag the marker on the timeline to move it; scrub to preview the sweep.
      </div>

      <button
        onClick={() => onRemove(capId, att.id)}
        className="w-full px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-[11px] font-medium hover:bg-[rgba(255,80,80,0.08)]"
      >
        Remove attachment
      </button>
    </div>
  );
}
