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

import { dayKey } from './exportFormat.js';

/** A single reading of the account's counts at a point in time. */
export interface Snapshot {
  /** ISO timestamp of the reading. */
  t: string;
  /** Follower count at that moment. */
  followers: number;
  /** Following count, when the producer recorded one. */
  following?: number;
}

/** A follow / unfollow event detected between two checks. */
export interface FollowEvent {
  username: string;
  kind: 'follow' | 'unfollow';
  /** ISO timestamp when the change was first detected. */
  t: string;
  /** Display name at detection time, when known. */
  name?: string;
  /**
   * Who acted. 'in' — they followed/unfollowed you; 'out' — you followed or
   * unfollowed them. Absent means 'in', which is what every event recorded
   * before outbound tracking existed was.
   */
  dir?: 'in' | 'out';
  /**
   * Set only on an unfollow nothing could confirm, accepted because the account
   * had been missing from this many consecutive reads. Provenance, not decor:
   * these are the events the tracker inferred rather than checked.
   */
  absent?: number;
}

/** Events without a direction predate outbound tracking and are inbound. */
export function isOutbound(e: FollowEvent): boolean {
  return e.dir === 'out';
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
  /**
   * Consecutive reads this account has been missing from, written by the pull.
   * Present only while a streak is running, and cleared the moment they show up
   * again — it's what lets a lasting disappearance settle an unfollow that
   * Instagram would never confirm.
   */
  missing?: number;
}

/**
 * The schedule the daily pull is installed on, as it read it out of its own
 * LaunchAgent. Absent when the job isn't installed — the file may equally have
 * been written by a manual run.
 */
export interface PullSchedule {
  /** Wall-clock hours the job fires at, ascending. Retries: it stops at the first success. */
  hours: number[];
  /** Minute past each of those hours. */
  minute: number;
  /** IANA zone of the Mac that runs the job — the hours above are its clock, not yours. */
  timeZone?: string;
  /** What put it there. Only 'launchd' today. */
  source?: string;
}

