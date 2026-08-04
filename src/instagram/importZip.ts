// ===== Instagram data-export importer (runs entirely in the browser) =====
//
// Parses the official "Download Your Information" ZIP (Accounts Center →
// Your information and permissions → Download your information → Followers and
// following, JSON). Nothing is uploaded — fflate unzips in-page and we read both
// the followers and following file(s), then reconstruct the tracker data.
//
// This is the bootstrap path: it backfills real relationship start dates that
// the live API can't give us. scripts/instagram-pull.mjs takes over day to day.
//
// The file format itself, and the maths for folding an export into the history,
// live in exportFormat.js — shared with scripts/instagram-backfill.mjs so the
// two importers can't disagree about what an export says.

import { unzipSync, strFromU8 } from 'fflate';
import {
  FOLLOWERS_RE,
  FOLLOWING_RE,
  applyDates,
  collectProfiles,
  mergeSnapshots,
  reconstructSnapshots,
} from './exportFormat.js';
import type { Profile, FollowEvent, TrackerData } from './data';

export interface ImportedLists {
  followers: Profile[];
  following: Profile[];
}

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

/** Every entry across the files matching `re`, in filename order, de-duplicated. */
function readList(texts: Record<string, string>, re: RegExp): Profile[] {
  const docs = Object.keys(texts)
    .filter((n) => re.test(basename(n)))
    .sort()
    .map((name) => {
      try {
        return JSON.parse(texts[name]) as unknown;
      } catch {
        return null; // a truncated or HTML file — the others may still be fine
      }
    });
  return collectProfiles(docs);
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
    followers: applyDates(prev.followers ?? [], imported.followers).profiles,
    following: applyDates(prev.following ?? [], imported.following).profiles,
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
    // An import doesn't change what the daily job is installed to do.
    schedule: prev?.schedule,
    snapshots,
    events: seedRecentFollows(followers),
    followers,
    following,
  };
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
