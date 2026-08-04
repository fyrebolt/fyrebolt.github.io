#!/usr/bin/env node
// ===== Interactive setup / cookie refresh for the Instagram tracker =====
//
// Writes scripts/.instagram-secrets.json from a cookie header you paste in, so
// refreshing an expired session is one command rather than hand-editing JSON
// around a credential. An Instagram session dies every few weeks, so this is a
// step you'll run again and again — it exists to make that boring.
//
// Nothing is sent anywhere except, at the end, one read-only request to
// instagram.com to confirm the new cookie actually works (skip with
// --no-verify). The file is written 0600 and is gitignored.
//
// Usage:
//   node scripts/instagram-setup.mjs
//   node scripts/instagram-setup.mjs --no-verify

import { writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  buildSession,
  igHeaders,
  profileInfoUrl,
  profileReferer,
} from './lib/instagram-session.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS = resolve(__dirname, '.instagram-secrets.json');
const STATE = resolve(__dirname, '.instagram-state.json');

/** The cookies this tracker knows by name — the only prefixes safe to strip. */
const KNOWN = ['sessionid', 'ds_user_id', 'csrftoken', 'mid', 'ig_did'];

/**
 * Strip the decorations people inevitably paste along with a value.
 *
 * Unlike the LinkedIn equivalent this only strips a *known* `name=` prefix:
 * Instagram's sessionid is an opaque percent-encoded blob, and a blanket
 * "drop everything before the first =" would happily eat part of one.
 */
export function clean(value) {
  const stripped = String(value ?? '')
    .trim()
    .replace(/^cookie:\s*/i, '')
    .replace(/;+$/, '')
    .trim()
    .replace(/^"|"$/g, '')
    .trim();
  const pair = /^([a-z_]+)=(.*)$/is.exec(stripped);
  if (pair && KNOWN.includes(pair[1].toLowerCase())) return pair[2].trim();
  return stripped;
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
 * Accept either an individual value or a whole pasted cookie header.
 *
 * People reach for whichever is in front of them, and a setup step that rejects
 * the wrong-but-reasonable one is a setup step that gets abandoned.
 */
export function interpret(input, name) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // A multi-cookie header is unambiguous: the answer is in it or it isn't.
  // Falling through to clean() here would mince the header into a
  // plausible-looking value and write a secrets file that fails later with a
  // 401 nobody can trace back to this moment.
  if (raw.includes(';')) return fromHeader(raw, name);

  // A single `name=value` pair only counts if it's the pair being asked for.
  const single = /^([a-z_]+)=(.*)$/is.exec(raw);
  if (single && KNOWN.includes(single[1].toLowerCase())) {
    return single[1].toLowerCase() === name.toLowerCase() ? clean(single[2]) || null : null;
  }

  return clean(raw) || null;
}

/** Is this a whole Cookie header rather than one value? */
export function looksLikeFullHeader(input) {
  const raw = String(input ?? '').trim();
  return raw.includes(';') && /(^|[;\s])sessionid=/i.test(raw);
}

/**
 * The numeric account id carried inside the sessionid itself.
 *
 * A sessionid reads `<user id>%3A<secret>%3A<n>%3A<blob>`, so ds_user_id is
 * never really a separate thing you have to find — asking for it would just be
 * one more chance to paste the wrong row out of DevTools.
 */
export function userIdFromSessionId(sessionid) {
  const raw = String(sessionid ?? '');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* a stray % isn't a reason to give up on the part before it */
  }
  const first = decoded.split(':')[0].trim();
  return /^\d{4,}$/.test(first) ? first : null;
}

