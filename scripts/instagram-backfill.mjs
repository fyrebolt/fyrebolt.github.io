#!/usr/bin/env node
// ===== Backfill real relationship dates from an Instagram data export =====
//
// The private API the daily job uses never says *when* someone followed you, so
// it can only record when it first saw them. The official export does carry the
// real timestamps — this folds them into the committed history.json so every
// device and visitor gets them, instead of each browser having to import its own
// copy into localStorage.
//
// Mirrors the semantics of the in-browser importer (src/instagram/importZip.ts):
// an export is a *historical document*, not a fresher reading. Instagram takes
// hours to prepare one, so it is already stale on arrival. It is therefore used
// only for what it alone knows, and never to add or remove people:
//
//   • relationship dates — the export's are ground truth
//   • historical snapshots, but only before the first real reading
//   • no events, ever: an export lists who follows you *now*, so it can neither
//     prove nor disprove an unfollow
//
// Usage:
//   node scripts/instagram-backfill.mjs <dir-or-files...> [--dry-run]
//
//   node scripts/instagram-backfill.mjs ~/Downloads/connections/followers_and_following
//   node scripts/instagram-backfill.mjs followers_1.json following.json --dry-run

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const HISTORY = resolve(REPO, 'public/instagram/history.json');

const FOLLOWERS_RE = /^followers(_\d+)?\.json$/i;
const FOLLOWING_RE = /^following(_\d+)?\.json$/i;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const inputs = argv.filter((a) => !a.startsWith('--'));

if (inputs.length === 0) {
  console.error('usage: node scripts/instagram-backfill.mjs <dir-or-files...> [--dry-run]');
  process.exit(2);
}

// ===== Read the export =====

/** Expand directories into the follower/following files inside them. */
function expand(paths) {
  const out = [];
  for (const p of paths) {
    const full = resolve(p);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full)) {
        if (FOLLOWERS_RE.test(name) || FOLLOWING_RE.test(name)) out.push(join(full, name));
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Where the username lives, in priority order.
 *
 * The two files are not shaped alike, despite sitting in the same folder:
 * followers_*.json puts the handle in `value` and leaves `title` empty, while
 * following.json omits `value` entirely and puts the handle in `title`. Reading
 * only `value` silently yields zero following.
 */
function usernameOf(row, sld) {
  const fromValue = sld?.value?.trim();
  if (fromValue) return fromValue;
  const fromTitle = row?.title?.trim();
  if (fromTitle) return fromTitle;
  // Last resort: https://www.instagram.com/<username>
  const m = sld?.href?.match(/instagram\.com\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).trim() : undefined;
}

/** Instagram wraps each list as [{ title, string_list_data: [...] }]. */
function extractEntries(json) {
  let arr = json;
  if (!Array.isArray(arr) && json && typeof json === 'object') {
    arr =
      json.relationships_followers ??
      json.relationships_following ??
      Object.values(json).find(Array.isArray) ??
      [];
  }
  const out = [];
  for (const row of arr) {
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

function readList(files, re) {
  const seen = new Set();
  const out = [];
  for (const file of files.filter((f) => re.test(basename(f))).sort()) {
    let json;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`  ! skipping ${basename(file)}: ${e.message}`);
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

// ===== Merge (mirrors src/instagram/importZip.ts) =====

/** YYYY-MM-DD in local time, matching dayKey() in the app. */
function dayKey(iso) {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Cumulative follower count over time from each follower's start timestamp. */
function reconstructSnapshots(followers) {
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
 * Copy real dates onto the live list. Nobody is added or removed: the live list
 * is authoritative because the export is already stale.
 */
function applyDates(live, fromExport) {
  const byName = new Map(fromExport.filter((p) => p.since).map((p) => [p.username.toLowerCase(), p]));
  let dated = 0;
  const out = live.map((p) => {
    const match = byName.get(p.username.toLowerCase());
    if (!match) return p; // followed after the export was cut — keep what we have
    dated++;
    return { ...p, since: match.since, name: p.name ?? match.name };
  });
  return { out, dated };
}

/**
 * Reconstructed history before the first real reading, then the real ones.
 * Real readings win where they overlap: they counted everyone present at the
 * time, whereas a reconstruction counts only followers who are still here, so it
 * can never dip and understates the past.
 */
function mergeSnapshots(real, reconstructed) {
  if (!real?.length) return reconstructed;
  const earliestReal = Math.min(...real.map((s) => new Date(s.t).getTime()));
  const history = reconstructed.filter((s) => new Date(s.t).getTime() < earliestReal);
  return [...history, ...real].sort((a, b) => new Date(a.t) - new Date(b.t));
}

// ===== Main =====

const files = expand(inputs);
const exportedFollowers = readList(files, FOLLOWERS_RE);
const exportedFollowing = readList(files, FOLLOWING_RE);

if (exportedFollowers.length === 0 && exportedFollowing.length === 0) {
  console.error('✗ No followers_*.json / following_*.json found in the given paths.');
  process.exit(1);
}

const prev = JSON.parse(readFileSync(HISTORY, 'utf8'));
if (prev.sample) {
  console.error('✗ history.json still holds sample data — run a real pull first.');
  process.exit(1);
}

const followers = applyDates(prev.followers ?? [], exportedFollowers);
const following = applyDates(prev.following ?? [], exportedFollowing);
const snapshots = mergeSnapshots(prev.snapshots, reconstructSnapshots(exportedFollowers));

const next = {
  ...prev,
  followers: followers.out,
  following: following.out,
  snapshots,
  // events and generatedAt deliberately untouched — see the header.
};

const distinct = (list) => new Set(list.map((p) => p.since?.slice(0, 10)).filter(Boolean)).size;

console.log(`export      : ${exportedFollowers.length} followers, ${exportedFollowing.length} following`);
console.log(`live        : ${prev.followers?.length ?? 0} followers, ${prev.following?.length ?? 0} following  (unchanged)`);
console.log(`dated       : ${followers.dated}/${prev.followers?.length ?? 0} followers, ${following.dated}/${prev.following?.length ?? 0} following`);
console.log(`distinct days: followers ${distinct(prev.followers ?? [])} → ${distinct(followers.out)}`);
console.log(`snapshots   : ${prev.snapshots?.length ?? 0} → ${snapshots.length}`);
console.log(`events      : ${prev.events?.length ?? 0} → ${next.events?.length ?? 0}  (never derived from an export)`);
if (snapshots.length) {
  console.log(`history from: ${snapshots[0].t.slice(0, 10)}  (${snapshots[0].followers} followers)`);
}

if (DRY_RUN) {
  console.log('\ndry run — history.json not written');
} else {
  writeFileSync(HISTORY, JSON.stringify(next, null, 2) + '\n');
  console.log(`\nwrote ${HISTORY}`);
}
