// Generates public/linkedin/history.json with believable sample data so the
// LinkedIn Tracker app is fully demoable before a live session is connected.
// Every name below is invented — no real profile appears in this file.
// Run: node scripts/gen_sample_linkedin.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/linkedin/history.json');

/** The slug in linkedin.com/in/<slug> — the real one, so the header links out. */
const PROFILE = 'hastinchen';
const NAME = 'Hastin Chen';
const DAYS = 180;

// Deterministic PRNG so regenerating gives stable-looking data.
let seed = 8675309;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pickOne = (arr) => arr[randInt(0, arr.length - 1)];

const FIRST = [
  'Maya', 'Devon', 'Sunny', 'Theo', 'Ava', 'Liam', 'Chloe', 'Noah', 'Zoe', 'Kai',
  'Nora', 'Eli', 'Sofia', 'Marco', 'Ivy', 'Leo', 'Mia', 'Owen', 'Lena', 'Jules',
  'Priya', 'Sam', 'Tara', 'Nate', 'Hugo', 'Bella', 'Finn', 'Cora', 'Dex', 'Yara',
  'Milo', 'Juno', 'Rex', 'Nia', 'Alma', 'Ravi', 'Esme', 'Otto', 'Wren', 'Cyrus',
];
const LAST = [
  'Nguyen', 'Patel', 'Okafor', 'Tanaka', 'Silva', 'Kowalski', 'Haddad', 'Lindqvist',
  'Moreau', 'Castellanos', 'Bergman', 'Osei', 'Ferrari', 'Novak', 'Reyes', 'Iqbal',
  'Andersen', 'Mbeki', 'Kovács', 'Delgado', 'Ashworth', 'Rahimi', 'Sandoval', 'Vos',
];
const COMPANIES = [
  'Northwind Robotics', 'Peregrine Health', 'Lumen Systems', 'Fathom Analytics Co',
  'Basalt Energy', 'Wayfare Logistics', 'Tidewater Bank', 'Orbit Semiconductor',
  'Verdant Foods', 'Halcyon Media', 'Ironwood Capital', 'Meridian Labs',
];
const TITLES = [
  'Software Engineer', 'Senior Software Engineer', 'Staff Engineer', 'Engineering Manager',
  'Product Manager', 'Technical Recruiter', 'Data Scientist', 'Design Lead',
  'Founding Engineer', 'Research Scientist', 'Solutions Architect', 'University Recruiter',
];
const LOCATIONS = [
  'Los Angeles, CA', 'San Francisco Bay Area', 'Seattle, WA', 'New York, NY',
  'Austin, TX', 'Boston, MA', 'Toronto, ON', 'London, UK',
];

const slug = (name, n) => `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${n.toString(36)}${randInt(100, 999).toString(36)}`;

/** A cast of invented people, reused across connections, followers and views. */
const CAST = [];
for (let i = 0; i < 240; i++) {
  const name = `${pickOne(FIRST)} ${pickOne(LAST)}`;
  CAST.push({
    id: slug(name, i),
    name,
    headline: pickOne(TITLES),
    company: pickOne(COMPANIES),
    location: pickOne(LOCATIONS),
  });
}

const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;
const at = (daysAgo, hour = 12) => {
  const d = new Date(now.getTime() - daysAgo * dayMs);
  d.setHours(hour, randInt(0, 59), 0, 0);
  return d;
};

// ===== Connections =====
// Assign each connection a start date somewhere in the last few years, with a
// realistic clustering: more recent months are busier.
const connections = [];
const events = [];

for (const p of CAST.slice(0, 180)) {
  // Skewed towards recent — squaring a uniform pushes mass towards 0.
  const daysAgo = Math.floor(rand() ** 2 * 1500) + 1;
  connections.push({ ...p, since: at(daysAgo).toISOString() });
  if (daysAgo <= 90) {
    events.push({
      id: p.id,
      kind: 'connect',
      t: at(daysAgo).toISOString(),
      name: p.name,
      headline: p.headline,
    });
  }
}

