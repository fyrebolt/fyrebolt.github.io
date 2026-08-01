// Tests for the paste-cleaning in scripts/linkedin-setup.mjs.
//
// Every case below is a shape someone can plausibly end up with on the
// clipboard while following the DevTools instructions. The one that actually
// bites is JSESSIONID: LinkedIn displays it *with* double quotes, and pasting
// that verbatim into JSON produces a file that won't parse — and voyager
// rejects the quoted form anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSecrets,
  clean,
  fromHeader,
  interpret,
  normaliseProfile,
} from '../scripts/linkedin-setup.mjs';

const LI_AT = 'AQEDATRdemo0000000000000000000000000000000000000000000000000000000000000000';

test('clean', async (t) => {
  await t.test('strips the quotes LinkedIn shows around JSESSIONID', () => {
    assert.equal(clean('"ajax:1234567890"'), 'ajax:1234567890');
  });

  await t.test('strips a name= prefix copied along with the value', () => {
    assert.equal(clean('li_at=' + LI_AT), LI_AT);
    assert.equal(clean('JSESSIONID="ajax:123"'), 'ajax:123');
  });

  await t.test('strips a Cookie: prefix, whitespace and a trailing semicolon', () => {
    assert.equal(clean('  Cookie: li_at=' + LI_AT + ';  '), LI_AT);
  });

  await t.test('leaves an already-clean value alone', () => {
    assert.equal(clean(LI_AT), LI_AT);
    assert.equal(clean('ajax:123'), 'ajax:123');
  });

  await t.test('survives empty input', () => {
    assert.equal(clean(''), '');
    assert.equal(clean(undefined), '');
  });
});

test('fromHeader', async (t) => {
  const header = `bcookie="v=2&abc"; li_at=${LI_AT}; JSESSIONID="ajax:7788990011"; lang=v=2&lang=en-us`;

  await t.test('pulls a named cookie out of a whole header', () => {
    assert.equal(fromHeader(header, 'li_at'), LI_AT);
    assert.equal(fromHeader(header, 'JSESSIONID'), 'ajax:7788990011');
  });

  await t.test('matches the name case-insensitively', () => {
    assert.equal(fromHeader(header, 'jsessionid'), 'ajax:7788990011');
  });

  await t.test('returns null when the cookie is absent', () => {
    assert.equal(fromHeader(header, 'li_gc'), null);
    assert.equal(fromHeader('', 'li_at'), null);
  });
});

test('interpret', async (t) => {
  const header = `bcookie="v=2"; li_at=${LI_AT}; JSESSIONID="ajax:778899"`;

  await t.test('accepts a whole pasted cookie header', () => {
    // People reach for whichever thing is in front of them; rejecting the
    // wrong-but-reasonable paste is how a setup step gets abandoned.
    assert.equal(interpret(header, 'li_at'), LI_AT);
    assert.equal(interpret(header, 'JSESSIONID'), 'ajax:778899');
  });

  await t.test('accepts a bare value', () => {
    assert.equal(interpret(LI_AT, 'li_at'), LI_AT);
    assert.equal(interpret('"ajax:778899"', 'JSESSIONID'), 'ajax:778899');
  });

  await t.test('accepts a single name=value pair', () => {
    assert.equal(interpret('li_at=' + LI_AT, 'li_at'), LI_AT);
  });

  await t.test('returns null for nothing at all', () => {
    assert.equal(interpret('', 'li_at'), null);
    assert.equal(interpret('   ', 'li_at'), null);
  });

  await t.test('a header missing the asked-for cookie does not yield junk', () => {
    // Pasting the header into the JSESSIONID prompt when it has no JSESSIONID
    // must not hand back the whole header as if it were the value.
    const partial = `bcookie="v=2"; li_at=${LI_AT}`;
    assert.equal(interpret(partial, 'JSESSIONID'), null);
  });
});

test('interpret rejects the wrong single pair', () => {
  // Pasting li_at into the JSESSIONID prompt is a plausible slip, and silently
  // accepting it would write a file that 403s with no clue why.
  assert.equal(interpret('li_at=' + LI_AT, 'JSESSIONID'), null);
});

test('normaliseProfile', async (t) => {
  await t.test('accepts a bare slug, a full URL, or a URL with a path', () => {
    assert.equal(normaliseProfile('hastinchen'), 'hastinchen');
    assert.equal(normaliseProfile('https://www.linkedin.com/in/hastinchen'), 'hastinchen');
    assert.equal(normaliseProfile('linkedin.com/in/hastinchen/recent-activity/'), 'hastinchen');
    assert.equal(normaliseProfile('https://linkedin.com/in/hastinchen?trk=nav'), 'hastinchen');
  });

  await t.test('falls back when the answer is empty', () => {
    assert.equal(normaliseProfile(''), 'hastinchen');
    assert.equal(normaliseProfile('   '), 'hastinchen');
  });
});

test('buildSecrets', async (t) => {
  const args = { liAt: 'AQED123', jsession: 'ajax:99', profile: 'hastinchen', publish: false };

  await t.test('writes the fields the puller reads', () => {
    assert.deepEqual(buildSecrets(args), {
      profile: 'hastinchen',
      li_at: 'AQED123',
      jsessionid: 'ajax:99',
      publishViewers: false,
    });
  });

  await t.test('defaults publishViewers to false, never undefined', () => {
    // An undefined here would read as "not opted in" today but is fragile; the
    // privacy default should be explicit in the file.
    assert.equal(buildSecrets({ ...args, publish: undefined }).publishViewers, false);
    assert.equal(buildSecrets({ ...args, publish: true }).publishViewers, true);
  });

  await t.test('keeps unrelated existing keys on a re-run', () => {
    const out = buildSecrets({ ...args, existing: { agentToken: 'keep-me' } });
    assert.equal(out.agentToken, 'keep-me');
  });

  await t.test('drops a stale pasted cookie header', () => {
    // loadSecrets prefers the explicit values, so a leftover `cookie` would be
    // a dead field that looks authoritative.
    const out = buildSecrets({ ...args, existing: { cookie: 'li_at=old; JSESSIONID="ajax:old"' } });
    assert.equal('cookie' in out, false);
  });

  await t.test('the result round-trips through JSON', () => {
    const parsed = JSON.parse(JSON.stringify(buildSecrets(args)));
    assert.equal(parsed.jsessionid, 'ajax:99');
  });
});
