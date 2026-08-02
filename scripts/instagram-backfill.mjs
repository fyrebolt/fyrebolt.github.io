#!/usr/bin/env node
// ===== Backfill real relationship dates from an Instagram data export =====
//
// The private API the daily job uses never says *when* someone followed you, so
// it can only record when it first saw them. The official export does carry the
// real timestamps — this folds them into the committed history.json so every
// device and visitor gets them, instead of each browser having to import its own
// copy into localStorage.
//
// The parsing and merging live in src/instagram/exportFormat.js, shared with the
// in-browser importer (src/instagram/importZip.ts) so the two can't disagree.
// Both treat an export as a *historical document*, not a fresher reading:
// Instagram takes hours to prepare one, so it is already stale on arrival. It is
// therefore used only for what it alone knows, and never to add or remove people:
//
//   • relationship dates — the export's are ground truth
//   • historical snapshots, but only before the first real reading
//   • no *inbound* events: the export lists who follows you now, so it can
//     neither prove nor disprove someone having unfollowed you
//
// The one exception is recently_unfollowed_profiles.json, which records what
// *you* unfollowed and when. That's a positive record of an action rather than
// an absence, so it can't be misread the way a missing follower can, and no
// later diff can reconstruct it. Those are folded into events as dir:'out'.
//
// Usage:
//   node scripts/instagram-backfill.mjs <dir-or-files...> [--dry-run]
//
//   node scripts/instagram-backfill.mjs ~/Downloads/connections/followers_and_following
//   node scripts/instagram-backfill.mjs followers_1.json following.json --dry-run

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOLLOWERS_RE,
  FOLLOWING_RE,
  UNFOLLOWED_RE,
  applyDates,
  collectProfiles,
  extractUnfollowed,
  mergeOutbound,
  mergeSnapshots,
  reconstructSnapshots,
} from '../src/instagram/exportFormat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const HISTORY = resolve(REPO, 'public/instagram/history.json');

const EXPORT_FILE_RE = [FOLLOWERS_RE, FOLLOWING_RE, UNFOLLOWED_RE];

// ===== Read the export =====

/** Expand directories into the export files inside them. */
function expand(paths) {
  const out = [];
  for (const p of paths) {
    const full = resolve(p);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full)) {
        if (EXPORT_FILE_RE.some((re) => re.test(name))) out.push(join(full, name));
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Parse every given file matching `re`, in filename order. Unreadable ones are skipped. */
function readDocs(files, re) {
  const docs = [];
  for (const file of files.filter((f) => re.test(basename(f))).sort()) {
    try {
      docs.push(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      console.error(`  ! skipping ${basename(file)}: ${e.message}`);
    }
  }
  return docs;
}

// ===== Main =====

function main() {
  const argv = process.argv.slice(2);
  const DRY_RUN = argv.includes('--dry-run');
  const inputs = argv.filter((a) => !a.startsWith('--'));

  if (inputs.length === 0) {
    console.error('usage: node scripts/instagram-backfill.mjs <dir-or-files...> [--dry-run]');
    process.exit(2);
  }

  const files = expand(inputs);
  const exportedFollowers = collectProfiles(readDocs(files, FOLLOWERS_RE));
  const exportedFollowing = collectProfiles(readDocs(files, FOLLOWING_RE));
  const outbound = readDocs(files, UNFOLLOWED_RE).flatMap(extractUnfollowed);

  if (exportedFollowers.length === 0 && exportedFollowing.length === 0 && outbound.length === 0) {
    console.error('✗ No followers/following/recently_unfollowed files found in the given paths.');
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

  // Outbound unfollows are the one thing an export knows that the daily diff
  // can't reconstruct after the fact, so they *are* folded into events — unlike
  // inbound activity, which the export can neither prove nor disprove.
  const merged = mergeOutbound(prev.events, outbound);

  const next = {
    ...prev,
    followers: followers.profiles,
    following: following.profiles,
    snapshots,
    events: merged.events,
    // generatedAt deliberately untouched — see the header.
  };

  const distinct = (list) => new Set(list.map((p) => p.since?.slice(0, 10)).filter(Boolean)).size;

  console.log(`export      : ${exportedFollowers.length} followers, ${exportedFollowing.length} following`);
  console.log(`live        : ${prev.followers?.length ?? 0} followers, ${prev.following?.length ?? 0} following  (unchanged)`);
  console.log(`dated       : ${followers.dated}/${prev.followers?.length ?? 0} followers, ${following.dated}/${prev.following?.length ?? 0} following`);
  console.log(`distinct days: followers ${distinct(prev.followers ?? [])} → ${distinct(followers.profiles)}`);
  console.log(`snapshots   : ${prev.snapshots?.length ?? 0} → ${snapshots.length}`);
  console.log(`events      : ${prev.events?.length ?? 0} → ${next.events.length}  (+${merged.added} outbound unfollows; inbound never derived from an export)`);
  if (snapshots.length) {
    console.log(`history from: ${snapshots[0].t.slice(0, 10)}  (${snapshots[0].followers} followers)`);
  }

  if (DRY_RUN) {
    console.log('\ndry run — history.json not written');
  } else {
    writeFileSync(HISTORY, JSON.stringify(next, null, 2) + '\n');
    console.log(`\nwrote ${HISTORY}`);
  }
}

main();
