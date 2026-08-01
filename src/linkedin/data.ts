// ===== LinkedIn tracker data model =====
//
// Same shape of idea as the Instagram tracker: the site is static, so the data
// is produced out-of-band and committed as public/linkedin/history.json. Two
// producers write it:
//
//   • scripts/linkedin-pull.mjs — the daily job (launchd) that reads your
//     connections, follower count and profile viewers, and merges them in.
//   • the in-browser importer (importExport.ts) — a one-off bootstrap from the
//     official "Get a copy of your data" export (Connections.csv etc.).
//
// Two things make LinkedIn different from Instagram, and they shape everything
// below:
//
//   1. Connections are *mutual* by definition, so there's no follow-back maths.
//      Followers are the asymmetric half — people who follow you without
//      connecting — and they're tracked separately.
//   2. Profile views are the headline feature, and they're *ephemeral*.
//      LinkedIn shows a free account only its last handful of viewers, and
//      drops them after 90 days. So the tracker accumulates: every run unions
//      the newly visible viewers into a permanent log, which over months
//      becomes a history LinkedIn itself will not show you.

/** A single reading of the account's counts at a point in time. */
export interface Snapshot {
  /** ISO timestamp of the reading. */
  t: string;
  /** Connections (1st degree) at that moment. */
  connections: number;
  /** Followers, when the producer recorded one. */
  followers?: number;
  /**
   * The rolling "profile views in the last 90 days" figure LinkedIn reports.
   * Distinct from the per-day counts derived from `views` below: this one is
   * LinkedIn's own total, and it counts viewers the free tier never names.
   */
  viewsRolling?: number;
  /** The rolling "search appearances" figure, when available. */
  searchAppearances?: number;
}

/**
 * A change in the network, detected between two runs.
 *
 * `connect`/`disconnect` are mutual and carry no direction. `follow`/`unfollow`
 * are one-way: `dir: 'in'` is someone following you, `'out'` is you following
 * a person or page.
 */
export interface NetworkEvent {
  /** Public profile id — the slug in linkedin.com/in/<id>. */
  id: string;
  kind: 'connect' | 'disconnect' | 'follow' | 'unfollow';
  /** ISO timestamp when the change was first detected. */
  t: string;
  /** Display name at detection time, when known. */
  name?: string;
  /** Headline at detection time, when known. */
  headline?: string;
  /** Only meaningful for follow/unfollow. Absent means inbound. */
  dir?: 'in' | 'out';
}

/** Events without a direction are inbound (and connections are mutual). */
export function isOutbound(e: NetworkEvent): boolean {
  return e.dir === 'out';
}

/** One person in a connections or followers list. */
export interface Person {
  /** Public profile id — the slug in linkedin.com/in/<id>. The stable key. */
  id: string;
  /** Display name, when available. */
  name?: string;
  /** The one-line headline under their name. */
  headline?: string;
  /** Current employer, when LinkedIn broke it out separately. */
  company?: string;
  /** Where they say they are. */
  location?: string;
  // No profile-photo URL on purpose: LinkedIn's media URLs are signed and
  // expire, so persisting them would churn hundreds of KB into every daily
  // commit and still 404 within days. The UI derives a stable gradient instead.
  /**
   * ISO timestamp the relationship started — when you connected, or when they
   * followed you. Exact from the official export (Connections.csv has a
   * "Connected On" column); first-seen-by-the-tracker from the daily puller.
   */
  since?: string;
}

/**
 * One recorded visit to your profile.
 *
 * LinkedIn describes viewers at whatever resolution your privacy settings and
 * subscription allow. Named viewers carry an `id`; the rest arrive as a
 * description only ("Someone at Acme", "Someone in the Software industry"),
 * which is kept verbatim in `label` rather than discarded — the pattern of
 * anonymous viewers is still information.
 */
