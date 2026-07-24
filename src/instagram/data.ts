// ===== Instagram tracker data model =====
//
// The site is static, so the data is produced out-of-band by an hourly GitHub
// Action (see .github/workflows/instagram-tracker.yml + scripts/instagram_tracker.py)
// which commits public/instagram/history.json. The app just fetches and renders it.

/** A single follower-count reading at a point in time. */
export interface Snapshot {
  /** ISO timestamp of the reading. */
  t: string;
  /** Follower count at that moment. */
  followers: number;
}

/** A follow / unfollow event detected between two hourly checks. */
export interface FollowEvent {
  username: string;
  kind: 'follow' | 'unfollow';
  /** ISO timestamp when the change was first detected. */
  t: string;
}

/** A current follower (for the searchable list). */
export interface Follower {
  username: string;
  /** Display name, when available. */
  name?: string;
}

export interface TrackerData {
  /** Handle being tracked (without the @). */
  account: string;
  /** ISO timestamp of the most recent successful check. */
  generatedAt: string;
  /** True while showing seeded demo data (no live Instagram session connected yet). */
  sample?: boolean;
  /** Follower-count history, oldest first — powers the lifetime graph. */
  snapshots: Snapshot[];
  /** Follow/unfollow events, newest first. */
  events: FollowEvent[];
  /** Current followers, for the searchable list (present once a session is connected). */
  followers?: Follower[];
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

/** Case-insensitive filter of followers by username or display name. */
export function searchFollowers(followers: Follower[], query: string): Follower[] {
  const q = query.trim().toLowerCase();
  if (!q) return followers;
  return followers.filter(
    (f) => f.username.toLowerCase().includes(q) || (f.name?.toLowerCase().includes(q) ?? false),
  );
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
