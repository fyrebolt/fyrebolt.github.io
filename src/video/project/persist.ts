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
const DB_VERSION = 2;
const META_STORE = 'meta';
const MEDIA_STORE = 'media';
// A cross-PROJECT asset library. Unlike MEDIA_STORE (per-project, pruned by
// pruneMedia when a source is no longer referenced), library entries persist
// independently of any project — pruneMedia never touches this store — so an
// intro track / sticker uploaded in one project can be reused in the next. See
// the library API at the bottom of this file.
const LIBRARY_STORE = 'library';
const META_KEY = 'autosave';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
      // v2: add the library store, preserving existing meta + media (an upgrade,
      // not a wipe — older autosaves survive the version bump untouched).
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) db.createObjectStore(LIBRARY_STORE);
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

/** Every srcId a project references: base clips + sticker + music layers. */
export function referencedSrcIds(snapshot: PersistSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const c of snapshot.clips) ids.add(c.srcId);
  for (const l of snapshot.layers) if (l.kind === 'sticker' || l.kind === 'music') ids.add(l.el.srcId);
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

// ---- Cross-project asset library (persists across projects; never pruned) ----
//
// A separate store from MEDIA_STORE so a re-usable asset (music, sticker, clip)
// survives project switches, `clearProject`, and pruneMedia. Entries keep the
// ORIGINAL bytes verbatim (same lossless promise as everything else) plus a
// small preview thumbnail and a content hash used to skip re-adding duplicates.
//
// Adding an asset FROM the library into a project COPIES its blob into that
// project's own MEDIA_STORE under a fresh srcId (done by the editor, not here),
// so projects stay self-contained and deleting a library entry can never break
// a project that already used it.

/** How to decode a library blob back into a usable element. */
export type LibraryMedia = 'video' | 'image' | 'audio';

export interface LibraryEntry {
  /** Library-scoped id (independent of any project srcId). */
  id: string;
  /** Display name (defaults to the original filename; user-renamable). */
  name: string;
  /** Decode kind — also decides which upload pickers can reuse it. */
  media: LibraryMedia;
  /** Original MIME type. */
  type: string;
  /** Original bytes, verbatim (lossless). */
  blob: Blob;
  /** Small preview: an image/JPEG data URL (frame grab / image / waveform). */
  thumb: string;
  /** Content hash (SHA-256 hex) — dedupes re-uploads of the same file. */
  hash: string;
  /** When it was first added (ms epoch) — newest-first ordering. */
  addedAt: number;
}

/** Every library entry, newest first. */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const db = await openDB();
  try {
    const all = await tx<LibraryEntry[]>(db, LIBRARY_STORE, 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.addedAt - a.addedAt);
  } finally {
    db.close();
  }
}

/** Add (or overwrite) a library entry, keyed by its id. */
export async function addToLibrary(entry: LibraryEntry): Promise<void> {
  const db = await openDB();
  try {
    await tx(db, LIBRARY_STORE, 'readwrite', (s) => s.put(entry, entry.id));
  } finally {
    db.close();
  }
}

/** The existing entry with this content hash, if any (to skip duplicate adds). */
export async function libraryEntryByHash(hash: string): Promise<LibraryEntry | null> {
  const db = await openDB();
  try {
    const all = await tx<LibraryEntry[]>(db, LIBRARY_STORE, 'readonly', (s) => s.getAll());
    return all.find((e) => e.hash === hash) ?? null;
  } finally {
    db.close();
  }
}

/** Rename a library entry (future availability only — copies already in projects are unaffected). */
export async function renameLibraryEntry(id: string, name: string): Promise<void> {
  const db = await openDB();
  try {
    const rec = await tx<LibraryEntry | undefined>(db, LIBRARY_STORE, 'readonly', (s) => s.get(id));
    if (!rec) return;
    await tx(db, LIBRARY_STORE, 'readwrite', (s) => s.put({ ...rec, name }, id));
  } finally {
    db.close();
  }
}

/** Remove a library entry (only from future availability — see the header note). */
export async function deleteLibraryEntry(id: string): Promise<void> {
  const db = await openDB();
  try {
    await tx(db, LIBRARY_STORE, 'readwrite', (s) => s.delete(id));
  } finally {
    db.close();
  }
}
