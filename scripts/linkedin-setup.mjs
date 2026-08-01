#!/usr/bin/env node
// ===== Interactive setup for the LinkedIn tracker credentials =====
//
// Writes scripts/.linkedin-secrets.json from two values you paste in, so you
// never have to hand-edit JSON around a credential. That matters more than it
// sounds: LinkedIn displays JSESSIONID *with* double quotes around the value
// ("ajax:1234"), and pasting that verbatim into a JSON string produces a file
// that won't parse. This strips them for you, along with a `Cookie:` prefix,
// stray whitespace, and a trailing semicolon.
//
// Nothing is sent anywhere. The file is written 0600 (readable only by you) and
// is gitignored.
//
// Usage:
//   node scripts/linkedin-setup.mjs

import { writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS = resolve(__dirname, '.linkedin-secrets.json');

/** Strip the decorations people inevitably paste along with the value. */
export function clean(value) {
  return String(value ?? '')
    .trim()
    .replace(/^cookie:\s*/i, '')
    .replace(/^[a-z_]+=/i, '') // a pasted "li_at=AQED..." keeps only the value
    .replace(/;+$/, '')
    .trim()
    .replace(/^"|"$/g, '') // LinkedIn shows JSESSIONID quoted; voyager wants it bare
    .trim();
}

/** Pull one cookie's value out of a whole `Cookie:` header, if that's what was pasted. */
export function fromHeader(header, name) {
  for (const raw of String(header ?? '').split(';')) {
    const pair = raw.trim();
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    if (pair.slice(0, idx).trim().toLowerCase() !== name.toLowerCase()) continue;
    return clean(pair.slice(idx + 1));
  }
  return null;
}

/**
 * Accept either individual values or a whole pasted cookie header.
 *
 * People reach for whichever is in front of them, and a setup step that
 * rejects the wrong-but-reasonable one is a setup step that gets abandoned.
 */
export function interpret(input, name) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // A multi-cookie header is unambiguous: the answer is in it or it isn't.
  // Falling through to clean() here would mince the header into a plausible-
  // looking value ("v=2\"; li_at=AQED…") and write a secrets file that fails
  // later with a 403 nobody can trace back to this moment.
  if (raw.includes(';')) return fromHeader(raw, name);

  // A single `name=value` pair only counts if it's the pair being asked for.
  const single = /^([a-z_]+)=(.*)$/is.exec(raw);
  if (single) {
    return single[1].toLowerCase() === name.toLowerCase() ? clean(single[2]) || null : null;
  }

  return clean(raw) || null;
}

