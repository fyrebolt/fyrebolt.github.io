// ===== LinkedIn data-export importer (runs entirely in the browser) =====
//
// Parses the official export (Settings → Data privacy → Get a copy of your
// data). Nothing is uploaded — fflate unzips in-page.
//
// This is the bootstrap path, and on LinkedIn it's unusually good: Connections.csv
// carries a "Connected On" date for every single connection, so one import
// reconstructs your entire connection history back to the day you joined.
// scripts/linkedin-pull.mjs takes over day to day.
//
// What the export does *not* contain is profile viewers. LinkedIn has never
// included them in the archive, which is precisely why the daily pull exists.

import { unzipSync, strFromU8 } from 'fflate';
import { readConnections, readFollowers, readProfile } from './csv';
import { dayKey, type NetworkEvent, type Person, type Snapshot, type TrackerData } from './data';

export interface ImportedLists {
  connections: Person[];
  followers: Person[];
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Read the connections/followers lists out of a LinkedIn export.
 *
 * Accepts either the original `.zip` or the loose `.csv` files from inside it —
 * people usually unzip before they get here. A previously downloaded
 * `history.json` is accepted too, which is how the unredacted viewer log the
 * puller writes gets back into the page.
 */
export async function parseExport(
  files: File[],
): Promise<{ lists: ImportedLists; profile?: string; name?: string; history?: TrackerData }> {
  const texts = await collectTexts(files);

  const history = readHistory(texts);
  if (history) return { lists: { connections: [], followers: [] }, history };

  const connections = readConnections(texts);
  const followers = readFollowers(texts);
  const me = readProfile(texts);

  if (connections.length === 0 && followers.length === 0) {
    throw new Error(
      'No Connections.csv or Followers.csv found. Request the archive under Settings → ' +
        'Data privacy → Get a copy of your data (pick “Connections” at minimum), then drop ' +
        'in the .zip or the loose .csv files.',
    );
  }
  return { lists: { connections, followers }, profile: me?.profile, name: me?.name };
}

/** Filename → file contents, unwrapping any ZIPs along the way. */
async function collectTexts(files: File[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let sawSomethingUsable = false;

  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      let unzipped: Record<string, Uint8Array>;
      try {
        unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
      } catch {
        throw new Error(`Couldn’t read ${file.name} — is it really a ZIP?`);
      }
      for (const [path, bytes] of Object.entries(unzipped)) {
        if (!/\.(csv|json)$/i.test(path)) continue;
        out[basename(path)] = strFromU8(bytes);
        sawSomethingUsable = true;
      }
    } else if (/\.(csv|json)$/i.test(file.name)) {
      out[basename(file.name)] = await file.text();
      sawSomethingUsable = true;
    }
  }

  if (!sawSomethingUsable) {
    throw new Error('Drop in the export .zip, or the .csv files from inside it.');
  }
  return out;
}

/** A previously downloaded history.json — including the unredacted viewer log. */
function readHistory(texts: Record<string, string>): TrackerData | null {
  for (const [name, text] of Object.entries(texts)) {
    if (!/\.json$/i.test(name)) continue;
    try {
      const data = JSON.parse(text) as TrackerData;
      if (Array.isArray(data.snapshots) && Array.isArray(data.events) && data.profile) return data;
    } catch {
      /* not ours — keep looking */
    }
  }
  return null;
}

// ===== Reconstruction =====

/**
 * Build tracker data from an import, merged onto whatever we already had.
 *
 * The export's dates are authoritative — they're LinkedIn's own record of when
 * each connection was made — so they win over the puller's first-seen guesses.
 * Everything the export can't know (profile views above all) is carried over
 * from the existing data untouched.
 */
export function buildFromExport(
  imported: ImportedLists,
  profile: string,
  name: string | undefined,
  previous: TrackerData | null,
): TrackerData {
  const connections = mergeList(imported.connections, previous?.connections);
  const followers = mergeList(imported.followers, previous?.followers);

  return {
    profile: profile || previous?.profile || 'you',
    name: name ?? previous?.name,
    generatedAt: new Date().toISOString(),
    sample: false,
    redacted: previous?.redacted,
    snapshots: rebuildSnapshots(connections, followers, previous),
    events: rebuildEvents(connections, previous?.events ?? []),
    connections,
    followers,
    // Views only ever come from the daily pull; an import must not drop them.
    views: previous?.views ?? [],
  };
}

/** Imported entries win on dates and details; anyone only we knew about stays. */
function mergeList(imported: Person[], previous: Person[] | undefined): Person[] {
  const byKey = new Map<string, Person>();
  for (const p of previous ?? []) byKey.set(p.id.toLowerCase(), p);
  for (const p of imported) {
    const old = byKey.get(p.id.toLowerCase());
    byKey.set(p.id.toLowerCase(), old ? { ...old, ...p, since: p.since ?? old.since } : p);
  }
  return [...byKey.values()].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}

/**
 * A connection-count curve reconstructed from the dates in the export.
 *
 * Only connections *still* on file can contribute, so the curve is a lower
 * bound: anyone who connected and later disconnected is invisible to it. Real
 * measured readings from the daily pull are kept and win on their own days.
 */
function rebuildSnapshots(
  connections: Person[],
  followers: Person[],
  previous: TrackerData | null,
): Snapshot[] {
  const dated = connections
    .filter((p) => p.since)
    .sort((a, b) => new Date(a.since!).getTime() - new Date(b.since!).getTime());

  const perDay = new Map<string, number>();
  let running = 0;
  for (const p of dated) {
    running++;
    perDay.set(dayKey(p.since!), running);
  }

  const reconstructed: Snapshot[] = [...perDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, count]) => ({ t: noonIso(key), connections: count }));

  // Measured readings (the ones carrying a follower count) override the
  // reconstruction on any day they share.
  const measured = (previous?.snapshots ?? []).filter((s) => typeof s.followers === 'number');
  const measuredDays = new Set(measured.map((s) => dayKey(s.t)));

  const merged = [
    ...reconstructed.filter((s) => !measuredDays.has(dayKey(s.t))),
    ...measured,
  ].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  // Close the curve on today, so the graph runs up to the present rather than
  // stopping at the last connection you happened to make.
  const today = dayKey(new Date().toISOString());
  const last = merged[merged.length - 1];
  if (!last || dayKey(last.t) !== today) {
    merged.push({
      t: new Date().toISOString(),
      connections: connections.length,
      followers: followers.length || undefined,
    });
  }
  return merged;
}

/** `connect` events for every dated connection, merged with what we had. */
function rebuildEvents(connections: Person[], previous: NetworkEvent[]): NetworkEvent[] {
  const fromExport: NetworkEvent[] = connections
    .filter((p) => p.since)
    .map((p) => ({ id: p.id, kind: 'connect' as const, t: p.since!, name: p.name, headline: p.headline }));

  // Keep every recorded disconnect/follow — the export can't reconstruct those —
  // and replace connect events, whose dates the export knows better.
  const kept = previous.filter((e) => e.kind !== 'connect');
  return [...fromExport, ...kept].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 20000);
}

function noonIso(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}
