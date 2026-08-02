// ===== Instagram data-export format =====
//
// One parser for the official "Download Your Information" export (Accounts
// Centre → Your information and permissions → Download your information →
// Followers and following, JSON), plus the maths for folding one into the
// tracker's history.
//
// Three things read an export and they must agree exactly on what it says:
// the in-browser importer (importZip.ts), the committed-file backfiller
// (scripts/instagram-backfill.mjs), and the tests. They used to hold three
// copies of these functions, and the copies drifted — a `following.json`
// shape that one handled and another didn't imported zero following.
//
// Plain JavaScript with no imports on purpose: Node runs it as-is from the
// scripts, Vite bundles it into the app, and node:test exercises the same code
// both of them ship. Types live alongside in exportFormat.d.ts.

/** followers_1.json, followers_2.json, … */
export const FOLLOWERS_RE = /^followers(_\d+)?\.json$/i;
/** following.json */
export const FOLLOWING_RE = /^following(_\d+)?\.json$/i;
/** recently_unfollowed_profiles.json — accounts *you* unfollowed. */
export const UNFOLLOWED_RE = /^recently_unfollowed_profiles(_\d+)?\.json$/i;

/** Events kept in history.json, newest first. */
const MAX_EVENTS = 5000;

/** YYYY-MM-DD in the viewer's local time. */
export function dayKey(iso) {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ===== Reading the files =====

/**
 * Where the username lives, in priority order.
 *
 * The two files are not shaped alike, despite sitting in the same folder:
 * followers_*.json puts the handle in `value` and leaves `title` empty, while
 * following.json omits `value` entirely and puts the handle in `title`. Reading
 * only `value` silently yields zero following.
 */
export function usernameOf(row, sld) {
  const fromValue = sld?.value?.trim();
  if (fromValue) return fromValue;
  const fromTitle = row?.title?.trim();
  if (fromTitle) return fromTitle;
  // Last resort: https://www.instagram.com/<username>
  const m = sld?.href?.match(/instagram\.com\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).trim() : undefined;
}

/**
 * Handle top-level arrays plus the object wrappers Instagram uses
 * (`relationships_followers`, `relationships_following`).
 */
function toArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    return (
      json.relationships_followers ??
      json.relationships_following ??
      Object.values(json).find(Array.isArray) ??
      []
    );
  }
  return [];
}

/** Instagram wraps each list as [{ title, string_list_data: [...] }]. */
export function extractEntries(json) {
  const out = [];
  for (const row of toArray(json)) {
    const sld = row?.string_list_data?.[0];
    const username = usernameOf(row, sld);
    if (!username) continue;
    const since =
      typeof sld?.timestamp === 'number' && sld.timestamp > 0
        ? new Date(sld.timestamp * 1000).toISOString()
        : undefined;
    const title = row?.title?.trim() || undefined;
    // In following.json `title` *is* the handle, so it's not a display name.
    out.push({ username, name: title && title !== username ? title : undefined, since });
  }
  return out;
}

/**
 * Flatten several parsed documents of the same list into one entry per handle.
 *
 * A big account's followers arrive split across followers_1.json,
 * followers_2.json…, and the halves can overlap. Pass them in filename order:
 * the first sighting of a handle wins.
 */
export function collectProfiles(docs) {
  const seen = new Set();
  const out = [];
  for (const doc of docs) {
    for (const entry of extractEntries(doc)) {
      const key = entry.username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

/**
 * recently_unfollowed_profiles.json — accounts *you* unfollowed.
 *
 * A third shape again: no `string_list_data`, but a `label_values` array of
 * {label, value} pairs, with the handle under "Username".
 */
export function extractUnfollowed(json) {
  const out = [];
  for (const row of toArray(json)) {
    const labels = new Map(
      (row?.label_values ?? []).map((l) => [String(l?.label ?? '').toLowerCase(), l?.value]),
    );
    const username = String(labels.get('username') ?? '').trim();
    if (!username) continue;
    const name = String(labels.get('name') ?? '').trim() || undefined;
    if (typeof row?.timestamp !== 'number' || row.timestamp <= 0) continue;
    out.push({
      username,
      kind: 'unfollow',
      t: new Date(row.timestamp * 1000).toISOString(),
      name: name === username ? undefined : name,
      dir: 'out',
    });
  }
  return out;
}

// ===== Folding an export into the tracker's history =====

/**
 * Copy real relationship dates onto the live list. The export's timestamps are
 * ground truth; the daily puller can only record when it first *saw* someone,
 * so anyone it discovered gets stamped with that day instead of the real one.
 *
 * Nobody is added or removed: the live list is authoritative because the export
 * is already stale by the time Instagram hands it over.
 */
export function applyDates(live, fromExport) {
  const byName = new Map(
    fromExport.filter((p) => p.since).map((p) => [p.username.toLowerCase(), p]),
  );
  let dated = 0;
  const profiles = live.map((p) => {
    const match = byName.get(p.username.toLowerCase());
    if (!match) return p; // followed after the export was cut — keep what we have
    dated++;
    return { ...p, since: match.since, name: p.name ?? match.name };
  });
  return { profiles, dated };
}

/** Cumulative follower count over time from each follower's start timestamp. */
export function reconstructSnapshots(followers) {
  const times = followers
    .map((f) => f.since)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .sort((a, b) => a - b);

  const snapshots = [];
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
 * Reconstructed history before the first real reading, then the real ones.
 *
 * Actual readings always win where they exist: they counted everybody at the
 * time, whereas the reconstruction counts only followers who are *still* here,
 * so it can never dip and understates the past.
 */
export function mergeSnapshots(real, reconstructed) {
  if (!real?.length) return reconstructed;
  const earliestReal = Math.min(...real.map((s) => new Date(s.t).getTime()));
  const history = reconstructed.filter((s) => new Date(s.t).getTime() < earliestReal);
  return [...history, ...real].sort((a, b) => new Date(a.t) - new Date(b.t));
}

/**
 * Fold outbound events in without duplicating what the daily job already saw.
 * Identity is (direction, kind, handle, day) — the export's timestamp and the
 * job's detection time differ, so matching on the exact instant would double up.
 */
export function mergeOutbound(existing, incoming) {
  const id = (e) => `${e.dir ?? 'in'}|${e.kind}|${e.username.toLowerCase()}|${dayKey(e.t)}`;
  const seen = new Set((existing ?? []).map(id));
  const added = incoming.filter((e) => {
    if (seen.has(id(e))) return false;
    seen.add(id(e));
    return true;
  });
  return {
    events: [...(existing ?? []), ...added].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, MAX_EVENTS),
    added: added.length,
  };
}