export interface ProfileView {
  /** ISO timestamp of the view, as LinkedIn reported it. */
  t: string;
  /** Public profile id, when LinkedIn named the viewer. */
  id?: string;
  name?: string;
  headline?: string;
  company?: string;
  /** LinkedIn only described them — no identity available. */
  anonymous?: boolean;
  /** What LinkedIn showed in place of a name. */
  label?: string;
  /** Degree of separation (1 = a connection). */
  degree?: number;
  /**
   * ISO timestamp the tracker first saw this record. Views can surface days
   * after they happened, so this is the honest answer to "when did we learn
   * about it" — `t` is the honest answer to "when did it happen".
   */
  seen?: string;
}

export interface TrackerData {
  /** Public profile id being tracked — the slug in linkedin.com/in/<id>. */
  profile: string;
  /** Your display name, for the header. */
  name?: string;
  /** ISO timestamp of the most recent successful check. */
  generatedAt: string;
  /** True while showing seeded demo data (no real data pulled yet). */
  sample?: boolean;
  /**
   * Viewer identities were withheld from this file — see the puller's
   * `publishViewers` setting. The counts and shapes are all still real.
   */
  redacted?: boolean;
  /** Count history, oldest first — powers the graph. */
  snapshots: Snapshot[];
  /** Connect/disconnect/follow events, newest first. */
  events: NetworkEvent[];
  /** Your 1st-degree connections. */
  connections?: Person[];
  /** People who follow you without being connected. */
  followers?: Person[];
  /** Every profile view the tracker has ever recorded, newest first. */
  views?: ProfileView[];
}

