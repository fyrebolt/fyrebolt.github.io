// ===== Project persistence: lossless local autosave + JSON save/load =====
//
// Everything stays client-side. Two storage paths, both LOSSLESS — the user's
// original media bytes are stored verbatim and never re-encoded:
//
//   - Autosave → IndexedDB. A small `meta` snapshot (plain project data) is
//     written on every edit; the heavy source blobs live in a `media` store
//     keyed by srcId and are written once per source (they don't change), so a
//     refresh or crash restores the whole project including video.
//   - Save/Load → a single downloadable JSON file that embeds the same original
//     bytes (base64) for backup or transfer.
//
// The decoded <video>/<img> elements are NOT stored (they're rebuilt from the
// blobs on load); only the serialisable project data + the original blobs are.

import type { FillMode, RatioKey } from '../types';
import type { BoilPoolId } from '../captions/fonts';
import type { Layer } from './types';
import type { VideoClip } from './clips';
import type { ColorGrade } from './grade';

/** Plain, JSON-serialisable project state (no media, no decoded elements). */
export interface PersistSnapshot {
  version: 1;
  clips: VideoClip[];
  layers: Layer[];
  ratio: RatioKey;
  fillMode: FillMode;
  boilPool: BoilPoolId;
  normalize: boolean;
  sfxEnabled: boolean;
  sfxVolume: number;
  imageDuration: number;
  /** Global colour grade (optional — absent in projects saved before grading). */
  grade?: ColorGrade;
}

/** One original source blob, kept verbatim (lossless). */
export interface MediaEntry {
  srcId: string;
  name: string;
  type: string;
  blob: Blob;
}

const DB_NAME = 'fyrebolt-video';
const DB_VERSION = 1;
const META_STORE = 'meta';
const MEDIA_STORE = 'media';
const META_KEY = 'autosave';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Write the lightweight project snapshot (called on every edit, debounced). */
export async function saveSnapshot(snapshot: PersistSnapshot): Promise<void> {
  const db = await openDB();
  try {
    await tx(db, META_STORE, 'readwrite', (s) => s.put(snapshot, META_KEY));
  } finally {
    db.close();
  }
}

/** Persist one source blob (written once per srcId — sources never change). */
export async function saveMedia(entry: MediaEntry): Promise<void> {
  const db = await openDB();
  try {
    await tx(db, MEDIA_STORE, 'readwrite', (s) => s.put({ name: entry.name, type: entry.type, blob: entry.blob }, entry.srcId));
  } finally {
    db.close();
  }
}

/** srcIds already present in the media store (to skip re-writing big blobs). */
export async function persistedMediaIds(): Promise<Set<string>> {
  const db = await openDB();
  try {
    const keys = await tx<IDBValidKey[]>(db, MEDIA_STORE, 'readonly', (s) => s.getAllKeys());
    return new Set(keys.map(String));
  } finally {
    db.close();
  }
}

/** Drop media entries whose srcId is no longer referenced by the project. */
export async function pruneMedia(keep: Set<string>): Promise<void> {
  const db = await openDB();
  try {
    const keys = await tx<IDBValidKey[]>(db, MEDIA_STORE, 'readonly', (s) => s.getAllKeys());
    const t = db.transaction(MEDIA_STORE, 'readwrite');
    const store = t.objectStore(MEDIA_STORE);
    for (const k of keys) if (!keep.has(String(k))) store.delete(k);
    await new Promise<void>((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}

export interface LoadedProject {
  snapshot: PersistSnapshot;
  media: MediaEntry[];
}

/** Load the autosaved snapshot + its referenced media, or null if none. */
export async function loadProject(): Promise<LoadedProject | null> {
  const db = await openDB();
  try {
    const snapshot = await tx<PersistSnapshot | undefined>(db, META_STORE, 'readonly', (s) => s.get(META_KEY));
    if (!snapshot || !snapshot.clips || snapshot.clips.length === 0) return null;
    const media = await readMediaFor(db, referencedSrcIds(snapshot));
    return { snapshot, media };
  } finally {
    db.close();
  }
}

/** Wipe the autosaved project (snapshot + all media). */
export async function clearProject(): Promise<void> {
  const db = await openDB();
  try {
    await tx(db, META_STORE, 'readwrite', (s) => s.delete(META_KEY));
    await tx(db, MEDIA_STORE, 'readwrite', (s) => s.clear());
  } finally {
    db.close();
  }
}

async function readMediaFor(db: IDBDatabase, srcIds: Set<string>): Promise<MediaEntry[]> {
  const out: MediaEntry[] = [];
  for (const srcId of srcIds) {
    const rec = await tx<{ name: string; type: string; blob: Blob } | undefined>(db, MEDIA_STORE, 'readonly', (s) => s.get(srcId));
    if (rec) out.push({ srcId, name: rec.name, type: rec.type, blob: rec.blob });
  }
  return out;
}

/** Every srcId a project references: base clips + sticker layers. */
export function referencedSrcIds(snapshot: PersistSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const c of snapshot.clips) ids.add(c.srcId);
  for (const l of snapshot.layers) if (l.kind === 'sticker') ids.add(l.el.srcId);
  return ids;
}

// ---- JSON save / load (lossless: original bytes embedded as base64) ----

interface JsonMedia {
  srcId: string;
  name: string;
  type: string;
  /** Original bytes, base64 — no re-encoding. */
  data: string;
}
interface JsonFile {
  format: 'fyrebolt-video-project';
  version: 1;
  snapshot: PersistSnapshot;
  media: JsonMedia[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000; // chunk to avoid arg-count limits on fromCharCode
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buf;
}

/** Build a downloadable JSON blob embedding the snapshot + original media bytes. */
export async function exportProjectJSON(snapshot: PersistSnapshot, media: MediaEntry[]): Promise<Blob> {
  const jsonMedia: JsonMedia[] = [];
  for (const m of media) {
    const buf = new Uint8Array(await m.blob.arrayBuffer());
    jsonMedia.push({ srcId: m.srcId, name: m.name, type: m.type, data: bytesToBase64(buf) });
  }
  const file: JsonFile = { format: 'fyrebolt-video-project', version: 1, snapshot, media: jsonMedia };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** Parse a project JSON file back into a snapshot + original-byte blobs. */
export async function importProjectJSON(file: File): Promise<LoadedProject> {
  const text = await file.text();
  const parsed = JSON.parse(text) as JsonFile;
  if (parsed?.format !== 'fyrebolt-video-project' || !parsed.snapshot) {
    throw new Error('Not a Fyrebolt video project file.');
  }
  const media: MediaEntry[] = parsed.media.map((m) => ({
    srcId: m.srcId,
    name: m.name,
    type: m.type,
    blob: new Blob([base64ToBytes(m.data)], { type: m.type }),
  }));
  return { snapshot: parsed.snapshot, media };
}
