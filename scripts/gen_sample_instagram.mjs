// Generates public/instagram/history.json with believable sample data so the
// Instagram Tracker app is fully demoable before a live session is connected.
// Run: node scripts/gen_sample_instagram.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/instagram/history.json');

const ACCOUNT = 'hastinchen';
const DAYS = 150;
const START_FOLLOWERS = 812;

// Deterministic-ish PRNG so regenerating gives stable-looking data.
let seed = 1337;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

const HANDLES = [
  'maya.codes', 'devon_lu', 'sunny.patel', 'theo.builds', 'ava_nguyen', 'liam.exe',
  'chloe.designs', 'noah.pixels', 'zoe.dev', 'kai_maker', 'nora.js', 'eli.ships',
  'ruby.on.rails', 'sofia.ux', 'marco.ml', 'ivy.codes', 'leo.tanaka', 'mia.frontend',
  'owen.builds', 'lena.hex', 'jules.cpp', 'priya.stacks', 'sam.render', 'tara.loops',
  'nate.async', 'gigi.grid', 'hugo.wasm', 'bella.byte', 'finn.stack', 'cora.dev',
  'dex.compiles', 'yara.ships', 'milo.reacts', 'juno.paints', 'rex.debug', 'nia.threads',
];

const snapshots = [];
const events = [];
const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;

// Build a rising follower series (random walk with upward drift + occasional dips).
let followers = START_FOLLOWERS;
const dailyCounts = [];
for (let i = DAYS; i >= 0; i--) {
  const drift = randInt(-2, 8); // usually up, sometimes down
  followers = Math.max(START_FOLLOWERS - 50, followers + drift);
  const at = new Date(now.getTime() - i * dayMs);
  at.setHours(12, 0, 0, 0);
  dailyCounts.push({ at, count: followers });
  snapshots.push({ t: at.toISOString(), followers });
}

// Add finer hourly points for the last 36 hours to reflect the hourly cadence.
const lastCount = dailyCounts[dailyCounts.length - 1].count;
for (let h = 35; h >= 0; h--) {
  const at = new Date(now.getTime() - h * 60 * 60 * 1000);
  const jitter = randInt(-1, 2);
  snapshots.push({ t: at.toISOString(), followers: lastCount + jitter });
}
snapshots.sort((a, b) => new Date(a.t) - new Date(b.t));

// Derive follow/unfollow events for the most recent ~24 days from daily deltas.
const usable = [...HANDLES];
const pick = () => {
  const idx = randInt(0, usable.length - 1);
  return usable[idx];
};
for (let d = 1; d < Math.min(25, dailyCounts.length); d++) {
  const idx = dailyCounts.length - 1 - (24 - d); // recent days
  if (idx <= 0) continue;
  const net = dailyCounts[idx].count - dailyCounts[idx - 1].count;
  const unfollows = randInt(0, 3);
  const follows = Math.max(0, net + unfollows);
  const day = dailyCounts[idx].at;

  for (let k = 0; k < follows; k++) {
    const at = new Date(day.getTime() - randInt(0, 22) * 60 * 60 * 1000);
    events.push({ username: pick(), kind: 'follow', t: at.toISOString() });
  }
  for (let k = 0; k < unfollows; k++) {
    const at = new Date(day.getTime() - randInt(0, 22) * 60 * 60 * 1000);
    events.push({ username: pick(), kind: 'unfollow', t: at.toISOString() });
  }
}
events.sort((a, b) => new Date(b.t) - new Date(a.t));

// Build a searchable followers list sized to the current follower count.
const currentCount = snapshots[snapshots.length - 1].followers;
const ADJ = [
  'sunny', 'cosmic', 'lunar', 'pixel', 'neon', 'quiet', 'vivid', 'urban', 'wild', 'calm',
  'brave', 'clever', 'gentle', 'swift', 'mellow', 'golden', 'silver', 'crimson', 'azure', 'olive',
  'rapid', 'silent', 'hidden', 'bright', 'frosty', 'amber', 'jade', 'coral', 'dusty', 'electric',
];
const NOUN = [
  'fox', 'otter', 'panda', 'heron', 'maple', 'river', 'ember', 'comet', 'harbor', 'meadow',
  'cobalt', 'circuit', 'sprocket', 'pixelate', 'delta', 'raster', 'vector', 'pixel', 'lumen', 'quartz',
  'willow', 'cedar', 'lark', 'wren', 'finch', 'moss', 'dune', 'reef', 'tide', 'glacier',
];
const FIRST = [
  'Maya', 'Devon', 'Sunny', 'Theo', 'Ava', 'Liam', 'Chloe', 'Noah', 'Zoe', 'Kai',
  'Nora', 'Eli', 'Ruby', 'Sofia', 'Marco', 'Ivy', 'Leo', 'Mia', 'Owen', 'Lena',
  'Jules', 'Priya', 'Sam', 'Tara', 'Nate', 'Gigi', 'Hugo', 'Bella', 'Finn', 'Cora',
];
const LAST = [
  'Nguyen', 'Patel', 'Lu', 'Tanaka', 'Kim', 'Rossi', 'Silva', 'Cohen', 'Okafor', 'Ahmed',
  'Garcia', 'Novak', 'Haddad', 'Singh', 'Moreau', 'Costa', 'Berg', 'Reyes', 'Ito', 'Flores',
];

