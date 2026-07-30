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

/**
 * Read the followers/following lists out of an Instagram export.
 *
 * Accepts either the original `.zip` or the loose `.json` files from inside it
 * — people usually unzip before they get here, and re-zipping two files just to
 * satisfy the importer is a silly thing to ask.
 */
export async function parseExport(files: File[]): Promise<ImportedLists> {
  const texts = await collectTexts(files);

  // Match by basename so the "followers_and_following" folder name (which
  // itself contains "following") doesn't confuse either pattern.
  const followers = readList(texts, FOLLOWERS_RE);
  const following = readList(texts, FOLLOWING_RE);

  if (followers.length === 0 && following.length === 0) {
    throw new Error(
      'No followers or following data found. Drop in followers_1.json and following.json ' +
        '(or the original .zip). In the export, choose “Followers and following”, format JSON — not HTML.',
    );
  }
  return { followers, following };
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
        throw new Error(`“${file.name}” could not be read as a ZIP.`);
      }
      for (const [name, bytes] of Object.entries(unzipped)) {
        const base = basename(name);
        if (FOLLOWERS_RE.test(base) || FOLLOWING_RE.test(base)) {
          out[name] = strFromU8(bytes);
          sawSomethingUsable = true;
        }
      }
    } else if (/\.json$/i.test(file.name)) {
      out[file.name] = await file.text();
      sawSomethingUsable = true;
    }
  }

  if (!sawSomethingUsable) {
    throw new Error('Drop in the .json files from your export (or the original .zip).');
  }
  return out;
}

/** Collect and de-duplicate every entry across the files matching `re`. */
function readList(texts: Record<string, string>, re: RegExp): Profile[] {
  const names = Object.keys(texts)
    .filter((n) => re.test(basename(n)))
    .sort();

  const seen = new Set<string>();
  const out: Profile[] = [];
  for (const name of names) {
    let json: unknown;
    try {
      json = JSON.parse(texts[name]);
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
  const hasLiveData = Boolean(prev && !prev.sample && prev.followers?.length);
  return hasLiveData ? backfill(imported, prev!) : coldStart(imported, prev);
}

/**
 * Merge an export into existing live data.
 *
 * The export is a *historical document*, not a newer reading — Instagram takes
 * hours to prepare it, so it is already stale on arrival. It is therefore used
 * only for what it alone knows (when each relationship began, and the shape of
 * the growth curve); the live lists stay authoritative.
 *
 * Critically, no events are derived from it. An export lists only who follows
 * you *now*, so it can neither prove nor disprove an unfollow — and diffing
 * against a stale one invents an unfollow for everybody who arrived after
 * Instagram cut the file.
 */
function backfill(imported: ImportedLists, prev: TrackerData): TrackerData {
  return {
    ...prev,
    followers: applyDates(prev.followers ?? [], imported.followers),
    following: applyDates(prev.following ?? [], imported.following),
    snapshots: mergeSnapshots(prev.snapshots, reconstructSnapshots(imported.followers)),
  };
}

/** First real import: the export *is* the data. */
function coldStart(imported: ImportedLists, prev: TrackerData | null): TrackerData {
  const nowIso = new Date().toISOString();
  const byUsername = (a: Profile, b: Profile) => a.username.localeCompare(b.username);
  const followers = [...imported.followers].sort(byUsername);
  const following = [...imported.following].sort(byUsername);

  const snapshots = reconstructSnapshots(followers);
  // Close the curve with the true current totals, covering entries the export
  // gave no timestamp for.
  snapshots.push({ t: nowIso, followers: followers.length, following: following.length });

  return {
    account: prev?.account || 'hastinchen',
    generatedAt: nowIso,
    sample: false,
    snapshots,
    events: seedRecentFollows(followers),
    followers,
    following,
  };
}

/**
 * Copy real relationship dates onto the live list. The export's timestamps are
 * ground truth; the daily puller can only record when it first *saw* someone,
 * so anyone it discovered gets stamped with that day instead of the real one.
 */
function applyDates(live: Profile[], fromExport: Profile[]): Profile[] {
  const byName = new Map(
    fromExport.filter((p) => p.since).map((p) => [p.username.toLowerCase(), p]),
  );
  return live.map((p) => {
    const match = byName.get(p.username.toLowerCase());
    if (!match) return p; // followed after the export was cut — keep what we have
    return { ...p, since: match.since, name: p.name ?? match.name };
  });
}

/**
 * Reconstructed history before the first real reading, then the real ones.
 *
 * Actual readings always win where they exist: they counted everybody at the
 * time, whereas the reconstruction counts only followers who are *still* here,
 * so it can never dip and understates the past.
 */
function mergeSnapshots(real: Snapshot[] | undefined, reconstructed: Snapshot[]): Snapshot[] {
  if (!real?.length) return reconstructed;
  const earliestReal = Math.min(...real.map((s) => new Date(s.t).getTime()));
  const history = reconstructed.filter((s) => new Date(s.t).getTime() < earliestReal);
  return [...history, ...real].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  );
}

/** Cumulative follower count over time from each follower's start timestamp. */
function reconstructSnapshots(followers: Profile[]): Snapshot[] {
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
  return snapshots;
}

/**
 * Seed the activity feed on a cold start: recent follows only. Unfollows need a
 * baseline to diff against, and an export has none.
 */
function seedRecentFollows(followers: Profile[]): FollowEvent[] {
  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
  return followers
    .filter((f) => f.since && new Date(f.since).getTime() >= cutoff)
    .map((f) => ({ username: f.username, kind: 'follow' as const, t: f.since!, name: f.name }))
    .sort((a, b) => (a.t < b.t ? 1 : -1));
}
