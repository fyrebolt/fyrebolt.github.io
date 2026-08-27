import { useCallback, useEffect, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import AppShell from '../ios/AppShell';
import { Button, Segmented } from '../ios';
import { convertToGif } from './convert';
import {
  DEFAULT_OPTIONS,
  DITHER_CHOICES,
  FPS_CHOICES,
  SOURCE,
  WIDTH_CHOICES,
  type GifOptions,
} from './options';
import { formatBytes, gifName } from './files';
import './gif.css';

type Status = 'queued' | 'converting' | 'done' | 'error';

interface Job {
  id: number;
  file: File;
  name: string;
  status: Status;
  progress: number;
  url?: string;
  size?: number;
  error?: string;
}

let nextId = 1;

/**
 * Drop anything in, get a GIF out. Every frame is decoded, re-palettised and
 * re-encoded by ffmpeg.wasm inside the tab — the files never leave the
 * machine, which is the only reason it's reasonable to accept "anything".
 */
export default function GifApp() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [options, setOptions] = useState<GifOptions>(DEFAULT_OPTIONS);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The converter loop runs outside React's render: it needs the newest
  // options without being restarted, and it must never run twice at once
  // (there is a single ffmpeg instance, and it is single-threaded).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const busyRef = useRef(false);
  const queueRef = useRef<Job[]>([]);
  queueRef.current = jobs;

  const patch = useCallback((id: number, next: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  const pump = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      for (;;) {
        const job = queueRef.current.find((j) => j.status === 'queued');
        if (!job) break;
        patch(job.id, { status: 'converting', progress: 0 });
        try {
          const blob = await convertToGif(job.file, optionsRef.current, job.id, {
            onProgress: (p) => patch(job.id, { progress: p }),
          });
          patch(job.id, {
            status: 'done',
            progress: 1,
            url: URL.createObjectURL(blob),
            size: blob.size,
          });
        } catch (err) {
          patch(job.id, {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      busyRef.current = false;
    }
  }, [patch]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (!incoming.length) return;
      const added = incoming.map<Job>((file) => ({
        id: nextId++,
        file,
        name: gifName(file.name),
        status: 'queued',
        progress: 0,
      }));
      setNote(null);
      setJobs((prev) => [...prev, ...added]);
      // `pump` reads the queue from a ref, which React has not written yet —
      // hand it the new list directly so the first file starts immediately.
      queueRef.current = [...queueRef.current, ...added];
      void pump();
    },
    [pump],
  );

  // The whole app surface is a drop target, not just the dashed box: aiming
  // for a rectangle is the part of drag-and-drop people get wrong.
  useEffect(() => {
    let depth = 0;
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      add(e.dataTransfer.files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [add]);

  // Object URLs outlive their component, so hand each one back when its job
  // goes away. Reading the live list from a ref keeps this to a single
  // unmount-time sweep rather than a re-run on every progress tick.
  useEffect(
    () => () => {
      for (const job of queueRef.current) if (job.url) URL.revokeObjectURL(job.url);
    },
    [],
  );

  const remove = (id: number) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job?.url) URL.revokeObjectURL(job.url);
      return prev.filter((j) => j.id !== id);
    });
  };

  const clear = () => {
    setJobs((prev) => {
      for (const job of prev) if (job.url) URL.revokeObjectURL(job.url);
      return prev.filter((j) => j.status === 'converting');
    });
    setNote(null);
  };

  /** Re-queue everything that already converted, at the current settings. */
  const redoAll = () => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.status === 'converting') return j;
        if (j.url) URL.revokeObjectURL(j.url);
        return { ...j, status: 'queued', progress: 0, url: undefined, size: undefined, error: undefined };
      }),
    );
    queueRef.current = queueRef.current.map((j) =>
      j.status === 'converting'
        ? j
        : { ...j, status: 'queued', progress: 0, url: undefined, size: undefined, error: undefined },
    );
    void pump();
  };

  const done = jobs.filter((j) => j.status === 'done' && j.url);
  const busy = jobs.some((j) => j.status === 'converting' || j.status === 'queued');

  /** More than one GIF is easier to hand over as a single zip than as N clicks. */
  const downloadAll = async () => {
    if (done.length < 2) return;
    const entries: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const job of done) {
      let name = job.name;
      for (let n = 2; used.has(name); n++) name = job.name.replace(/\.gif$/, `-${n}.gif`);
      used.add(name);
      entries[name] = new Uint8Array(await (await fetch(job.url!)).arrayBuffer());
    }
    // Already-compressed data; storing beats spending time deflating it.
    const zip = zipSync(entries, { level: 0 });
    save(URL.createObjectURL(new Blob([zip.slice().buffer], { type: 'application/zip' })), 'gifs.zip', true);
  };

  return (
    <AppShell
      title="GIF Shop"
      glyph="🎞️"
      maxWidth={880}
      right={
        <Button variant="primary" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="gif-file-input"
        onChange={(e) => {
          if (e.target.files) add(e.target.files);
          e.target.value = '';
        }}
      />

      <section
        className={`gif-drop ${dragging ? 'is-dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Drop video files here, or click to choose them"
      >
        <span className="gif-drop-glyph" aria-hidden>
          🎞️
        </span>
        <p className="gif-drop-title">
          {dragging ? 'Drop to convert' : 'Drop videos anywhere'}
        </p>
        <p className="gif-drop-sub">
          Any format ffmpeg can read — MP4, MOV, WebM, AVI, MKV, GIF, or a still image.
          Converted in this tab; nothing is uploaded.
        </p>
      </section>

      <section className="gif-settings" aria-label="Output settings">
        <Field label="Frame rate" hint="Original keeps every frame.">
          <Segmented
            options={FPS_CHOICES.map((c) => ({ value: String(c.value), label: c.label }))}
            value={String(options.fps)}
            onChange={(v) =>
              setOptions((o) => ({ ...o, fps: v === SOURCE ? SOURCE : Number(v) }))
            }
          />
        </Field>
        <Field label="Width" hint="Never upscales past the source.">
          <Segmented
            options={WIDTH_CHOICES.map((c) => ({ value: String(c.value), label: c.label }))}
            value={String(options.width)}
            onChange={(v) =>
              setOptions((o) => ({ ...o, width: v === SOURCE ? SOURCE : Number(v) }))
            }
          />
        </Field>
        <Field label="Dither" hint="How 16 million colours are fitted into 256.">
          <Segmented
            options={DITHER_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
            value={options.dither}
            onChange={(v) => setOptions((o) => ({ ...o, dither: v }))}
          />
        </Field>
        <p className="gif-settings-note">
          Defaults keep the source’s own frame rate and size, with a palette fitted to
          each clip — the best a GIF can look, and the largest it can get. Turn the
          frame rate or width down if the file needs to be smaller.
        </p>
      </section>

      {jobs.length > 0 && (
        <section className="gif-queue" aria-label="Conversions">
          <header className="gif-queue-bar">
            <h2 className="gif-queue-title">
              {jobs.length} {jobs.length === 1 ? 'file' : 'files'}
              {busy && <span className="gif-queue-busy"> · working…</span>}
            </h2>
            <div className="gif-queue-actions">
              {done.length > 1 && (
                <Button onClick={() => void downloadAll()}>Download all ({done.length})</Button>
              )}
              {done.length > 0 && !busy && <Button onClick={redoAll}>Redo at these settings</Button>}
              <Button variant="ghost" onClick={clear}>
                Clear
              </Button>
            </div>
          </header>

          <ul className="gif-list">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} onRemove={() => remove(job.id)} />
            ))}
          </ul>
        </section>
      )}

      {note && <p className="gif-note">{note}</p>}
    </AppShell>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gif-field">
      <div className="gif-field-head">
        <span className="gif-field-label">{label}</span>
        <span className="gif-field-hint">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function JobRow({ job, onRemove }: { job: Job; onRemove: () => void }) {
  const pct = Math.round(job.progress * 100);
  return (
    <li className={`gif-row gif-row-${job.status}`}>
      <div className="gif-row-thumb" aria-hidden>
        {job.status === 'done' && job.url ? (
          <img src={job.url} alt="" />
        ) : job.status === 'error' ? (
          <span>⚠️</span>
        ) : (
          <span>🎞️</span>
        )}
      </div>

      <div className="gif-row-main">
        {/* A row that failed never produced a GIF, so naming it one is a lie —
            show what was actually dropped. */}
        <p className="gif-row-name" title={job.file.name}>
          {job.status === 'error' ? job.file.name : job.name}
        </p>
        <p className="gif-row-meta">
          {job.status === 'queued' && 'Waiting…'}
          {job.status === 'converting' &&
            (pct < 34 ? `Reading colours… ${pct}%` : `Encoding… ${pct}%`)}
          {job.status === 'done' && (
            <>
              {formatBytes(job.file.size)} <span aria-hidden>→</span>{' '}
              <strong>{formatBytes(job.size ?? 0)}</strong>
            </>
          )}
          {job.status === 'error' && <span className="gif-row-error">{job.error}</span>}
        </p>
        {job.status === 'converting' && (
          <div
            className="gif-progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="gif-row-actions">
        {job.status === 'done' && job.url && (
          <a className="ios-btn ios-btn-primary" href={job.url} download={job.name}>
            Download
          </a>
        )}
        <button className="gif-row-remove" onClick={onRemove} aria-label={`Remove ${job.name}`}>
          ✕
        </button>
      </div>
    </li>
  );
}

/** Click a link the page made, then let the URL go if we own it. */
function save(url: string, name: string, revoke = false) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