const START = snapshots[0].followers;
const firstT = new Date(snapshots[0].t).getTime();
const lastT = new Date(snapshots[snapshots.length - 1].t).getTime();

/** A plausible "since" date: early followers are old, recent ones are recent. */
const sinceFor = (rank, total) => {
  if (rank < START) {
    // Part of the pre-history baseline — spread over the two years before it.
    const twoYears = 730 * dayMs;
    return new Date(firstT - randInt(1, twoYears / dayMs) * dayMs).toISOString();
  }
  const frac = (rank - START) / Math.max(1, total - START);
  return new Date(firstT + frac * (lastT - firstT)).toISOString();
};

const seen = new Set();
const followerList = [];
let guard = 0;
while (followerList.length < currentCount && guard < currentCount * 20) {
  guard++;
  const style = randInt(0, 2);
  let username;
  if (style === 0) username = `${ADJ[randInt(0, ADJ.length - 1)]}.${NOUN[randInt(0, NOUN.length - 1)]}`;
  else if (style === 1) username = `${ADJ[randInt(0, ADJ.length - 1)]}_${NOUN[randInt(0, NOUN.length - 1)]}${randInt(1, 99)}`;
  else username = `${NOUN[randInt(0, NOUN.length - 1)]}${FIRST[randInt(0, FIRST.length - 1)].toLowerCase()}`;
  if (seen.has(username)) continue;
  seen.add(username);
  const name = `${FIRST[randInt(0, FIRST.length - 1)]} ${LAST[randInt(0, LAST.length - 1)]}`;
  const entry = { username, name, since: sinceFor(followerList.length, currentCount) };
  if (rand() < 0.02) entry.verified = true;
  if (rand() < 0.18) entry.private = true;
  followerList.push(entry);
}
// Fold in the recent event usernames so search results line up with activity.
for (const ev of events) {
  if (ev.kind === 'follow' && !seen.has(ev.username)) {
    seen.add(ev.username);
    followerList.push({ username: ev.username, since: ev.t });
  }
}
followerList.sort((a, b) => a.username.localeCompare(b.username));

// Build a following list: most mutuals come from the follower list, plus some
// accounts that never followed back (big names you follow one-way).
const FOLLOWING_TOTAL = Math.round(currentCount * 0.68);
const MUTUAL_SHARE = 0.78;
const mutualTarget = Math.round(FOLLOWING_TOTAL * MUTUAL_SHARE);

const followingList = [];
const followingSeen = new Set();
// Reservoir-free sample: walk the followers and take roughly the share we need.
const step = followerList.length / mutualTarget;
for (let i = 0; followingList.length < mutualTarget && i < followerList.length; i++) {
  if (i % Math.max(1, Math.round(step)) !== 0) continue;
  const f = followerList[i];
  followingSeen.add(f.username);
  // You followed back some time after they followed you.
  const followedBack = f.since
    ? new Date(Math.min(lastT, new Date(f.since).getTime() + randInt(0, 30) * dayMs)).toISOString()
    : undefined;
  followingList.push({
    username: f.username,
    name: f.name || undefined,
    since: followedBack,
    ...(f.verified ? { verified: true } : {}),
    ...(f.private ? { private: true } : {}),
  });
}
// One-way-out: accounts you follow that don't follow you back.
guard = 0;
while (followingList.length < FOLLOWING_TOTAL && guard < FOLLOWING_TOTAL * 20) {
  guard++;
  const username = `${NOUN[randInt(0, NOUN.length - 1)]}.${ADJ[randInt(0, ADJ.length - 1)]}${randInt(1, 999)}`;
  if (seen.has(username) || followingSeen.has(username)) continue;
  followingSeen.add(username);
  const entry = {
    username,
    name: `${FIRST[randInt(0, FIRST.length - 1)]} ${LAST[randInt(0, LAST.length - 1)]}`,
    since: new Date(firstT - randInt(1, 500) * dayMs).toISOString(),
  };
  if (rand() < 0.22) entry.verified = true;
  followingList.push(entry);
}
followingList.sort((a, b) => a.username.localeCompare(b.username));

// Record the following count on the final snapshot so the app has both series.
snapshots[snapshots.length - 1].following = followingList.length;

const data = {
  account: ACCOUNT,
  generatedAt: now.toISOString(),
  sample: true,
  snapshots,
  events,
  followers: followerList,
  following: followingList,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');

const followingKeys = new Set(followingList.map((p) => p.username.toLowerCase()));
const mutuals = followerList.filter((p) => followingKeys.has(p.username.toLowerCase())).length;
console.log(
  `Wrote ${OUT} — ${snapshots.length} snapshots, ${events.length} events, ` +
    `${followerList.length} followers, ${followingList.length} following, ${mutuals} mutuals.`,
);