/** Normalise a profile answer: a full URL, a slug, or nothing at all. */
export function normaliseProfile(answer, fallback = 'hastinchen') {
  const raw = String(answer ?? '').trim();
  if (!raw) return fallback;
  return raw.replace(/^.*\/in\//, '').replace(/[/?#].*$/, '').trim() || fallback;
}

/**
 * The secrets object to write, merged onto whatever is already on disk.
 *
 * Kept pure and separate from the prompting so it can be tested: the prompting
 * is thin, but getting *this* wrong writes a broken credential file that only
 * fails much later, as an unexplained 403.
 */
export function buildSecrets({ liAt, jsession, profile, publish, existing = {}, cookie }) {
  const next = {
    ...existing,
    profile,
    li_at: liAt,
    jsessionid: jsession,
    publishViewers: Boolean(publish),
  };
  if (cookie) {
    // Kept whole: it carries bcookie / lidc / bscookie, which some endpoints
    // require and which li_at + JSESSIONID alone cannot stand in for.
    next.cookie = cookie;
  } else {
    // A header left over from a previous run would be stale beside the explicit
    // values above, so it goes rather than silently overriding them.
    delete next.cookie;
  }
  return next;
}

/** Is this a whole Cookie header rather than one value? */
export function looksLikeFullHeader(input) {
  const raw = String(input ?? '').trim();
  return raw.includes(';') && /(^|[;\s])li_at=/.test(raw);
}

/** Reject an answer that never came, rather than exiting silently at EOF. */
async function ask(rl, prompt) {
  const answer = await rl.question(prompt);
  if (answer === null || answer === undefined) throw new Error('input ended');
  return answer;
}

async function main() {
  console.log(`
╭──────────────────────────────────────────────────────────────────╮
│  LinkedIn Tracker setup                                          │
╰──────────────────────────────────────────────────────────────────╯

BEST: paste your whole Cookie header (one step, and it carries the
extra cookies some LinkedIn endpoints insist on — bcookie, lidc):

  1. Open https://www.linkedin.com, logged in.
  2. DevTools (⌥⌘I) → "Network" tab → reload the page.
  3. Click any request to www.linkedin.com.
  4. Scroll to "Request Headers" → right-click the "cookie:" row
     → Copy value.  (It's long — hundreds of characters. Good.)
  5. Paste the whole thing at the first prompt below.

FALLBACK: if you can only find the individual cookies, use
DevTools → "Application" tab (or "Storage" in Firefox/Safari) →
Cookies → https://www.linkedin.com, and copy li_at, then JSESSIONID.
Two cookies work for most endpoints but not all.
`);

  if (existsSync(SECRETS)) {
    console.log(`⚠ ${SECRETS} already exists; continuing will overwrite it.\n`);
  }

  if (!stdin.isTTY) {
    // Piped stdin hits EOF mid-way and readline's promise simply never settles,
    // so the process would exit 0 having written nothing — the worst possible
    // failure for a setup step, because it looks like it worked.
    return fail(
      'This needs an interactive terminal (it prompts for values).\n' +
        '  Run it directly: node scripts/linkedin-setup.mjs',
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const first = await ask(rl, 'cookie header (or just li_at): ');
    // A full header is recognisable and strictly better: keep it whole so the
    // puller can seed its jar with every cookie, not just the two named ones.
    const wholeHeader = looksLikeFullHeader(first) ? first.trim().replace(/^cookie:\s*/i, '') : null;

    const liAt = interpret(first, 'li_at');
    if (!liAt) return fail('No li_at found in that.');
    // It's a long opaque token; a short answer means something went wrong.
    if (liAt.length < 20) {
      return fail(`That li_at looks too short (${liAt.length} chars). It's normally 100+.`);
    }

    // A full header already contains JSESSIONID; only ask when it doesn't.
    const jsession =
      (wholeHeader && interpret(wholeHeader, 'JSESSIONID')) ||
      interpret(await ask(rl, 'JSESSIONID   : '), 'JSESSIONID');
    if (!jsession) return fail('No JSESSIONID value given.');
    if (!/^ajax:/i.test(jsession)) {
      console.log(`\n⚠ JSESSIONID usually starts with "ajax:" — got "${jsession}".`);
      console.log('  Carrying on anyway, but if the pull 403s, that\'s the first thing to recheck.');
    }

    const profile = normaliseProfile(await ask(rl, '\nprofile slug [hastinchen]: '));

    const publish = (await ask(rl, '\nPublish viewer NAMES to the public site? [y/N]: '))
      .trim()
      .toLowerCase()
      .startsWith('y');

    // Preserve anything already in the file (an agent token, say) rather than
    // silently dropping it on a re-run.
    let existing = {};
    if (existsSync(SECRETS)) {
      try {
        existing = JSON.parse(readFileSync(SECRETS, 'utf8'));
      } catch {
        /* unparseable; it's being replaced anyway */
      }
    }

    const next = buildSecrets({ liAt, jsession, profile, publish, existing, cookie: wholeHeader });

    writeFileSync(SECRETS, JSON.stringify(next, null, 2) + '\n');
    chmodSync(SECRETS, 0o600);

    console.log(`
✓ Wrote ${SECRETS} (mode 0600, gitignored)

  profile         /in/${profile}
  viewer names    ${publish ? 'PUBLISHED to the public site' : 'withheld from the public site'}

Next — a read-only test that writes nothing:

    node scripts/linkedin-pull.mjs --dry-run --debug

That prints what it found and dumps the raw payloads to
scripts/.linkedin-debug/ so the parsers can be checked against reality.

⚠ These two values are a full login for your account. Anyone holding them can
  act as you on LinkedIn. They live only in that gitignored file — don't paste
  them into a chat, an issue, or a commit. Expect to redo this every few weeks
  as the session expires; the pull fails with a clear message when it does.
`);
  } finally {
    rl.close();
  }
}

function fail(message) {
  console.error(`\n✗ ${message}\n  Nothing was written. Re-run when you have the value.\n`);
  process.exitCode = 2;
}

// Only run when invoked directly, so the pure helpers above can be unit-tested.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error('\n✗ Setup failed:', e.message);
    process.exit(1);
  });
}
