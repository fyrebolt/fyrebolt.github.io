import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { BannerPlayer } from '../player';
import type { LoadedMedia } from '../player';
import { transcodeToMp4, ensureFFmpeg } from '../ffmpeg';
import type { BannerPosition, EditorConfig, FillMode, RatioKey } from '../types';

type MediaKind = 'video' | 'image' | null;

type ExportStage = 'idle' | 'recording' | 'preparing' | 'encoding' | 'done' | 'error';

const RATIO_LABELS: { key: RatioKey; label: string; hint: string }[] = [
  { key: '9:16', label: '9:16', hint: 'Shorts / Reels / TikTok' },
  { key: '1:1', label: '1:1', hint: 'Square' },
  { key: '4:5', label: '4:5', hint: 'Portrait feed' },
  { key: 'original', label: 'Original', hint: 'No conversion' },
];

const POSITION_LABELS: { key: BannerPosition; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Middle' },
  { key: 'lower', label: 'Lower (safe)' },
  { key: 'bottom', label: 'Bottom' },
];

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export default function EntranceBannerTool() {
  // ---- media ----
  const [mediaKind, setMediaKind] = useState<MediaKind>(null);
  const [duration, setDuration] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);

  // ---- banner style ----
  const [name, setName] = useState('YOUR NAME');
  const [tagline, setTagline] = useState('ENTERS THE BATTLE!');
  const [primary, setPrimary] = useState('#151a2e');
  const [accent, setAccent] = useState('#e5183b');
  const [textColor, setTextColor] = useState('#ffffff');

  // ---- layout ----
  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('crop');
  const [position, setPosition] = useState<BannerPosition>('lower');
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [sfxEnabled, setSfxEnabled] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(0.5);

  // ---- timing (ms) ----
  const [freeze, setFreeze] = useState(1500);
  const [slideIn, setSlideIn] = useState(420);
  const [hold, setHold] = useState(1600);
  const [fadeOut, setFadeOut] = useState(360);
  const [total, setTotal] = useState(4000); // photo mode

  // ---- export ----
  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo or video to start.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('entrance.mp4');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<BannerPlayer | null>(null);
  const configRef = useRef<EditorConfig>(null as unknown as EditorConfig);
  const objectUrls = useRef<string[]>([]);
  const wasPlayingRef = useRef(false);

  const config: EditorConfig = useMemo(
    () => ({
      style: { name, tagline, primary, accent, text: textColor },
      timing: { freeze, slideIn, hold, fadeOut, total },
      fillMode,
      ratio,
      position,
      sfxEnabled,
      sfxVolume,
    }),
    [name, tagline, primary, accent, textColor, freeze, slideIn, hold, fadeOut, total, fillMode, ratio, position, sfxEnabled, sfxVolume],
  );
  // Keep the latest config available to the player's render loop (read via getConfig).
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Instantiate the player once the canvas exists.
  useEffect(() => {
    if (!canvasRef.current) return;
    const player = new BannerPlayer(
      canvasRef.current,
      () => configRef.current,
      (sec) => setCurrentSec(sec),
    );
    playerRef.current = player;
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  const revokeUrls = useCallback(() => {
    objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.current = [];
  }, []);

  useEffect(() => () => revokeUrls(), [revokeUrls]);

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
        // Default the freeze point to ~1/3 through the clip.
        setFreeze(Math.round(Math.min(video.duration * 1000 * 0.33, video.duration * 1000 - 200)));
        const media: LoadedMedia = { kind: 'video', video, duration: video.duration };
        player.attach(media);
        setStatus('Loaded. Press Play to preview, then Export when ready.');
      });
    } else if (file.type.startsWith('image')) {
      const image = new Image();
      image.onload = () => {
        setMediaKind('image');
        setDuration(0);
        const media: LoadedMedia = { kind: 'image', image, duration: 0 };
        player.attach(media);
        setStatus('Photo loaded. The banner loops over the clip length you set.');
      };
      image.src = url;
    }
  }, []);

  const play = useCallback(() => {
    playerRef.current?.playPreview();
  }, []);

  // ---- timeline scrubbing ----
  const scrubbing = useRef(false);
  const beginScrub = useCallback(() => {
    scrubbing.current = true;
    wasPlayingRef.current = true;
  }, []);
  const doScrub = useCallback(
    (fraction: number) => {
      const sec = Math.max(0, Math.min(1, fraction)) * duration;
      setFreeze(Math.round(sec * 1000));
      playerRef.current?.scrubTo(sec);
      setCurrentSec(sec);
    },
    [duration],
  );
  const endScrub = useCallback(() => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (wasPlayingRef.current) playerRef.current?.playPreview();
  }, []);

  // ---- export ----
  const doExport = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !mediaKind) return;
    if (typeof MediaRecorder === 'undefined') {
      setStatus('Recording is not supported in this browser.');
      return;
    }
    setDownloadUrl(null);
    setStage('recording');
    setProgress(0);
    setStatus('Recording the sequence in real time…');

    try {
      const approxLen = (mediaKind === 'video' ? duration : total / 1000) + hold / 1000;
      const webm = await player.record((sec) => {
        setProgress(Math.min(0.99, sec / Math.max(0.1, approxLen)));
      });

      let outBlob = webm;
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
      const base = name.trim().replace(/\s+/g, '_').toLowerCase() || 'entrance';
      setDownloadUrl(url);
      setDownloadName(`${base}.${ext}`);
      setStage('done');
      setProgress(1);
      if (ext === 'mp4') setStatus('Done — MP4 ready to download.');
      player.playPreview();
    } catch (err) {
      console.error(err);
      setStage('error');
      setStatus('Export failed. See the console for details.');
    }
  }, [mediaKind, duration, total, hold, name]);

  const busy = stage === 'recording' || stage === 'preparing' || stage === 'encoding';
  const freezeFraction = duration > 0 ? freeze / 1000 / duration : 0;
  const playFraction = duration > 0 ? currentSec / duration : 0;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
      {/* ---- Preview column ---- */}
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
              className="w-full h-auto rounded-lg bg-black block"
              width={1080}
              height={1920}
            />
            {showSafeZones && ratio === '9:16' && (
              <div className="pointer-events-none absolute inset-0 rounded-lg overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-[12%] bg-[rgba(255,0,80,0.12)] border-b border-[rgba(255,0,80,0.35)]" />
                <div className="absolute inset-x-0 bottom-0 h-[20%] bg-[rgba(255,0,80,0.12)] border-t border-[rgba(255,0,80,0.35)]" />
                <div className="absolute top-[12%] bottom-[20%] right-0 w-[7%] bg-[rgba(255,0,80,0.1)] border-l border-[rgba(255,0,80,0.3)]" />
              </div>
            )}
            {!mediaKind && (
              <div className="absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Upload to preview
              </div>
            )}
          </div>

          {/* Timeline (video only) */}
          {mediaKind === 'video' && (
            <Timeline
              freezeFraction={freezeFraction}
              playFraction={playFraction}
              onScrubStart={beginScrub}
              onScrub={doScrub}
              onScrubEnd={endScrub}
              duration={duration}
              freezeSec={freeze / 1000}
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
            <label className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={showSafeZones}
                onChange={(e) => setShowSafeZones(e.target.checked)}
              />
              Safe zones
            </label>
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

      {/* ---- Controls column ---- */}
      <aside className="space-y-6">
        <Panel title="Banner">
          <Field label="Name">
            <input
              type="text"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Tagline">
            <input
              type="text"
              value={tagline}
              maxLength={32}
              onChange={(e) => setTagline(e.target.value)}
              className="input"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <ColorField label="Base" value={primary} onChange={setPrimary} />
            <ColorField label="Accent" value={accent} onChange={setAccent} />
            <ColorField label="Text" value={textColor} onChange={setTextColor} />
          </div>
        </Panel>

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
          <Field label="Banner position">
            <div className="grid grid-cols-4 gap-1.5">
              {POSITION_LABELS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPosition(p.key)}
                  className={`px-1 py-2 rounded-md text-[11px] border ${
                    position === p.key
                      ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                      : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        </Panel>

        <Panel title="Timing">
          {mediaKind === 'video' ? (
            <Field label={`Freeze point — ${fmtTime(freeze / 1000)}`}>
              <NumberInput value={freeze} min={0} max={Math.max(0, Math.round(duration * 1000))} step={50} onChange={setFreeze} suffix="ms" />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                Drag the marker on the timeline, or type an exact value.
              </p>
            </Field>
          ) : (
            <Field label="Delay before slide-in">
              <NumberInput value={freeze} min={0} max={60000} step={50} onChange={setFreeze} suffix="ms" />
            </Field>
          )}
          <RangePair label="Slide-in speed" value={slideIn} min={100} max={1200} step={20} onChange={setSlideIn} />
          <RangePair label="Hold time" value={hold} min={200} max={4000} step={50} onChange={setHold} />
          <RangePair label="Fade-out speed" value={fadeOut} min={100} max={1200} step={20} onChange={setFadeOut} />
          {mediaKind === 'image' && (
            <RangePair label="Total clip length" value={total} min={2000} max={12000} step={100} onChange={setTotal} />
          )}
        </Panel>

        <Panel title="Sound effects">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={sfxEnabled} onChange={(e) => setSfxEnabled(e.target.checked)} />
            Enable entrance slash
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
      </aside>
    </div>
  );
}

// ---- small presentational helpers ----

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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-[var(--color-text-secondary)]">
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
      />
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="input"
      />
      {suffix && <span className="text-xs text-[var(--color-text-muted)]">{suffix}</span>}
    </div>
  );
}

function RangePair({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={`${label} — ${value} ms`}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--color-primary-green)]"
        />
        <input
          type="number"
          value={value}
          min={min}
          max={60000}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
          className="input w-20"
        />
      </div>
    </Field>
  );
}

// ---- timeline / scrubber ----

function Timeline({
  freezeFraction,
  playFraction,
  onScrubStart,
  onScrub,
  onScrubEnd,
  duration,
  freezeSec,
}: {
  freezeFraction: number;
  playFraction: number;
  onScrubStart: () => void;
  onScrub: (fraction: number) => void;
  onScrubEnd: () => void;
  duration: number;
  freezeSec: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  const fractionFromEvent = useCallback((clientX: number) => {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      onScrubStart();
      onScrub(fractionFromEvent(e.clientX));
    },
    [fractionFromEvent, onScrub, onScrubStart],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (e.buttons === 0) return;
      onScrub(fractionFromEvent(e.clientX));
    },
    [fractionFromEvent, onScrub],
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onScrubEnd();
    },
    [onScrubEnd],
  );

  return (
    <div className="mt-4 select-none">
      <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mb-1 font-mono">
        <span>0:00</span>
        <span>freeze @ {fmtTime(freezeSec)}</span>
        <span>{fmtTime(duration)}</span>
      </div>
      <div
        ref={barRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative h-9 rounded-md bg-[var(--color-bg-elevated)] cursor-pointer touch-none"
      >
        {/* played region */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-[rgba(116,185,255,0.18)]"
          style={{ width: `${Math.min(100, playFraction * 100)}%` }}
        />
        {/* playhead */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-[var(--color-primary-blue)]"
          style={{ left: `${Math.min(100, playFraction * 100)}%` }}
        />
        {/* freeze marker */}
        <div
          className="absolute top-0 bottom-0 flex flex-col items-center -translate-x-1/2"
          style={{ left: `${Math.min(100, Math.max(0, freezeFraction * 100))}%` }}
        >
          <div className="w-[3px] h-full bg-[var(--color-primary-green)]" />
          <div className="absolute -top-0.5 w-3 h-3 rounded-full bg-[var(--color-primary-green)] border border-black/40" />
          <div className="absolute -bottom-0.5 w-3 h-3 rounded-full bg-[var(--color-primary-green)] border border-black/40" />
        </div>
      </div>
    </div>
  );
}
