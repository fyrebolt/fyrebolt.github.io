// ===== Instagram data-export importer (runs entirely in the browser) =====
//
// Parses the official "Download Your Information" ZIP (Accounts Center →
// Your information and permissions → Download your information → Followers and
// following, JSON). Nothing is uploaded — fflate unzips in-page and we read both
// the followers and following file(s), then reconstruct the tracker data.
//
// This is the bootstrap path: it backfills real relationship start dates that
// the live API can't give us. scripts/instagram-pull.mjs takes over day to day.

import { unzipSync, strFromU8 } from 'fflate';
import { dayKey, type Profile, type FollowEvent, type Snapshot, type TrackerData } from './data';

export interface ImportedLists {
  followers: Profile[];
  following: Profile[];
}

const FOLLOWERS_RE = /^followers(_\d+)?\.json$/i;
const FOLLOWING_RE = /^following(_\d+)?\.json$/i;

function basename(path: string): string {
  return path.split('/').pop() || path;
}

/** Read the followers and following file(s) out of an Instagram export ZIP. */
export async function parseExportZip(file: File): Promise<ImportedLists> {
  const buf = new Uint8Array(await file.arrayBuffer());

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch {
    throw new Error('That file could not be read as a ZIP. Upload the original .zip from Instagram.');
  }

  // Match by basename so the "followers_and_following" folder name (which
  // contains "following") doesn't confuse either pattern.
  const followers = readList(files, FOLLOWERS_RE);
  const following = readList(files, FOLLOWING_RE);

  if (followers.length === 0 && following.length === 0) {
    throw new Error(
      'No followers or following file found. In the export, choose “Followers and following” and format JSON (not HTML).',
    );
  }
  return { followers, following };
}

/** Collect and de-duplicate every entry across the files matching `re`. */
function readList(files: Record<string, Uint8Array>, re: RegExp): Profile[] {
  const names = Object.keys(files)
    .filter((n) => re.test(basename(n)))
    .sort();

  const seen = new Set<string>();
  const out: Profile[] = [];
  for (const name of names) {
    let json: unknown;
    try {
      json = JSON.parse(strFromU8(files[name]));
    } catch {
      continue;
    }
    for (const entry of extractEntries(json)) {
      const key = entry.username.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(entry);
      }
    }
  }
  return out;
}

/** Instagram wraps each list as an array of { string_list_data: [{ value, timestamp }] }. */
function extractEntries(json: unknown): Profile[] {
  const arr = toArray(json);
  const out: Profile[] = [];
  for (const item of arr) {
    const row = item as {
      title?: string;
      string_list_data?: Array<{ value?: string; timestamp?: number }>;
    };
    const sld = row?.string_list_data?.[0];
    const username = sld?.value?.trim();
    if (!username) continue;
    const since =
      typeof sld?.timestamp === 'number' && sld.timestamp > 0
        ? new Date(sld.timestamp * 1000).toISOString()
        : undefined;
    const name = row?.title?.trim() || undefined;
    out.push({ username, name: name === username ? undefined : name, since });
  }
  return out;
}

/**
 * Handle top-level arrays plus the object wrappers Instagram uses
 * (`relationships_followers`, `relationships_following`).
 */
function toArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['relationships_followers', 'relationships_following']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    const firstArray = Object.values(obj).find((v) => Array.isArray(v));
    if (Array.isArray(firstArray)) return firstArray;
  }
  return [];
}

/**
 * Build the tracker data from an import, merging with the previous state so
 * follows/unfollows are diffed and the lifetime graph is reconstructed from the
 * relationship start dates.
 */
export function buildFromExport(imported: ImportedLists, prev: TrackerData | null): TrackerData {
  const nowIso = new Date().toISOString();
  const account = prev?.account || 'hastinchen';

  const byUsername = (a: Profile, b: Profile) => a.username.localeCompare(b.username);
  const followers = [...imported.followers].sort(byUsername);
  const following = [...imported.following].sort(byUsername);

  const snapshots = reconstructSnapshots(followers, following.length, nowIso);
  const events = diffEvents(followers, prev, nowIso);

  return { account, generatedAt: nowIso, sample: false, snapshots, events, followers, following };
}

/** Cumulative follower count over time from each follower's start timestamp. */
function reconstructSnapshots(
  followers: Profile[],
  followingTotal: number,
  nowIso: string,
): Snapshot[] {
  const times = followers
    .map((f) => f.since)
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
  // Final point = the true current totals (covers entries with no timestamp).
  snapshots.push({ t: nowIso, followers: followers.length, following: followingTotal });
  return snapshots;
}

/** Compare against the previous real import to produce follow/unfollow events. */
function diffEvents(
  followers: Profile[],
  prev: TrackerData | null,
  nowIso: string,
): FollowEvent[] {
  const hasPrevReal = Boolean(prev && prev.followers && prev.followers.length && !prev.sample);

  if (!hasPrevReal) {
    // First real import: seed recent follows (last 45 days) from the export so
    // the daily activity has real data immediately. Unfollows need a baseline.
    const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
    return followers
      .filter((f) => f.since && new Date(f.since).getTime() >= cutoff)
      .map((f) => ({ username: f.username, kind: 'follow' as const, t: f.since!, name: f.name }))
      .sort((a, b) => (a.t < b.t ? 1 : -1));
  }

  const prevSet = new Set(prev!.followers!.map((f) => f.username.toLowerCase()));
  const curSet = new Set(followers.map((f) => f.username.toLowerCase()));
  const prevByKey = new Map(prev!.followers!.map((f) => [f.username.toLowerCase(), f]));

  const gained: FollowEvent[] = followers
    .filter((f) => !prevSet.has(f.username.toLowerCase()))
    .map((f) => ({ username: f.username, kind: 'follow', t: f.since || nowIso, name: f.name }));
  const lost: FollowEvent[] = [...prevSet]
    .filter((u) => !curSet.has(u))
    .map((u) => {
      const p = prevByKey.get(u);
      return { username: p?.username ?? u, kind: 'unfollow' as const, t: nowIso, name: p?.name };
    });

  return [...gained, ...lost, ...(prev!.events ?? [])]
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, 5000);
}