/** Fetch the committed history file. Returns null on any failure. */
export async function loadTrackerData(): Promise<TrackerData | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}linkedin/history.json`, {
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

// ===== Local (in-browser) persistence =====
//
// Imported data is kept in localStorage so it survives reloads on this device
// without any server. This is also how the *unredacted* viewer log gets viewed:
// the puller writes it outside public/, you drop that file onto the page, and it
// stays on your machine.

const LOCAL_KEY = 'li-tracker-data-v1';

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

// ===== Dates =====

/** YYYY-MM-DD in the viewer's local time. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Mar 14, 2025" — a specific day. */
export function exactDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Short absolute date for a relationship start, e.g. "Mar 2024". */
export function monthYear(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
}

/**
 * Up to two initials for an avatar. LinkedIn is a real-names network, so these
 * read well — but ids arrive as slugs ("ada-lovelace-1a2b") whose trailing hash
 * is not a name, hence the filter for word-initial letters.
 */
export function initialsOf(source: string): string {
  const words = source
    .replace(/^name:/, '')
    .split(/[\s\-_.]+/)
    .filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return source.slice(0, 1).toUpperCase() || '?';
  return [words[0], words[1]]
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('');
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
 * hours means at least one run was missed — usually an expired `li_at` cookie.
 * The site is static and can't check on the job itself, so surfacing the age of
 * the data is the only way it can flag that tracking has stalled.
 *
 * This matters more here than on Instagram: a follower list you miss is still
 * there tomorrow, but LinkedIn drops profile viewers off the list after a few
 * days, and a missed run loses them permanently.
 */
export function staleness(generatedAt: string): { hours: number; level: 'ok' | 'warn' | 'bad' } {
  const hours = (Date.now() - new Date(generatedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 40) return { hours, level: 'ok' };
  return { hours, level: hours < 96 ? 'warn' : 'bad' };
}

// ===== Snapshot series =====

/** The three things worth plotting over time. */
export type SeriesKey = 'connections' | 'followers' | 'views';

/** Pull one series out of a snapshot, or null when that run didn't record it. */
export function seriesValue(s: Snapshot, key: SeriesKey): number | null {
  if (key === 'connections') return s.connections;
  if (key === 'followers') return s.followers ?? null;
  return s.viewsRolling ?? null;
}

/** Snapshots within the last `days` (0 = all of them). */
export function filterRange(snapshots: Snapshot[], days: number): Snapshot[] {
  if (!days) return snapshots;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const within = snapshots.filter((s) => new Date(s.t).getTime() >= cutoff);
  // Always keep at least the last two points so the graph never collapses.
  return within.length >= 2 ? within : snapshots.slice(-2);
}

export interface RangeStats {
  current: number;
  start: number;
  delta: number;
  peak: number;
  low: number;
}

/** Stats for one series over the snapshots that fall within the last `days`. */
export function statsForRange(snapshots: Snapshot[], days: number, key: SeriesKey): RangeStats {
  const vals = filterRange(snapshots, days)
    .map((s) => seriesValue(s, key))
    .filter((v): v is number => v != null);
  const current = vals.length ? vals[vals.length - 1] : 0;
  const start = vals.length ? vals[0] : 0;
  return {
    current,
    start,
    delta: current - start,
    peak: vals.length ? Math.max(...vals) : 0,
    low: vals.length ? Math.min(...vals) : 0,
  };
}

/**
 * The first day with a real reading, i.e. when tracking began.
 *
 * Connections reconstructed from the official export carry a date but no
 * follower count; the daily puller records one. That difference is the marker —
 * before this date the curve is inferred, after it it was measured.
 */
export function trackingStartedAt(snapshots: Snapshot[]): string | null {
  const first = snapshots.find((s) => typeof s.followers === 'number');
  return first ? first.t : null;
}

// ===== Profile views =====

/**
 * The identity of a viewer, for de-duplication and repeat-visit counting.
 *
 * Anonymous viewers have no id, so they fall back to the description LinkedIn
 * showed. Two different people described identically are indistinguishable —
 * which is exactly what LinkedIn intends, and the UI says so rather than
 * pretending the rollup is a headcount.
 */
export function viewerKey(v: ProfileView): string {
  return v.id ? `id:${v.id.toLowerCase()}` : `anon:${(v.label ?? 'someone').toLowerCase()}`;
}

/** Views that happened within the last `days` (0 = all of them). */
export function viewsInRange(views: ProfileView[], days: number): ProfileView[] {
  if (!days) return views;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return views.filter((v) => new Date(v.t).getTime() >= cutoff);
}

export interface ViewStats {
  /** Total recorded views. */
  total: number;
  /** Views where LinkedIn named the viewer. */
  named: number;
  /** Views from viewers LinkedIn would only describe. */
  anonymous: number;
  /** Distinct named viewers. */
  people: number;
  /** Named viewers who came back more than once. */
  repeat: number;
  /** Busiest single day in the window, or null when there were no views. */
  busiestDay: { key: string; count: number } | null;
}

export function viewStats(views: ProfileView[]): ViewStats {
  const perKey = new Map<string, number>();
  const perDay = new Map<string, number>();
  let named = 0;

  for (const v of views) {
    if (v.id) named++;
    perKey.set(viewerKey(v), (perKey.get(viewerKey(v)) ?? 0) + 1);
    const day = dayKey(v.t);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const namedKeys = [...perKey.entries()].filter(([k]) => k.startsWith('id:'));
  let busiestDay: { key: string; count: number } | null = null;
  for (const [key, count] of perDay) {
    if (!busiestDay || count > busiestDay.count) busiestDay = { key, count };
  }

  return {
    total: views.length,
    named,
    anonymous: views.length - named,
    people: namedKeys.length,
    repeat: namedKeys.filter(([, n]) => n > 1).length,
    busiestDay,
  };
}

/** A day's worth of profile views, newest day first when sorted. */
export interface ViewDay {
  key: string;
  count: number;
  views: ProfileView[];
}

/** Group views into per-day buckets, newest day first. */
export function groupViewsByDay(views: ProfileView[]): ViewDay[] {
  const map = new Map<string, ViewDay>();
  for (const v of views) {
    const key = dayKey(v.t);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, count: 0, views: [] };
      map.set(key, bucket);
    }
    bucket.count++;
    bucket.views.push(v);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/**
 * A continuous run of days ending today, oldest first — including the days with
 * no views at all, which a bare `groupViewsByDay` would omit and which the bar
 * chart needs in order to show a gap as a gap.
 */
export function viewsPerDay(views: ProfileView[], days: number): ViewDay[] {
  const byDay = new Map(groupViewsByDay(views).map((d) => [d.key, d]));
  const out: ViewDay[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(cursor.getTime() - i * 24 * 60 * 60 * 1000);
    const key = dayKey(d.toISOString());
    out.push(byDay.get(key) ?? { key, count: 0, views: [] });
  }
  return out;
}

/** One distinct viewer, with everything the log knows about their visits. */
export interface Viewer {
  key: string;
  id?: string;
  name?: string;
  headline?: string;
  company?: string;
  label?: string;
  anonymous: boolean;
  degree?: number;
  /** How many times they've shown up. */
  visits: number;
  /** Most recent visit. */
  lastAt: string;
  /** Earliest recorded visit. */
  firstAt: string;
}

/**
 * Collapse the view log into one row per viewer, most recent visit first.
 *
 * Later records win on the descriptive fields, so a viewer who changed jobs
 * shows the title they have now rather than the one they had on their first
 * visit.
 */
export function collapseViewers(views: ProfileView[]): Viewer[] {
  const map = new Map<string, Viewer>();

  // Oldest first so the newest record is the last write on each field.
  const ordered = [...views].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  for (const v of ordered) {
    const key = viewerKey(v);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        key,
        id: v.id,
        name: v.name,
        headline: v.headline,
        company: v.company,
        label: v.label,
        anonymous: !v.id,
        degree: v.degree,
        visits: 1,
        firstAt: v.t,
        lastAt: v.t,
      });
      continue;
    }
    map.set(key, {
      ...prev,
      name: v.name ?? prev.name,
      headline: v.headline ?? prev.headline,
      company: v.company ?? prev.company,
      label: v.label ?? prev.label,
      degree: v.degree ?? prev.degree,
      visits: prev.visits + 1,
      lastAt: v.t,
    });
  }

  return [...map.values()].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

/** Top `limit` values of one viewer field, by number of views. */
export function topBy(
  views: ProfileView[],
  field: 'company' | 'headline',
  limit = 6,
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of views) {
    const value = v[field]?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export type ViewerFilter = 'all' | 'named' | 'anonymous' | 'repeat';

export function filterViewers(viewers: Viewer[], filter: ViewerFilter): Viewer[] {
  if (filter === 'named') return viewers.filter((v) => !v.anonymous);
  if (filter === 'anonymous') return viewers.filter((v) => v.anonymous);
  if (filter === 'repeat') return viewers.filter((v) => v.visits > 1);
  return viewers;
}

/** Case-insensitive filter of viewers by name, headline, company or label. */
export function searchViewers(viewers: Viewer[], query: string): Viewer[] {
  const q = query.trim().toLowerCase();
  if (!q) return viewers;
  return viewers.filter((v) =>
    [v.name, v.headline, v.company, v.label, v.id].some((s) => s?.toLowerCase().includes(q)),
  );
}

// ===== Network events =====

export interface DayBucket {
  key: string;
  /** New connections that day. */
  connects: NetworkEvent[];
  /** Connections lost that day. */
  disconnects: NetworkEvent[];
  /** New followers, and unfollows. */
  follows: NetworkEvent[];
}

/** Group events into per-day buckets, newest day first. */
export function groupByDay(events: NetworkEvent[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const ev of events) {
    const key = dayKey(ev.t);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, connects: [], disconnects: [], follows: [] };
      map.set(key, bucket);
    }
    if (ev.kind === 'connect') bucket.connects.push(ev);
    else if (ev.kind === 'disconnect') bucket.disconnects.push(ev);
    else bucket.follows.push(ev);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

// ===== People lists =====

/**
 * The four ways to slice the two lists. Connections are mutual, so unlike
 * Instagram there's no "you don't follow back" — the asymmetry that does exist
 * is between connecting and merely following.
 */
export type ListKind = 'connections' | 'followers' | 'both' | 'onlyFollowers';

export interface Relationships {
  connections: Person[];
  followers: Person[];
  /** Connected *and* following — the most engaged slice. */
  both: Person[];
  /** Following you without ever connecting. */
  onlyFollowers: Person[];
}

/** Split the two lists into the four views. Case-insensitive on id. */
export function relationships(connections: Person[], followers: Person[]): Relationships {
  const connectionKeys = new Set(connections.map((p) => p.id.toLowerCase()));
  const followerKeys = new Set(followers.map((p) => p.id.toLowerCase()));

  return {
    connections,
    followers,
    both: connections.filter((p) => followerKeys.has(p.id.toLowerCase())),
    onlyFollowers: followers.filter((p) => !connectionKeys.has(p.id.toLowerCase())),
  };
}

export type SortKey = 'recent' | 'oldest' | 'az';

/** Case-insensitive filter of people by name, headline, company or id. */
export function searchPeople(people: Person[], query: string): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  return people.filter((p) =>
    [p.name, p.headline, p.company, p.id].some((s) => s?.toLowerCase().includes(q)),
  );
}

/** Sort a copy of `people`. Entries with no `since` sink to the bottom of date sorts. */
export function sortPeople(people: Person[], key: SortKey): Person[] {
  const out = [...people];
  const label = (p: Person) => p.name ?? p.id;
  if (key === 'az') {
    out.sort((a, b) => label(a).localeCompare(label(b)));
    return out;
  }
  const time = (p: Person) => (p.since ? new Date(p.since).getTime() : NaN);
  out.sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return label(a).localeCompare(label(b));
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return key === 'recent' ? tb - ta : ta - tb;
  });
  return out;
}

// ===== Per-person insight (the profile popup) =====

/**
 * Position of each person in a list, ordered oldest-relationship first.
 *
 * Only entries carrying a date can be ranked; undated ones are left out rather
 * than crowded to the end, since a made-up position would read as fact.
 */
export function buildRanks(list: Person[]): Map<string, number> {
  const dated = list
    .filter((p) => p.since)
    .sort((a, b) => new Date(a.since!).getTime() - new Date(b.since!).getTime());
  const ranks = new Map<string, number>();
  dated.forEach((p, i) => ranks.set(p.id.toLowerCase(), i + 1));
  return ranks;
}

export interface Insight {
  id: string;
  name?: string;
  headline?: string;
  company?: string;
  location?: string;
  /** They're a 1st-degree connection. */
  connected: boolean;
  /** They follow you. */
  followsYou: boolean;
  connectedAt?: string;
  followedYouAt?: string;
  /** Their position among your connections, oldest first. */
  connectionRank?: number;
  connectionTotal: number;
  /** Everything the tracker has recorded about them. */
  events: NetworkEvent[];
  /** Every time they've viewed your profile. */
  views: ProfileView[];
}

/**
 * Everything known about one person, from both lists, the event log and the
 * view log.
 *
 * Ranks are positions among *current* connections. Anyone who connected and
 * later disconnected isn't in the data at all, so a true all-time position isn't
 * recoverable — the UI says "of your N connections" rather than implying
 * otherwise.
 */
export function insightFor(
  id: string,
  data: TrackerData,
  connectionRanks: Map<string, number>,
): Insight {
  const key = id.toLowerCase();
  const asConnection = (data.connections ?? []).find((p) => p.id.toLowerCase() === key);
  const asFollower = (data.followers ?? []).find((p) => p.id.toLowerCase() === key);
  const views = (data.views ?? []).filter((v) => v.id?.toLowerCase() === key);

  return {
    id: asConnection?.id ?? asFollower?.id ?? id,
    name: asConnection?.name ?? asFollower?.name ?? views[0]?.name,
    headline: asConnection?.headline ?? asFollower?.headline ?? views[0]?.headline,
    company: asConnection?.company ?? asFollower?.company ?? views[0]?.company,
    location: asConnection?.location ?? asFollower?.location,
    connected: Boolean(asConnection),
    followsYou: Boolean(asFollower),
    connectedAt: asConnection?.since,
    followedYouAt: asFollower?.since,
    connectionRank: connectionRanks.get(key),
    connectionTotal: (data.connections ?? []).length,
    events: data.events.filter((e) => e.id.toLowerCase() === key),
    views,
  };
}
