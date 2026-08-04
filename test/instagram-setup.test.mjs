// Tests for the paste-cleaning in scripts/instagram-setup.mjs.
//
// Every case below is a shape someone can plausibly end up with on the
// clipboard while following the DevTools instructions. The one that bites here
// is the sessionid: it's an opaque percent-encoded blob, so the prefix-stripping
// that makes `li_at=AQED…` convenient on the LinkedIn side must not be allowed
// to chew into an Instagram value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSecrets,
  clean,
  fromHeader,
  interpret,
  looksLikeFullHeader,
  normaliseAccount,
  userIdFromSessionId,
  verify,
} from '../scripts/instagram-setup.mjs';
import { buildSession } from '../scripts/lib/instagram-session.mjs';

const SESSION = '60433846558%3AdemoSessionToken00%3A12%3AAYc0000000000000000000000000000000000';
const CSRF = 'demoCsrfToken0000000000000000000';
const HEADER =
  `mid=ZabcDEF; ig_did=1234-5678; csrftoken=${CSRF}; ds_user_id=60433846558; ` +
  `sessionid=${SESSION}; rur="CLN\\05460433846558"`;

test('clean', async (t) => {
  await t.test('strips a known name= prefix copied along with the value', () => {
    assert.equal(clean('sessionid=' + SESSION), SESSION);
    assert.equal(clean('csrftoken=' + CSRF), CSRF);
  });

  await t.test('leaves a value that merely contains = alone', () => {
    // An unknown-prefix rule would eat the front of a padded token.
    assert.equal(clean('AYc000=='), 'AYc000==');
    assert.equal(clean('v=2&lang=en'), 'v=2&lang=en');
  });

  await t.test('strips a Cookie: prefix, whitespace, quotes and a trailing semicolon', () => {
    assert.equal(clean('  Cookie: sessionid=' + SESSION + ';  '), SESSION);
    assert.equal(clean(`"${CSRF}"`), CSRF);
  });

  await t.test('survives empty input', () => {
    assert.equal(clean(''), '');
    assert.equal(clean(undefined), '');
  });
});

test('fromHeader', async (t) => {
  await t.test('pulls a named cookie out of a whole header', () => {
    assert.equal(fromHeader(HEADER, 'sessionid'), SESSION);
    assert.equal(fromHeader(HEADER, 'ds_user_id'), '60433846558');
    assert.equal(fromHeader(HEADER, 'csrftoken'), CSRF);
  });

  await t.test('matches the name case-insensitively', () => {
    assert.equal(fromHeader(HEADER, 'SessionID'), SESSION);
  });

  await t.test('returns null when the cookie is absent', () => {
    assert.equal(fromHeader(HEADER, 'shbid'), null);
    assert.equal(fromHeader('', 'sessionid'), null);
  });
});

test('interpret', async (t) => {
  await t.test('accepts a whole pasted cookie header', () => {
    assert.equal(interpret(HEADER, 'sessionid'), SESSION);
    assert.equal(interpret(HEADER, 'csrftoken'), CSRF);
  });

  await t.test('accepts a bare value', () => {
    assert.equal(interpret(SESSION, 'sessionid'), SESSION);
    assert.equal(interpret(CSRF, 'csrftoken'), CSRF);
  });

  await t.test('accepts a single name=value pair', () => {
    assert.equal(interpret('sessionid=' + SESSION, 'sessionid'), SESSION);
  });

  await t.test('returns null for nothing at all', () => {
    assert.equal(interpret('', 'sessionid'), null);
    assert.equal(interpret('   ', 'sessionid'), null);
  });

  await t.test('a header missing the asked-for cookie does not yield junk', () => {
    // Pasting the header into the csrftoken prompt when it has no csrftoken
    // must not hand back the whole header as if it were the value.
    assert.equal(interpret(`mid=Zabc; sessionid=${SESSION}`, 'csrftoken'), null);
  });

  await t.test('rejects the wrong single pair', () => {
    // Pasting sessionid into the csrftoken prompt is a plausible slip, and
    // silently accepting it would write a file that 401s with no clue why.
    assert.equal(interpret('sessionid=' + SESSION, 'csrftoken'), null);
  });
});

test('looksLikeFullHeader', async (t) => {
  await t.test('recognises a real header', () => {
    assert.equal(looksLikeFullHeader(HEADER), true);
  });

  await t.test('does not mistake a lone value for one', () => {
    assert.equal(looksLikeFullHeader(SESSION), false);
    assert.equal(looksLikeFullHeader('mid=Zabc; ig_did=1234'), false); // no sessionid in it
  });
});

test('userIdFromSessionId', async (t) => {
  await t.test('reads the account id out of the token', () => {
    // Saves asking for ds_user_id separately — one fewer row to mis-copy.
    assert.equal(userIdFromSessionId(SESSION), '60433846558');
  });

  await t.test('handles a browser that shows the value already decoded', () => {
    assert.equal(userIdFromSessionId('60433846558:token:12:blob'), '60433846558');
  });

  await t.test('returns null rather than guessing when the shape is unfamiliar', () => {
    assert.equal(userIdFromSessionId('not-a-session-token'), null);
    assert.equal(userIdFromSessionId(''), null);
    assert.equal(userIdFromSessionId('%E0%A4%A'), null); // malformed percent escape
  });
});

