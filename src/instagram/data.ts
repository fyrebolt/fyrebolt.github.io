// ===== Instagram tracker data model =====
//
// The site is static, so the data is produced out-of-band and committed as
// public/instagram/history.json. Two producers write that file:
//
//   • scripts/instagram-pull.mjs — the daily job (launchd, once a day) that
//     pages the followers/following lists and diffs them into events.
//   • the in-browser importer (importZip.ts) — a one-off bootstrap from the
//     official "Download Your Information" export.
//
// The app just loads whichever is newer and renders it.

/** A single reading of the account's counts at a point in time. */
export interface Snapshot {
  /** ISO timestamp of the reading. */
  t: string;
  /** Follower count at that moment. */
  followers: number;
  /** Following count, when the producer recorded one. */
  following?: number;
}

/** A follow / unfollow event detected between two checks (inbound: them → you). */
export interface FollowEvent {
  username: string;
  kind: 'follow' | 'unfollow';
  /** ISO timestamp when the change was first detected. */
  t: string;
  /** Display name at detection time, when known. */
  name?: string;
}

/** One account in a followers/following list. */
export interface Profile {
  username: string;
  /** Display name, when available. */
  name?: string;
  // No profile-pic URL on purpose: Instagram's are signed and expire, so
  // persisting them would churn a few hundred KB into every daily commit and
  // still 404 within days. The UI derives a stable gradient from the username.
  verified?: boolean;
  private?: boolean;
  /**
   * ISO timestamp the relationship started — when they followed you (in the
   * followers list) or when you followed them (in the following list). Exact
   * from an export ZIP; first-seen-by-the-tracker from the daily puller.
   */
  since?: string;
}

export interface TrackerData {
  /** Handle being tracked (without the @). */
  account: string;
  /** ISO timestamp of the most recent successful check. */
  generatedAt: string;
  /** True while showing seeded demo data (no real data pulled yet). */
  sample?: boolean;
  /** Follower-count history, oldest first — powers the lifetime graph. */
  snapshots: Snapshot[];
  /** Follow/unfollow events, newest first. */
  events: FollowEvent[];
  /** Accounts that follow you. */
  followers?: Profile[];
  /** Accounts you follow. */
  following?: Profile[];
}

/** Fetch the committed history file. Returns null on any failure. */
export async function loadTrackerData(): Promise<TrackerData | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}instagram/history.json`, {
      cache: 'no-cache',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as TrackerData;
    if (!Array.isArray(data.snapshots) || !Array.isArray(data.events)) return null;
    return data;
  } catch {
    return null;
  }
}

// ===== Local (in-browser) persistence for imported data =====
// Imported exports are kept in localStorage so the real data survives reloads on
// this device without any server. Use the Download button to publish it.

const LOCAL_KEY = 'ig-tracker-data-v1';

export function loadLocalData(): TrackerData | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as TrackerData;
    if (!Array.isArray(data.snapshots) || !Array.isArray(data.events)) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveLocalData(data: TrackerData): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch {
    /* quota or private mode — ignore, the in-memory state still works */
  }
}

export function clearLocalData(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

/** Trigger a download of the tracker data as history.json (to commit & publish). */
export function downloadHistoryJson(data: TrackerData): void {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'history.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** YYYY-MM-DD in the viewer's local time. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DayBucket {
  key: string;
  follows: FollowEvent[];
  unfollows: FollowEvent[];
}

/** Group events into per-day buckets, newest day first. */
export function groupByDay(events: FollowEvent[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const ev of events) {
    const key = dayKey(ev.t);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, follows: [], unfollows: [] };
      map.set(key, bucket);
    }
    if (ev.kind === 'follow') bucket.follows.push(ev);
    else bucket.unfollows.push(ev);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

export interface RangeStats {
  current: number;
  start: number;
  delta: number;
  peak: number;
  low: number;
}

/** Follower stats over the snapshots that fall within the last `days` (0 = all). */
export function statsForRange(snapshots: Snapshot[], days: number): RangeStats {
  const pts = filterRange(snapshots, days);
  const current = pts.length ? pts[pts.length - 1].followers : 0;
  const start = pts.length ? pts[0].followers : 0;
  const counts = pts.map((p) => p.followers);
  return {
    current,
    start,
    delta: current - start,
    peak: counts.length ? Math.max(...counts) : 0,
    low: counts.length ? Math.min(...counts) : 0,
  };
}

/** Snapshots within the last `days` (0 = all of them). */
export function filterRange(snapshots: Snapshot[], days: number): Snapshot[] {
  if (!days) return snapshots;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const within = snapshots.filter((s) => new Date(s.t).getTime() >= cutoff);
  // Always keep at least the last two points so the graph never collapses.
  return within.length >= 2 ? within : snapshots.slice(-2);
}

// ===== Relationship sets =====

/**
 * The five ways to slice the two lists. `fans` follow you without being
 * followed back; `ghosts` are the ones you follow who don't follow you back.
 */
export type ListKind = 'followers' | 'following' | 'mutuals' | 'fans' | 'ghosts';

export interface Relationships {
  followers: Profile[];
  following: Profile[];
  /** Follow each other. */
  mutuals: Profile[];
  /** They follow you, you don't follow them back. */
  fans: Profile[];
  /** You follow them, they don't follow you back. */
  ghosts: Profile[];
}

/** Split the two lists into the five views. Case-insensitive on username. */
export function relationships(followers: Profile[], following: Profile[]): Relationships {
  const followerKeys = new Set(followers.map((p) => p.username.toLowerCase()));
  const followingKeys = new Set(following.map((p) => p.username.toLowerCase()));

  return {
    followers,
    following,
    mutuals: followers.filter((p) => followingKeys.has(p.username.toLowerCase())),
    fans: followers.filter((p) => !followingKeys.has(p.username.toLowerCase())),
    ghosts: following.filter((p) => !followerKeys.has(p.username.toLowerCase())),
  };
}

export type SortKey = 'recent' | 'oldest' | 'az';

/** Case-insensitive filter of profiles by username or display name. */
export function searchProfiles(profiles: Profile[], query: string): Profile[] {
  const q = query.trim().toLowerCase();
  if (!q) return profiles;
  return profiles.filter(
    (p) => p.username.toLowerCase().includes(q) || (p.name?.toLowerCase().includes(q) ?? false),
  );
}

/** Sort a copy of `profiles`. Entries with no `since` sink to the bottom of date sorts. */
export function sortProfiles(profiles: Profile[], key: SortKey): Profile[] {
  const out = [...profiles];
  if (key === 'az') {
    out.sort((a, b) => a.username.localeCompare(b.username));
    return out;
  }
  const time = (p: Profile) => (p.since ? new Date(p.since).getTime() : NaN);
  out.sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return a.username.localeCompare(b.username);
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return key === 'recent' ? tb - ta : ta - tb;
  });
  return out;
}

/** Nicely formatted relative "updated" string. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Short absolute date for a relationship start, e.g. "Mar 2024". */
export function monthYear(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
}
