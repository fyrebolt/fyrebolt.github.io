// ===== Instagram data-export importer (runs entirely in the browser) =====
//
// Parses the official "Download Your Information" ZIP (Accounts Center →
// Your information and permissions → Download your information → Followers and
// following, JSON). Nothing is uploaded — fflate unzips in-page and we read the
// followers file(s), then reconstruct the tracker data.

import { unzipSync, strFromU8 } from 'fflate';
import { dayKey, type Follower, type FollowEvent, type Snapshot, type TrackerData } from './data';

export interface ImportedFollower {
  username: string;
  /** ISO timestamp of when they followed, when the export provides it. */
  followedAt?: string;
}

const FOLLOWERS_RE = /^followers(_\d+)?\.json$/i;

function basename(path: string): string {
  return path.split('/').pop() || path;
}

/** Read the followers file(s) out of an Instagram export ZIP. */
export async function parseExportZip(file: File): Promise<ImportedFollower[]> {
  const buf = new Uint8Array(await file.arrayBuffer());

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch {
    throw new Error('That file could not be read as a ZIP. Upload the original .zip from Instagram.');
  }

  // Match the followers file(s) by basename so the "followers_and_following"
  // folder name (which contains "following") doesn't exclude them.
  const names = Object.keys(files).filter((n) => FOLLOWERS_RE.test(basename(n)));
  if (names.length === 0) {
    throw new Error(
      'No followers file found. In the export, choose “Followers and following” and format JSON (not HTML).',
    );
  }

  const seen = new Set<string>();
  const out: ImportedFollower[] = [];
  for (const name of names.sort()) {
    let json: unknown;
    try {
      json = JSON.parse(strFromU8(files[name]));
    } catch {
      continue;
    }
    for (const entry of extractEntries(json)) {
      if (!seen.has(entry.username)) {
        seen.add(entry.username);
        out.push(entry);
      }
    }
  }

  if (out.length === 0) {
    throw new Error('The followers file was found but looked empty. Re-export with JSON format.');
  }
  return out;
}

/** Instagram wraps followers as an array of { string_list_data: [{ value, timestamp }] }. */
function extractEntries(json: unknown): ImportedFollower[] {
  const arr = toArray(json);
  const out: ImportedFollower[] = [];
  for (const item of arr) {
    const sld = (item as { string_list_data?: Array<{ value?: string; timestamp?: number }> })
      ?.string_list_data?.[0];
    const username = sld?.value?.trim();
    if (!username) continue;
    const followedAt =
      typeof sld?.timestamp === 'number' && sld.timestamp > 0
        ? new Date(sld.timestamp * 1000).toISOString()
        : undefined;
    out.push({ username, followedAt });
  }
  return out;
}

/** Handle both top-level arrays and objects like { relationships_followers: [...] }. */
function toArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.relationships_followers)) return obj.relationships_followers;
    const firstArray = Object.values(obj).find((v) => Array.isArray(v));
    if (Array.isArray(firstArray)) return firstArray;
  }
  return [];
}

/**
 * Build the tracker data from an import, merging with the previous state so
 * follows/unfollows are diffed and the lifetime graph is reconstructed from the
 * follow timestamps.
 */
export function buildFromExport(
  imported: ImportedFollower[],
  prev: TrackerData | null,
): TrackerData {
  const nowIso = new Date().toISOString();
  const account = prev?.account || 'hastinchen';

  const followers: Follower[] = imported
    .map((f) => ({ username: f.username }))
    .sort((a, b) => a.username.localeCompare(b.username));

  const snapshots = reconstructSnapshots(imported, nowIso);
  const events = diffEvents(imported, prev, nowIso);

  return { account, generatedAt: nowIso, sample: false, snapshots, events, followers };
}

/** Cumulative follower count over time from each follower's join timestamp. */
function reconstructSnapshots(imported: ImportedFollower[], nowIso: string): Snapshot[] {
  const times = imported
    .map((f) => f.followedAt)
    .filter((t): t is string => Boolean(t))
    .map((t) => new Date(t).getTime())
    .sort((a, b) => a - b);

  const snapshots: Snapshot[] = [];
  let count = 0;
  let lastDay = '';
  for (const t of times) {
    count++;
    const iso = new Date(t).toISOString();
    const dk = dayKey(iso);
    if (dk !== lastDay) {
      snapshots.push({ t: iso, followers: count });
      lastDay = dk;
    } else {
      snapshots[snapshots.length - 1].followers = count;
    }
  }
  // Final point = the true current total (covers followers with no timestamp).
  snapshots.push({ t: nowIso, followers: imported.length });
  return snapshots;
}

/** Compare against the previous real import to produce follow/unfollow events. */
function diffEvents(
  imported: ImportedFollower[],
  prev: TrackerData | null,
  nowIso: string,
): FollowEvent[] {
  const hasPrevReal = Boolean(prev && prev.followers && prev.followers.length && !prev.sample);

  if (!hasPrevReal) {
    // First real import: seed recent follows (last 45 days) from the export so
    // the daily activity has real data immediately. Unfollows need a baseline.
    const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
    return imported
      .filter((f) => f.followedAt && new Date(f.followedAt).getTime() >= cutoff)
      .map((f) => ({ username: f.username, kind: 'follow' as const, t: f.followedAt! }))
      .sort((a, b) => (a.t < b.t ? 1 : -1));
  }

  const prevSet = new Set(prev!.followers!.map((f) => f.username));
  const curSet = new Set(imported.map((f) => f.username));
  const gained: FollowEvent[] = imported
    .filter((f) => !prevSet.has(f.username))
    .map((f) => ({ username: f.username, kind: 'follow', t: f.followedAt || nowIso }));
  const lost: FollowEvent[] = [...prevSet]
    .filter((u) => !curSet.has(u))
    .map((u) => ({ username: u, kind: 'unfollow', t: nowIso }));

  return [...gained, ...lost, ...(prev!.events ?? [])]
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, 5000);
}