// A couple of disconnects, so that column isn't permanently empty in the demo.
for (const p of CAST.slice(200, 202)) {
  events.push({
    id: p.id,
    kind: 'disconnect',
    t: at(randInt(4, 60)).toISOString(),
    name: p.name,
    headline: p.headline,
  });
}

// ===== Followers =====
// Some overlap with connections (people who connected and also follow), some
// who only follow.
const followers = [
  ...CAST.slice(0, 90).map((p) => ({ ...p, since: at(randInt(30, 900)).toISOString() })),
  ...CAST.slice(180, 230).map((p) => ({ ...p, since: at(randInt(1, 400)).toISOString() })),
];

// ===== Profile views =====
// The interesting shape: a low daily baseline with a spike where you posted
// something, a handful of repeat viewers, and a realistic anonymous fraction.
const views = [];
const ANON_LABELS = [
  'Someone at Northwind Robotics',
  'Someone in the Staffing and Recruiting industry',
  'Someone at Tidewater Bank',
  'Someone on LinkedIn',
  'Someone in the Higher Education industry',
];
const REGULARS = CAST.slice(0, 6); // people who keep coming back

for (let d = 0; d < 120; d++) {
  // Baseline 0–4 views a day, with a burst around day 12 and day 47.
  let count = randInt(0, 4);
  if (d === 12) count += randInt(14, 20);
  if (d === 13) count += randInt(5, 9);
  if (d === 47) count += randInt(8, 12);
  if (d > 95) count = Math.max(0, count - 2); // thinner early history

  for (let v = 0; v < count; v++) {
    const t = at(d, randInt(8, 22)).toISOString();
    // Roughly a third of viewers are anonymous, which matches a free account.
    if (rand() < 0.34) {
      views.push({ t, anonymous: true, label: pickOne(ANON_LABELS), seen: at(d).toISOString() });
      continue;
    }
    const person = rand() < 0.22 ? pickOne(REGULARS) : pickOne(CAST);
    views.push({
      t,
      id: person.id,
      name: person.name,
      headline: person.headline,
      company: person.company,
      degree: randInt(1, 3),
      seen: at(d).toISOString(),
    });
  }
}
views.sort((a, b) => (a.t < b.t ? 1 : -1));

// ===== Snapshots =====
// A rising connection curve, a follower curve that tracks it loosely, and the
// rolling 90-day view figure LinkedIn reports.
//
// Built *backwards* from the real list lengths so the curve ends exactly where
// the People tab does. Generating it forwards from an arbitrary starting number
// left the hero claiming 654 connections while the list held 180 — the kind of
// mismatch that makes a demo look broken.
const snapshots = [];
let connectionCount = connections.length;
let followerCount = followers.length;
const backwards = [];
for (let i = 0; i <= DAYS; i++) {
  backwards.push({ i, connectionCount, followerCount });
  connectionCount = Math.max(1, connectionCount - randInt(0, 2));
  followerCount = Math.max(1, followerCount - randInt(0, 2));
}

for (const point of backwards) {
  const { i } = point;
  const t = at(i);
  // The rolling figure LinkedIn shows: views in the trailing 90 days.
  const cutoff = t.getTime() - 90 * dayMs;
  const viewsRolling = views.filter((v) => {
    const vt = new Date(v.t).getTime();
    return vt <= t.getTime() && vt >= cutoff;
  }).length;
  snapshots.push({
    t: t.toISOString(),
    connections: point.connectionCount,
    followers: point.followerCount,
    viewsRolling,
    searchAppearances: randInt(8, 40),
  });
}
snapshots.sort((a, b) => new Date(a.t) - new Date(b.t));

const data = {
  profile: PROFILE,
  name: NAME,
  generatedAt: new Date().toISOString(),
  sample: true,
  redacted: false,
  snapshots,
  events: events.sort((a, b) => (a.t < b.t ? 1 : -1)),
  connections: connections.sort((a, b) => a.id.localeCompare(b.id)),
  followers: followers.sort((a, b) => a.id.localeCompare(b.id)),
  views,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(
  `Wrote ${OUT}: ${connections.length} connections, ${followers.length} followers, ` +
    `${views.length} profile views, ${snapshots.length} snapshots.`,
);