/** Normalise a handle: a full URL, an @handle, or a bare handle. */
export function normaliseAccount(answer, fallback = '') {
  const raw = String(answer ?? '').trim();
  if (!raw) return fallback;
  return (
    raw
      .replace(/^https?:\/\//i, '')
      .replace(/^(www\.)?instagram\.com\//i, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@/, '')
      .trim() || fallback
  );
}

/**
 * The secrets object to write, merged onto whatever is already on disk.
 *
 * Kept pure and separate from the prompting so it can be tested: getting *this*
 * wrong writes a broken credential file that only fails much later, as an
 * unexplained 401.
 */
export function buildSecrets({ account, sessionid, dsUserId, csrftoken, existing = {} }) {
  const next = { ...existing, account, sessionid };

  if (dsUserId) next.ds_user_id = dsUserId;
  else delete next.ds_user_id;

  if (csrftoken) next.csrftoken = csrftoken;
  else delete next.csrftoken;

  // The puller prefers these explicit values and rebuilds the cookie header
  // from them, so a `cookie` field left over from a hand-written file would be
  // a dead field that still looks authoritative. Drop it.
  delete next.cookie;

  return next;
}

/**
 * One read-only request with the new credentials.
 *
 * Without this, "success" means "a file was written", and you'd only find out
 * the paste was stale at 09:20 tomorrow. It goes through the same session
 * builder and headers the pull uses, against the same endpoint the pull starts
 * with — a check that assembled its own request could pass while the pull still
 * failed, which is worse than not checking.
 */
export async function verify(secrets, fetchImpl = fetch) {
  const account = secrets.account;
  const session = buildSession(secrets);
  let res;
  try {
    res = await fetchImpl(profileInfoUrl(account), {
      headers: igHeaders(session, profileReferer(account)),
    });
  } catch (e) {
    return { ok: false, reason: `network error: ${e.message}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: `Instagram rejected the cookie (HTTP ${res.status})` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  let json;
  try {
    json = JSON.parse(await res.text());
  } catch {
    return { ok: false, reason: 'Instagram returned HTML — usually a checkpoint to clear' };
  }
  if (json?.message === 'checkpoint_required' || json?.message === 'challenge_required') {
    return { ok: false, reason: 'Instagram wants a security checkpoint cleared' };
  }

  const user = json?.data?.user;
  if (!user?.id) return { ok: false, reason: `no profile came back for @${account}` };
  return {
    ok: true,
    followers: user.edge_followed_by?.count,
    following: user.edge_follow?.count,
  };
}

/**
 * Forget today's failure notification.
 *
 * The pull alerts once per day per failure kind, so if it had already fired
 * "action needed" this morning, a *second* problem after this refresh would go
 * unannounced until tomorrow. New credentials are a clean slate.
 */
function clearNotificationState() {
  try {
    if (!existsSync(STATE)) return;
    const state = JSON.parse(readFileSync(STATE, 'utf8'));
    delete state.notifiedOn;
    delete state.notifiedKind;
    writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  } catch {
    /* de-duplication state is a convenience; never fail a refresh over it */
  }
}

function readExisting() {
  if (!existsSync(SECRETS)) return {};
  try {
    return JSON.parse(readFileSync(SECRETS, 'utf8'));
  } catch {
    return {}; // unparseable; it's being replaced anyway
  }
}

/** Reject an answer that never came, rather than exiting silently at EOF. */
async function ask(rl, prompt) {
  const answer = await rl.question(prompt);
  if (answer === null || answer === undefined) throw new Error('input ended');
  return answer;
}

async function main() {
  const noVerify = process.argv.slice(2).includes('--no-verify');

  console.log(`
╭──────────────────────────────────────────────────────────────────╮
│  Instagram Tracker — session cookie setup / refresh              │
╰──────────────────────────────────────────────────────────────────╯

Paste your whole Cookie header (one step — it carries sessionid,
ds_user_id and csrftoken together, so there's nothing else to find):

  1. Open https://www.instagram.com, logged in.
  2. DevTools (⌥⌘I) → "Network" tab → reload the page.
  3. Click any request to www.instagram.com.
  4. Scroll to "Request Headers" → right-click the "cookie:" row
     → Copy value.  (It's long — hundreds of characters. Good.)
  5. Paste the whole thing at the first prompt below.

FALLBACK: if you can only find the individual cookies, use DevTools →
"Application" tab ("Storage" in Firefox/Safari) → Cookies →
https://www.instagram.com, and copy sessionid.
`);

  const existing = readExisting();
  if (existsSync(SECRETS)) {
    console.log(`⚠ ${SECRETS} already exists; continuing will replace the cookie in it.`);
    if (existing.agentToken) console.log('  (your agentToken and other settings are kept)');
    console.log('');
  }

  if (!stdin.isTTY) {
    // Piped stdin hits EOF mid-way and readline's promise simply never settles,
    // so the process would exit 0 having written nothing — the worst possible
    // failure for a setup step, because it looks like it worked.
    return fail(
      'This needs an interactive terminal (it prompts for values).\n' +
        '  Run it directly: node scripts/instagram-setup.mjs',
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const first = await ask(rl, 'cookie header (or just sessionid): ');
    const wholeHeader = looksLikeFullHeader(first)
      ? first.trim().replace(/^cookie:\s*/i, '')
      : null;

    const sessionid = interpret(first, 'sessionid');
    if (!sessionid) return fail('No sessionid found in that.');
    // It's a long opaque token; a short answer means something went wrong.
    if (sessionid.length < 20) {
      return fail(`That sessionid looks too short (${sessionid.length} chars). It's normally 60+.`);
    }

    // Derived, not asked for — see userIdFromSessionId. A header that carries
    // ds_user_id explicitly still wins, on the theory that Instagram's own copy
    // beats our parse of a token format it never promised to keep.
    const dsUserId =
      (wholeHeader && fromHeader(wholeHeader, 'ds_user_id')) || userIdFromSessionId(sessionid);
    if (!dsUserId) {
      console.log('\n⚠ Could not work out ds_user_id from that sessionid. Carrying on without it.');
    }

    // Optional for reads, but Instagram is quicker to challenge a session that
    // never sends one, so it's worth a prompt rather than a shrug.
    let csrftoken = wholeHeader ? fromHeader(wholeHeader, 'csrftoken') : null;
    if (!csrftoken) {
      csrftoken = interpret(await ask(rl, 'csrftoken (optional, Enter to skip): '), 'csrftoken');
    }

    const fallbackAccount = String(existing.account || '').replace(/^@/, '');
    const accountPrompt = fallbackAccount
      ? `\naccount handle [${fallbackAccount}]: `
      : '\naccount handle (without the @): ';
    const account = normaliseAccount(await ask(rl, accountPrompt), fallbackAccount);
    if (!account) return fail('No account handle given.');

    const next = buildSecrets({ account, sessionid, dsUserId, csrftoken, existing });
    writeFileSync(SECRETS, JSON.stringify(next, null, 2) + '\n');
    chmodSync(SECRETS, 0o600);
    clearNotificationState();

    console.log(`
✓ Wrote ${SECRETS} (mode 0600, gitignored)

  account      @${account}
  sessionid    ${sessionid.slice(0, 12)}… (${sessionid.length} chars)
  ds_user_id   ${dsUserId || '— none'}
  csrftoken    ${csrftoken ? `${csrftoken.slice(0, 8)}…` : '— none'}
`);

    if (noVerify) {
      console.log('Skipped the check (--no-verify). Test it with:\n');
      console.log('    node scripts/instagram-pull.mjs --dry-run\n');
    } else {
      process.stdout.write('Checking it against instagram.com… ');
      // Deliberately the object that was just written, not the local variables:
      // this checks the file the pull will read.
      const result = await verify(next);
      if (result.ok) {
        console.log(`✓ live (${result.followers} followers · ${result.following} following)

The scheduled job picks this up on its next hourly attempt, so today's
pull recovers on its own. To run it now:

    node scripts/instagram-pull.mjs --commit
`);
      } else {
        console.log(`✗ ${result.reason}

The file was written, but Instagram didn't accept it. The usual causes:
the cookie was copied from a logged-out tab, only part of the header made
it onto the clipboard, or the account has a checkpoint waiting. Open
instagram.com, clear any prompt, and run this again.
`);
        process.exitCode = 2;
      }
    }

    console.log(`⚠ This cookie is a full login for your account. Anyone holding it can act as
  you on Instagram. It lives only in that gitignored file — don't paste it into
  a chat, an issue, or a commit. Expect to redo this every few weeks; the pull
  fails with a clear message when the session dies.
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
