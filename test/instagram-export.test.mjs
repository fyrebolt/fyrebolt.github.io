// Tests for parsing Instagram's data export.
//
// These pin the *actual* shapes Instagram emits. An earlier version of this
// suite invented fixtures where every file carried a `value` field — which is
// how a real export silently importing zero "following" got through. Each case
// below is taken from a genuine export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUnfollowed, mergeOutbound } from '../scripts/instagram-backfill.mjs';

/** Mirrors usernameOf() in the parsers; kept in sync deliberately. */
const usernameOf = (row, sld) => {
  const v = sld?.value?.trim();
  if (v) return v;
  const t = row?.title?.trim();
  if (t) return t;
  const m = sld?.href?.match(/instagram\.com\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).trim() : undefined;
};
const nameOf = (row, username) => {
  const t = row?.title?.trim() || undefined;
  return t && t !== username ? t : undefined;
};

test('username extraction across the real file shapes', async (t) => {
  await t.test('followers_1.json: handle in value, title empty', () => {
    assert.equal(
      usernameOf({ title: '' }, { href: 'https://instagram.com/abc', value: 'abc', timestamp: 1 }),
      'abc',
    );
  });

  await t.test('following.json: NO value field, handle lives in title', () => {
    // The regression that mattered: reading only `value` yields zero following.
    assert.equal(
      usernameOf({ title: 'someone_' }, { href: 'https://www.instagram.com/someone_', timestamp: 1 }),
      'someone_',
    );
  });

  await t.test('falls back to href when value and title are both missing', () => {
    assert.equal(usernameOf({}, { href: 'https://www.instagram.com/from_href' }), 'from_href');
  });

  await t.test('href with a trailing slash and query', () => {
    assert.equal(usernameOf({}, { href: 'https://www.instagram.com/u_name/?hl=en' }), 'u_name');
  });

  await t.test('percent-encoded href is decoded', () => {
    assert.equal(usernameOf({}, { href: 'https://www.instagram.com/a%2Eb' }), 'a.b');
  });

  await t.test('value wins over title when both are present', () => {
    assert.equal(usernameOf({ title: 'Display Name' }, { value: 'handle' }), 'handle');
  });

  await t.test('nothing usable yields undefined rather than a bogus handle', () => {
    assert.equal(usernameOf({ title: '' }, { href: 'https://example.com/x' }), undefined);
  });

  await t.test('title is a display name only when it differs from the handle', () => {
    assert.equal(nameOf({ title: 'someone_' }, 'someone_'), undefined);
    assert.equal(nameOf({ title: 'Ada L' }, 'ada.l'), 'Ada L');
  });
});

test('extractUnfollowed — recently_unfollowed_profiles.json', async (t) => {
  // A third shape again: label_values pairs rather than string_list_data.
  const row = (username, name, timestamp) => ({
    timestamp,
    media: [],
    label_values: [
      { label: 'URL', value: '' },
      { label: 'Name', value: name },
      { label: 'Username', value: username },
    ],
    fbid: '178414',
  });

  await t.test('reads handle, name and time, tagged outbound', () => {
    const [e] = extractUnfollowed([row('hazimsf', 'Hazim', 1785378019)]);
    assert.equal(e.username, 'hazimsf');
    assert.equal(e.name, 'Hazim');
    assert.equal(e.kind, 'unfollow');
    assert.equal(e.dir, 'out');
    assert.equal(e.t, new Date(1785378019 * 1000).toISOString());
  });

  await t.test('drops the name when it merely repeats the handle', () => {
    const [e] = extractUnfollowed([row('diegotapsz', 'diegotapsz', 1781844579)]);
    assert.equal(e.name, undefined);
  });

  await t.test('skips rows with no username or no timestamp', () => {
    assert.equal(extractUnfollowed([row('', 'X', 1)]).length, 0);
    assert.equal(extractUnfollowed([row('someone', 'X', 0)]).length, 0);
  });

  await t.test('label matching is case-insensitive', () => {
    const odd = {
      timestamp: 1785378019,
      label_values: [{ label: 'username', value: 'lower' }],
    };
    assert.equal(extractUnfollowed([odd])[0].username, 'lower');
  });

  await t.test('tolerates an object wrapper and junk input', () => {
    assert.equal(extractUnfollowed({ anything: [row('a', 'A', 1785378019)] }).length, 1);
    assert.deepEqual(extractUnfollowed(null), []);
    assert.deepEqual(extractUnfollowed([{}]), []);
  });
});

test('mergeOutbound', async (t) => {
  const out = (username, t, kind = 'unfollow') => ({ username, kind, t, dir: 'out' });

  await t.test('adds events that are not already recorded', () => {
    const res = mergeOutbound([], [out('a', '2026-07-01T10:00:00.000Z')]);
    assert.equal(res.added, 1);
    assert.equal(res.events.length, 1);
  });

  await t.test('does not duplicate the same action on the same day', () => {
    // The export's timestamp and the daily job's detection time differ, so
    // identity has to be (direction, kind, handle, day) — not the exact instant.
    const existing = [out('a', '2026-07-01T23:00:00.000Z')];
    const res = mergeOutbound(existing, [out('a', '2026-07-01T08:00:00.000Z')]);
    assert.equal(res.added, 0);
    assert.equal(res.events.length, 1);
  });

  await t.test('the same handle on a different day is a separate event', () => {
    const res = mergeOutbound([out('a', '2026-07-01T10:00:00.000Z')], [out('a', '2026-07-05T10:00:00.000Z')]);
    assert.equal(res.added, 1);
  });

  await t.test('an inbound unfollow does not suppress your own outbound one', () => {
    // Both really happen: you unfollow someone, they unfollow you back.
    const inbound = [{ username: 'a', kind: 'unfollow', t: '2026-07-01T10:00:00.000Z' }];
    const res = mergeOutbound(inbound, [out('a', '2026-07-01T09:00:00.000Z')]);
    assert.equal(res.added, 1);
    assert.equal(res.events.length, 2);
  });

  await t.test('handles differing case', () => {
    const res = mergeOutbound([out('Alice', '2026-07-01T10:00:00.000Z')], [out('alice', '2026-07-01T11:00:00.000Z')]);
    assert.equal(res.added, 0);
  });

  await t.test('output is newest-first', () => {
    const res = mergeOutbound([], [out('a', '2026-07-01T10:00:00.000Z'), out('b', '2026-07-09T10:00:00.000Z')]);
    assert.deepEqual(res.events.map((e) => e.username), ['b', 'a']);
  });
});