test('normaliseAccount', async (t) => {
  await t.test('accepts a bare handle, an @handle, or a full URL', () => {
    assert.equal(normaliseAccount('hastinchen'), 'hastinchen');
    assert.equal(normaliseAccount('@hastinchen'), 'hastinchen');
    assert.equal(normaliseAccount('https://www.instagram.com/hastinchen/'), 'hastinchen');
    assert.equal(normaliseAccount('instagram.com/hastinchen?hl=en'), 'hastinchen');
  });

  await t.test('falls back when the answer is empty', () => {
    assert.equal(normaliseAccount('', 'hastinchen'), 'hastinchen');
    assert.equal(normaliseAccount('   ', 'hastinchen'), 'hastinchen');
  });
});

test('buildSecrets', async (t) => {
  const args = {
    account: 'hastinchen',
    sessionid: SESSION,
    dsUserId: '60433846558',
    csrftoken: CSRF,
  };

  await t.test('writes the fields the puller reads', () => {
    assert.deepEqual(buildSecrets(args), {
      account: 'hastinchen',
      sessionid: SESSION,
      ds_user_id: '60433846558',
      csrftoken: CSRF,
    });
  });

  await t.test('keeps unrelated existing keys on a re-run', () => {
    // The agentToken powers the "Update now" button; losing it on a routine
    // cookie refresh would break a feature that has nothing to do with this.
    const out = buildSecrets({ ...args, existing: { agentToken: 'keep-me' } });
    assert.equal(out.agentToken, 'keep-me');
  });

  await t.test('drops a stale pasted cookie header', () => {
    // loadSecrets prefers the explicit values, so a leftover `cookie` would be
    // a dead field that still looks authoritative.
    const out = buildSecrets({ ...args, existing: { cookie: 'sessionid=old; ds_user_id=1' } });
    assert.equal('cookie' in out, false);
  });

  await t.test('removes optional fields rather than leaving last run’s behind', () => {
    const out = buildSecrets({
      account: 'hastinchen',
      sessionid: SESSION,
      existing: { ds_user_id: '999', csrftoken: 'stale' },
    });
    assert.equal('ds_user_id' in out, false);
    assert.equal('csrftoken' in out, false);
  });

  await t.test('the result round-trips through JSON', () => {
    const parsed = JSON.parse(JSON.stringify(buildSecrets(args)));
    assert.equal(parsed.sessionid, SESSION);
  });
});

test('what gets written is what the puller can use', async (t) => {
  await t.test('buildSession accepts the file buildSecrets writes', () => {
    // The two halves are written independently — this is the seam where a
    // renamed field would silently produce a cookie with no sessionid in it.
    const written = buildSecrets({
      account: 'hastinchen',
      sessionid: SESSION,
      dsUserId: '60433846558',
      csrftoken: CSRF,
    });
    const session = buildSession(written);
    assert.equal(session.sessionid, SESSION);
    assert.equal(session.csrftoken, CSRF);
    assert.equal(session.cookie, `sessionid=${SESSION}; ds_user_id=60433846558; csrftoken=${CSRF}`);
  });
});

test('verify', async (t) => {
  const creds = {
    account: 'hastinchen',
    sessionid: SESSION,
    ds_user_id: '60433846558',
    csrftoken: CSRF,
  };
  const profile = {
    data: { user: { id: '1', edge_followed_by: { count: 911 }, edge_follow: { count: 872 } } },
  };
  const ok = (body, status = 200) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  await t.test('reports the counts on a live session', () => {
    return verify(creds, ok(profile)).then((r) => {
      assert.equal(r.ok, true);
      assert.equal(r.followers, 911);
      assert.equal(r.following, 872);
    });
  });

  await t.test('sends the cookie the puller would send', async () => {
    let sent;
    await verify(creds, async (_url, init) => {
      sent = init.headers;
      return ok(profile)();
    });
    assert.match(sent.cookie, /^sessionid=/);
    assert.equal(sent['x-csrftoken'], CSRF);
  });

  await t.test('names the failure instead of just saying no', async () => {
    assert.match((await verify(creds, ok('', 401))).reason, /rejected the cookie \(HTTP 401\)/);
    assert.match((await verify(creds, ok('<!DOCTYPE html>'))).reason, /HTML/);
    assert.match(
      (await verify(creds, ok({ message: 'checkpoint_required' }))).reason,
      /checkpoint/,
    );
    assert.match((await verify(creds, ok({ data: {} }))).reason, /no profile/);
  });

  await t.test('a network error is a result, not a crash', async () => {
    const boom = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const r = await verify(creds, boom);
    assert.equal(r.ok, false);
    assert.match(r.reason, /network error/);
  });
});