export interface TrackerData {
  /** Handle being tracked (without the @). */
  account: string;
  /** ISO timestamp of the most recent successful check. */
  generatedAt: string;
  /** When the next automatic pull is due, if the job is installed. */
  schedule?: PullSchedule;
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

// dayKey lives in exportFormat.js — that module has to stay import-free so Node
// can run it straight from the scripts, so it owns the helper and the data model
// re-exports it (see the import at the top of this file).
export { dayKey };

export interface DayBucket {
  key: string;
  /** They followed you. */
  follows: FollowEvent[];
  /** They unfollowed you. */
  unfollows: FollowEvent[];
  /** What you did that day — follows and unfollows both, tagged by `kind`. */
  outbound: FollowEvent[];
}

/** Group events into per-day buckets, newest day first. */
export function groupByDay(events: FollowEvent[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const ev of events) {
    const key = dayKey(ev.t);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, follows: [], unfollows: [], outbound: [] };
      map.set(key, bucket);
    }
    if (isOutbound(ev)) bucket.outbound.push(ev);
    else if (ev.kind === 'follow') bucket.follows.push(ev);
    else bucket.unfollows.push(ev);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** Everything known to have happened on one local day. */
export interface DayActivity {
  key: string;
  /** Who followed you that day. */
  follows: Profile[];
  /** Who unfollowed. Only exists from when daily tracking began. */
  unfollows: FollowEvent[];
  /** What you did that day — your own follows and unfollows. */
  outbound: FollowEvent[];
}

/**
 * Index activity by local day, for the chart's detail panel.
 *
 * The two halves have very different provenance, and the UI says so:
 * follows are derived from each follower's `since`, so they're known across the
 * whole history — but only for people who are *still* following. Unfollows come
 * from the event log, which starts when daily tracking did. Nothing can recover
 * an unfollow from before that.
 */
export function buildDayActivity(
  followers: Profile[],
  events: FollowEvent[],
): Map<string, DayActivity> {
  const map = new Map<string, DayActivity>();
  const at = (key: string) => {
    let d = map.get(key);
    if (!d) {
      d = { key, follows: [], unfollows: [], outbound: [] };
      map.set(key, d);
    }
    return d;
  };

  for (const p of followers) {
    if (p.since) at(dayKey(p.since)).follows.push(p);
  }
  for (const e of events) {
    const d = at(dayKey(e.t));
    if (isOutbound(e)) d.outbound.push(e);
    else if (e.kind === 'unfollow') d.unfollows.push(e);
  }
  return map;
}

/**
 * The first day with a real reading, i.e. when unfollow tracking began.
 *
 * Reconstructed points carry a follower count only; the daily puller also
 * records `following`. That difference is the marker — before this date the
 * curve is inferred, after it it was actually measured.
 */
export function trackingStartedAt(snapshots: Snapshot[]): string | null {
  const first = snapshots.find((s) => typeof s.following === 'number');
  return first ? first.t : null;
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

// ===== Per-account insight (the profile popup) =====

/**
 * Position of each account in a list, ordered oldest-relationship first.
 *
 * Only entries carrying a date can be ranked; undated ones are left out rather
 * than crowded to the end, since a made-up position would read as fact.
 */
export function buildRanks(list: Profile[]): Map<string, number> {
  const dated = list
    .filter((p) => p.since)
    .sort((a, b) => new Date(a.since!).getTime() - new Date(b.since!).getTime());
  const ranks = new Map<string, number>();
  dated.forEach((p, i) => ranks.set(p.username.toLowerCase(), i + 1));
  return ranks;
}

export interface Insight {
  username: string;
  name?: string;
  verified?: boolean;
  private?: boolean;
  /** They follow you. */
  followsYou: boolean;
  /** You follow them. */
  youFollow: boolean;
  /** When they followed you. */
  followedYouAt?: string;
  /** When you followed them. */
  youFollowedAt?: string;
  /** Their position among your followers, oldest first. */
  followerRank?: number;
  followerTotal: number;
  /** Their position among the accounts you follow, oldest first. */
  followingRank?: number;
  followingTotal: number;
  /** Everything the tracker has recorded about this account. */
  events: FollowEvent[];
}

/**
 * Everything known about one account, pulled from both lists and the event log.
 *
 * Ranks are positions among *current* relationships. Anyone who followed and
 * later left isn't in the data at all, so a true all-time position isn't
 * recoverable — the UI says "of your N followers" rather than implying otherwise.
 */
export function insightFor(
  username: string,
  data: TrackerData,
  followerRanks: Map<string, number>,
  followingRanks: Map<string, number>,
): Insight {
  const key = username.toLowerCase();
  const asFollower = (data.followers ?? []).find((p) => p.username.toLowerCase() === key);
  const asFollowing = (data.following ?? []).find((p) => p.username.toLowerCase() === key);

  return {
    username: asFollower?.username ?? asFollowing?.username ?? username,
    name: asFollower?.name ?? asFollowing?.name,
    verified: asFollower?.verified ?? asFollowing?.verified,
    private: asFollower?.private ?? asFollowing?.private,
    followsYou: Boolean(asFollower),
    youFollow: Boolean(asFollowing),
    followedYouAt: asFollower?.since,
    youFollowedAt: asFollowing?.since,
    followerRank: followerRanks.get(key),
    followerTotal: (data.followers ?? []).length,
    followingRank: followingRanks.get(key),
    followingTotal: (data.following ?? []).length,
    events: data.events.filter((e) => e.username.toLowerCase() === key),
  };
}

/**
 * "Mar 14, 2025" — one specific day. Takes either an ISO instant or a
 * YYYY-MM-DD day key, and yields '' for anything it can't read.
 */
export function exactDate(iso: string | undefined): string {
  if (!iso) return '';
  // A bare day key means a *local* day: new Date('2026-07-30') reads it as UTC
  // midnight, which renders as the 29th anywhere west of Greenwich.
  const key = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = key ? new Date(+key[1], +key[2] - 1, +key[3]) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
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

/**
 * How far behind the data is. The pull is scheduled daily, so anything past ~40
 * hours means at least one run was missed — usually an expired session cookie.
 * The site is static and can't check on the job itself, so surfacing the age of
 * the data is the only way it can flag that tracking has stalled.
 */
export function staleness(generatedAt: string): { hours: number; level: 'ok' | 'warn' | 'bad' } {
  const hours = (Date.now() - new Date(generatedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 40) return { hours, level: 'ok' };
  return { hours, level: hours < 96 ? 'warn' : 'bad' };
}

/** Short absolute date for a relationship start, e.g. "Mar 2024". */
export function monthYear(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
}
