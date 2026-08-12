// Unit tests for the pure logic in scripts/instagram-pull.mjs.
// Run with `npm test` (node:test — no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookieHeader, buildSession } from '../scripts/lib/instagram-session.mjs';
import {
  mergeSince,
  diffList,
  appendSnapshot,
  countMutuals,
  checkCompleteness,
  alreadySucceededToday,
  localDay,
  verdict,
  expectedRelationship,
  stableList,
  verifyCandidates,
  absenceStreaks,
  settleAbsences,
  ABSENCE_LIMIT,
  publishDecision,
  isPushRejection,
} from '../scripts/instagram-pull.mjs';

const P = (username, extra = {}) => ({ username, ...extra });
const NOW = '2026-07-30T12:00:00.000Z';
const many = (prefix, n) => Array.from({ length: n }, (_, i) => P(prefix + i));

test('parseCookieHeader', async (t) => {
  await t.test('extracts the three values from a real-looking header', () => {
    const jar = parseCookieHeader(
      'mid=ZabcD; ig_did=X-Y; csrftoken=tok123; ds_user_id=48291; sessionid=48291%3AAbC%3A17',
    );
    assert.equal(jar.sessionid, '48291%3AAbC%3A17');
    assert.equal(jar.ds_user_id, '48291');
    assert.equal(jar.csrftoken, 'tok123');
  });

  await t.test('tolerates a trailing semicolon and stray whitespace', () => {
    const jar = parseCookieHeader('  sessionid=abc ;  csrftoken=t ; ');
    assert.equal(jar.sessionid, 'abc');
    assert.equal(jar.csrftoken, 't');
  });

  await t.test('keeps "=" inside a value (base64 padding)', () => {
    assert.equal(parseCookieHeader('x=YWJj==').x, 'YWJj==');
  });

  await t.test('a pasted "cookie:" prefix is harmless', () => {
    // Easy mistake when copying from devtools; the first pair is mangled but
    // sessionid still parses, which is all that matters.
    assert.equal(parseCookieHeader('cookie: mid=a; sessionid=xyz').sessionid, 'xyz');
  });
});

test('buildSession — the cookie both the pull and the agent send', async (t) => {
  await t.test('assembles the three values out of a pasted header', () => {
    const s = buildSession({
      cookie: 'mid=Z; csrftoken=tok123; ds_user_id=48291; sessionid=48291%3AAbC',
    });
    assert.equal(s.sessionid, '48291%3AAbC');
    assert.equal(s.csrftoken, 'tok123');
    assert.equal(s.cookie, 'sessionid=48291%3AAbC; ds_user_id=48291; csrftoken=tok123');
  });

  await t.test('explicit fields win over the pasted header', () => {
    const s = buildSession({ cookie: 'sessionid=from_header', sessionid: 'explicit' });
    assert.equal(s.sessionid, 'explicit');
    assert.equal(s.cookie, 'sessionid=explicit');
  });

  await t.test('missing credentials are reported, not faked', () => {
    const s = buildSession({});
    assert.equal(s.sessionid, undefined);
    assert.equal(s.cookie, '');
    assert.equal(s.csrftoken, '');
  });
});

test('mergeSince', async (t) => {
  await t.test('first real run leaves everyone undated', () => {
    // Better undated than every follower falsely claiming to have joined today.
    const out = mergeSince([P('a'), P('b')], null, NOW, true);
    assert.deepEqual(out.map((p) => p.since), [undefined, undefined]);
  });

  await t.test('carries an existing date forward, stamps only the newcomer', () => {
    const prev = [P('old', { since: '2024-01-05T00:00:00.000Z' })];
    const out = mergeSince([P('old'), P('new')], prev, NOW, false);
    assert.equal(out[0].since, '2024-01-05T00:00:00.000Z');
    assert.equal(out[1].since, NOW);
  });

  await t.test('matches previous entries case-insensitively', () => {
    const prev = [P('MixedCase', { since: '2024-01-05T00:00:00.000Z' })];
    assert.equal(mergeSince([P('mixedcase')], prev, NOW, false)[0].since, '2024-01-05T00:00:00.000Z');
  });

  await t.test('keeps fresh profile fields while merging the date', () => {
    const prev = [P('a', { since: '2024-01-05T00:00:00.000Z', name: 'Stale' })];
    const out = mergeSince([P('a', { name: 'Fresh', verified: true })], prev, NOW, false);
    assert.equal(out[0].name, 'Fresh');
    assert.equal(out[0].verified, true);
  });
});

test('diffList (inbound — the followers list)', async (t) => {
  await t.test('detects a gain and a loss in the same run', () => {
    const { added, removed } = diffList(
      [P('stays'), P('arrives')],
      [P('stays'), P('leaves', { name: 'Lee' })],
      NOW,
      'in',
    );
    assert.deepEqual(added.map((e) => e.username), ['arrives']);
    assert.deepEqual(removed.map((e) => e.username), ['leaves']);
    assert.equal(removed[0].kind, 'unfollow');
    assert.equal(removed[0].name, 'Lee', 'name is carried from the previous state');
  });

  await t.test('inbound events carry no dir at all', () => {
    // Absent means inbound, which is what every event recorded before outbound
    // tracking existed was — writing dir:'in' would make old and new differ.
    const { added } = diffList([P('a')], [], NOW, 'in');
    assert.ok(!('dir' in added[0]));
  });

  await t.test('a username case change is not a follow+unfollow pair', () => {
    const { added, removed } = diffList([P('Alice')], [P('alice')], NOW, 'in');
    assert.deepEqual(added, []);
    assert.deepEqual(removed, []);
  });

  await t.test('no baseline means everyone counts as added', () => {
    const { added, removed } = diffList([P('a'), P('b')], [], NOW, 'in');
    assert.equal(added.length, 2);
    assert.equal(removed.length, 0);
  });
});

test('diffList (outbound — the following list)', async (t) => {
  await t.test('tags your own actions with dir "out"', () => {
    const { added, removed } = diffList(
      [P('kept'), P('newlyFollowed')],
      [P('kept'), P('dropped', { name: 'Dee' })],
      NOW,
      'out',
    );
    assert.deepEqual(added.map((e) => e.username), ['newlyFollowed']);
    assert.deepEqual(removed.map((e) => e.username), ['dropped']);
    assert.ok(added.every((e) => e.dir === 'out'));
    assert.ok(removed.every((e) => e.dir === 'out'));
    assert.equal(added[0].kind, 'follow');
    assert.equal(removed[0].kind, 'unfollow');
    assert.equal(removed[0].name, 'Dee');
  });

  await t.test('is case-insensitive like the inbound diff', () => {
    const { added, removed } = diffList([P('Someone')], [P('someone')], NOW, 'out');
    assert.deepEqual(added, []);
    assert.deepEqual(removed, []);
  });
});

test('appendSnapshot', async (t) => {
  await t.test('re-running the same day replaces rather than duplicates', () => {
    const first = appendSnapshot([{ t: '2026-07-28T12:00:00.000Z', followers: 100 }], {
      t: '2026-07-29T09:00:00.000Z',
      followers: 105,
    });
    const second = appendSnapshot(first, { t: '2026-07-29T21:00:00.000Z', followers: 107 });
    assert.equal(second.length, 2);
    assert.equal(second[1].followers, 107);
  });

  await t.test('keeps output oldest-first even on out-of-order input', () => {
    const out = appendSnapshot([{ t: '2026-07-27T12:00:00.000Z', followers: 1 }], {
      t: '2026-07-26T12:00:00.000Z',
      followers: 2,
    });
    assert.deepEqual(out.map((s) => s.followers), [2, 1]);
  });

  await t.test('handles a null history', () => {
    assert.equal(appendSnapshot(null, { t: NOW, followers: 5 }).length, 1);
  });
});

test('countMutuals counts the intersection, case-insensitively', () => {
  assert.equal(countMutuals([P('a'), P('B'), P('c')], [P('A'), P('b'), P('d')]), 2);
});

test('checkCompleteness — the guard against phantom unfollows', async (t) => {
  // A throttled or truncated read is indistinguishable from a mass unfollow to
  // a diffing tracker. These cases are why it refuses to write rather than
  // record fiction.
  await t.test('passes on a complete read', () => {
    assert.equal(
      checkCompleteness(many('f', 100), [P('x')], { followerCount: 100, followingCount: 1 }, null),
      null,
    );
  });

  await t.test('flags a truncated follower read against the reported total', () => {
    const res = checkCompleteness(many('f', 40), [], { followerCount: 100, followingCount: null }, null);
    assert.match(res, /paged 40 followers but the profile reports 100/);
  });

  await t.test('flags a truncated following read', () => {
    const res = checkCompleteness([], many('g', 5), { followerCount: null, followingCount: 100 }, null);
    assert.match(res, /paged 5 following but the profile reports 100/);
  });

  await t.test('flags a halving versus the previous run', () => {
    const res = checkCompleteness(many('f', 40), [], { followerCount: null, followingCount: null }, {
      followers: many('p', 100),
    });
    assert.match(res, /halved/);
  });

  await t.test('a sample baseline is ignored, so the first real run is not flagged', () => {
    const res = checkCompleteness(many('f', 40), [], { followerCount: null, followingCount: null }, {
      sample: true,
      followers: many('s', 1312),
    });
    assert.equal(res, null);
  });

  await t.test('a genuine small dip is allowed through', () => {
    const res = checkCompleteness(many('f', 98), [], { followerCount: 98, followingCount: null }, {
      followers: many('f', 100),
    });
    assert.equal(res, null);
  });

  await t.test('missing reported counts do not falsely flag', () => {
    assert.equal(
      checkCompleteness([P('a')], [P('b')], { followerCount: null, followingCount: null }, null),
      null,
    );
  });
});

test('alreadySucceededToday — the once-daily guard', async (t) => {
  const at = (iso) => ({ sample: false, generatedAt: iso, followers: [] });
  const NOON = new Date('2026-07-30T14:00:00-07:00');

  await t.test('a run earlier today counts', () => {
    assert.equal(alreadySucceededToday(at('2026-07-30T09:20:00-07:00'), NOON), true);
  });

  await t.test('yesterday does not count', () => {
    assert.equal(alreadySucceededToday(at('2026-07-29T23:59:00-07:00'), NOON), false);
  });

  await t.test('sample data never counts', () => {
    assert.equal(alreadySucceededToday({ sample: true, generatedAt: NOON.toISOString() }, NOON), false);
  });

  await t.test('missing / malformed history does not count', () => {
    assert.equal(alreadySucceededToday(null, NOON), false);
    assert.equal(alreadySucceededToday(at('not-a-date'), NOON), false);
    assert.equal(alreadySucceededToday({ sample: false }, NOON), false);
  });

  await t.test('a late-evening local run still counts as today, though UTC disagrees', () => {
    // The reason the comparison is local: at UTC-7 an 18:30 run is already
    // tomorrow in UTC, so a UTC comparison would re-run minutes later.
    const evening = new Date('2026-07-30T18:30:00-07:00');
    assert.equal(evening.toISOString().slice(0, 10), '2026-07-31', 'precondition: UTC has rolled over');
    assert.equal(localDay(evening), '2026-07-30');
    assert.equal(alreadySucceededToday(at(evening.toISOString()), evening), true);
  });

  await t.test('just after local midnight is a new day', () => {
    const justAfter = new Date('2026-07-31T00:05:00-07:00');
    assert.equal(alreadySucceededToday(at('2026-07-30T23:50:00-07:00'), justAfter), false);
  });
});

test('verdict — the guard against paging churn', async (t) => {
  // Why this exists: two runs minutes apart both returned 865 following, but
  // not the same 865. Four accounts fell out of the paged read and four others
  // appeared, inventing four unfollows and four follows that never happened.
  // Totals matched exactly, so checkCompleteness could not have caught it.
  const inbound = (kind) => ({ username: 'x', kind, t: NOW });
  const outbound = (kind) => ({ username: 'x', kind, t: NOW, dir: 'out' });

  await t.test('inbound events are judged on follows_viewer', () => {
    assert.equal(expectedRelationship(inbound('follow')).field, 'follows_viewer');
    assert.equal(verdict(inbound('follow'), { follows_viewer: true }), true);
    assert.equal(verdict(inbound('follow'), { follows_viewer: false }), false);
    assert.equal(verdict(inbound('unfollow'), { follows_viewer: false }), true);
    assert.equal(verdict(inbound('unfollow'), { follows_viewer: true }), false);
  });

  await t.test('outbound events are judged on followed_by_viewer', () => {
    assert.equal(expectedRelationship(outbound('follow')).field, 'followed_by_viewer');
    assert.equal(verdict(outbound('unfollow'), { followed_by_viewer: false }), true);
    // The real regression: still following them, so the "you unfollowed" is bogus.
    assert.equal(verdict(outbound('unfollow'), { followed_by_viewer: true }), false);
    assert.equal(verdict(outbound('follow'), { followed_by_viewer: true }), true);
  });

  await t.test('the two directions do not read each other’s field', () => {
    // An inbound verdict must ignore followed_by_viewer entirely, and vice versa.
    assert.equal(verdict(inbound('unfollow'), { followed_by_viewer: false }), null);
    assert.equal(verdict(outbound('unfollow'), { follows_viewer: false }), null);
  });

  await t.test('a deleted account confirms an unfollow but never a follow', () => {
    assert.equal(verdict(inbound('unfollow'), 'gone'), true);
    assert.equal(verdict(outbound('unfollow'), 'gone'), true);
    assert.equal(verdict(inbound('follow'), 'gone'), false);
  });

  await t.test('an unknown relationship yields null, so the caller drops it', () => {
    // Better to miss a real change — the next run catches it — than to write
    // fiction into permanent history.
    assert.equal(verdict(inbound('unfollow'), {}), null);
    assert.equal(verdict(inbound('unfollow'), null), null);
    assert.equal(verdict(inbound('unfollow'), { follows_viewer: undefined }), null);
    assert.equal(verdict(inbound('unfollow'), { follows_viewer: 'no' }), null, 'non-boolean is not a verdict');
  });
});

test('stableList — people leave only when an unfollow is confirmed', async (t) => {
  // The other half of the paging-churn defect. Rebuilding the list from each
  // read meant a missed page deleted people, and their reappearance next run
  // looked like a brand-new follow — which verification cannot disprove,
  // because "do you follow them?" is true either way.
  const none = new Set();

  await t.test('someone missing from a read is retained', () => {
    const out = stableList([P('kept'), P('missedByPaging')], [P('kept')], none);
    assert.deepEqual(out.map((p) => p.username), ['kept', 'missedByPaging']);
  });

  await t.test('and therefore never re-appears as a new follow', () => {
    const afterMiss = stableList([P('a'), P('b')], [P('a')], none);
    const { added } = diffList([P('a'), P('b')], afterMiss, NOW, 'in');
    assert.deepEqual(added, [], 'b was never dropped, so its return is not a follow');
  });

  await t.test('a confirmed unfollow does remove them', () => {
    const out = stableList([P('a'), P('leaver')], [P('a')], new Set(['leaver']));
    assert.deepEqual(out.map((p) => p.username), ['a']);
  });

  await t.test('genuinely new accounts are added', () => {
    const out = stableList([P('a')], [P('a'), P('brandNew')], none);
    assert.deepEqual(out.map((p) => p.username).sort(), ['a', 'brandNew']);
  });

  await t.test('fresh fields win, but the earliest known date is kept', () => {
    const out = stableList(
      [P('a', { since: '2024-01-01T00:00:00.000Z', name: 'Old' })],
      [P('a', { since: NOW, name: 'New', verified: true })],
      none,
    );
    assert.equal(out[0].since, '2024-01-01T00:00:00.000Z');
    assert.equal(out[0].name, 'New');
    assert.equal(out[0].verified, true);
  });

  await t.test('matching is case-insensitive, so case drift cannot duplicate', () => {
    const out = stableList([P('Alice')], [P('alice')], none);
    assert.equal(out.length, 1);
  });

  await t.test('the absence counter is stamped on, and cleared on return', () => {
    const streaks = new Map([['gone', 2], ['here', 0]]);
    const out = stableList(
      [P('gone', { missing: 1 }), P('here', { missing: 5 })],
      [P('here')],
      none,
      streaks,
    );
    const by = Object.fromEntries(out.map((p) => [p.username, p]));
    assert.equal(by.gone.missing, 2, 'the streak comes from this run, not the stored value');
    assert.equal('missing' in by.here, false, 'back in the read, so no streak to carry');
  });
});

test('verifyCandidates — one bad handle must not sink the run', async (t) => {
  const CREDS = { account: 'me', cookie: 'sessionid=x', csrftoken: 't' };
  const noPause = () => {};
  // Responses are keyed by the username in the URL, so each candidate can fail
  // its own way within a single run.
  const stubFetch = (byUser) => {
    globalThis.fetch = async (url) => {
      const user = new URL(url).searchParams.get('username');
      const r = byUser[user];
      if (typeof r === 'function') return r();
      return {
        ok: r.status < 400,
        status: r.status,
        text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      };
    };
  };
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const follows = (v) => ({ status: 200, body: { data: { user: { id: '9', follows_viewer: v } } } });

  await t.test('a 400 on one profile drops that candidate and keeps going', async () => {
    // Exactly the shape that killed the real job: Instagram 400s a profile whose
    // own business-category schema it can no longer render.
    stubFetch({
      quantprof_dot_org: {
        status: 400,
        body: { message: 'Asset asset://laser.provider/... has been deleted', status: 'fail' },
      },
      bob: follows(true),
    });

    const { kept, dropped } = await verifyCandidates(
      [
        { username: 'quantprof_dot_org', kind: 'follow', t: NOW },
        { username: 'bob', kind: 'follow', t: NOW },
      ],
      CREDS,
      noPause,
    );

    assert.deepEqual(kept.map((e) => e.username), ['bob']);
    assert.deepEqual(dropped.map((e) => [e.username, e.why]), [
      ['quantprof_dot_org', 'unverifiable'],
    ]);
  });

  await t.test('a 404 is an answer, not a failure to answer', () => {
    // A handle that no longer resolves cannot still be following you. Read as
    // "unverifiable" instead, a deleted account could never be confirmed gone,
    // so it stuck in the list and had its unfollow re-discarded every run.
    stubFetch({ deleted: { status: 404, body: {} } });

    return verifyCandidates(
      [
        { username: 'deleted', kind: 'unfollow', t: NOW },
        { username: 'deleted', kind: 'unfollow', t: NOW, dir: 'out' },
      ],
      CREDS,
      noPause,
    ).then(({ kept, dropped }) => {
      assert.equal(kept.length, 2, 'gone in both directions');
      assert.deepEqual(dropped, []);
    });
  });

  await t.test('but a 404 cannot confirm a *follow*', () => {
    stubFetch({ deleted: { status: 404, body: {} } });

    return verifyCandidates(
      [{ username: 'deleted', kind: 'follow', t: NOW }],
      CREDS,
      noPause,
    ).then(({ kept, dropped }) => {
      assert.deepEqual(kept, []);
      assert.deepEqual(dropped.map((e) => e.why), ['contradicted']);
    });
  });

  // A network error takes the same non-fatal path as the 400 above, and covering
  // it here would mean sitting through 90s of real retry backoff.

  await t.test('but an expired cookie aborts, rather than discarding a real day', async () => {
    // Swallowing this would mark every candidate "unverifiable" and quietly bin
    // a whole day of genuine follows and unfollows.
    stubFetch({ alice: { status: 401, body: {} }, bob: follows(true) });

    await assert.rejects(
      () =>
        verifyCandidates(
          [
            { username: 'alice', kind: 'follow', t: NOW },
            { username: 'bob', kind: 'follow', t: NOW },
          ],
          CREDS,
          noPause,
        ),
      /Session cookie expired/,
    );
  });

  await t.test('a checkpoint page aborts as well', async () => {
    stubFetch({ alice: { status: 200, body: '<!DOCTYPE html><html>login</html>' } });

    await assert.rejects(
      () => verifyCandidates([{ username: 'alice', kind: 'follow', t: NOW }], CREDS, noPause),
      /HTML instead of JSON/,
    );
  });
});

test('absenceStreaks — how long someone has been missing', async (t) => {
  await t.test('anyone in the read is at zero', () => {
    const s = absenceStreaks([P('a'), P('b')], [P('a'), P('b')]);
    assert.equal(s.get('a'), 0);
    assert.equal(s.get('b'), 0);
  });

  await t.test('an absence counts, and keeps counting', () => {
    assert.equal(absenceStreaks([P('a')], []).get('a'), 1);
    assert.equal(absenceStreaks([P('a', { missing: 2 })], []).get('a'), 3);
  });

  await t.test('showing up again resets it — the streak has to be unbroken', () => {
    assert.equal(absenceStreaks([P('a', { missing: 9 })], [P('a')]).get('a'), 0);
  });

  await t.test('a nonsense counter starts over rather than throwing', () => {
    for (const junk of ['3', -1.5, null, NaN]) {
      assert.equal(absenceStreaks([P('a', { missing: junk })], []).get('a'), 1);
    }
  });

  await t.test('someone new to this read has no streak to answer for', () => {
    assert.equal(absenceStreaks([], [P('newcomer')]).get('newcomer'), undefined);
  });
});

test('settleAbsences — a disappearance that outlasts the churn explanation', async (t) => {
  // The defect this exists for: an account whose profile endpoint never answers
  // cleanly is missing from every read, so its unfollow is re-detected daily and
  // re-discarded daily, and it sits in the list forever. Seen for real with a
  // deleted account (404) and one Instagram itself 400s on.
  const drop = (username, why, extra = {}) => ({
    username,
    kind: 'unfollow',
    t: NOW,
    why,
    ...extra,
  });
  const streaks = (inPairs = [], outPairs = []) => ({
    in: new Map(inPairs),
    out: new Map(outPairs),
  });

  await t.test('a long enough absence settles an unverifiable unfollow', () => {
    const { settled, unresolved } = settleAbsences(
      [drop('ghost', 'unverifiable')],
      streaks([['ghost', ABSENCE_LIMIT]]),
    );
    assert.deepEqual(unresolved, []);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].username, 'ghost');
  });

  await t.test('a short one does not', () => {
    const { settled, unresolved } = settleAbsences(
      [drop('blinked', 'unverifiable')],
      streaks([['blinked', ABSENCE_LIMIT - 1]]),
    );
    assert.deepEqual(settled, []);
    assert.equal(unresolved.length, 1);
  });

  await t.test('the drop note is stripped, and the streak recorded in its place', () => {
    // `why` explains a decision not to record; it is not itself history. What
    // replaces it says this unfollow was inferred rather than confirmed.
    const [event] = settleAbsences(
      [drop('ghost', 'unverifiable', { name: 'Ghost' })],
      streaks([['ghost', 4]]),
    ).settled;
    assert.equal(event.why, undefined);
    assert.equal(event.absent, 4);
    assert.deepEqual({ ...event, absent: undefined }, {
      username: 'ghost',
      kind: 'unfollow',
      t: NOW,
      name: 'Ghost',
      absent: undefined,
    });
  });

  await t.test('a contradicted event stays dropped however long the absence', () => {
    // Instagram saying the relationship is still live outranks a read that keeps
    // missing them — that is a broken read, not a departure.
    const { settled, unresolved } = settleAbsences(
      [drop('stillThere', 'contradicted')],
      streaks([['stillThere', 99]]),
    );
    assert.deepEqual(settled, []);
    assert.equal(unresolved.length, 1);
  });

  await t.test('a follow is never settled this way — only a disappearance is', () => {
    const { settled } = settleAbsences(
      [{ username: 'x', kind: 'follow', t: NOW, why: 'unverifiable' }],
      streaks([['x', 99]]),
    );
    assert.deepEqual(settled, []);
  });

  await t.test('each direction is judged on its own list', () => {
    // Absent from your following list says nothing about your followers list.
    const dropped = [drop('them', 'unverifiable', { dir: 'out' })];
    const wrongList = streaks([['them', 99]], []);
    assert.deepEqual(settleAbsences(dropped, wrongList).settled, []);
    const rightList = streaks([], [['them', 99]]);
    assert.equal(settleAbsences(dropped, rightList).settled.length, 1);
  });
});

test('publishDecision', async (t) => {
  await t.test('publishes from main', () => {
    assert.deepEqual(publishDecision('main'), { publish: true, where: 'main' });
  });

  await t.test('refuses to commit onto a feature branch', () => {
    // Committing there is worse than not committing: the data lands somewhere
    // that never deploys, the push fails for want of an upstream, and the commit
    // has to be picked back out of someone's feature history.
    const d = publishDecision('art-calligraphy');
    assert.equal(d.publish, false);
    assert.match(d.where, /art-calligraphy/);
  });

  await t.test('refuses on a detached HEAD, and says so in words', () => {
    // `git rev-parse --abbrev-ref HEAD` answers the literal string "HEAD" when
    // detached, which would otherwise read as a branch named HEAD.
    const d = publishDecision('HEAD');
    assert.equal(d.publish, false);
    assert.equal(d.where, 'a detached HEAD');
    assert.equal(publishDecision('').publish, false);
  });

  await t.test('honours a different publish branch', () => {
    assert.equal(publishDecision('trunk', 'trunk').publish, true);
    assert.equal(publishDecision('main', 'trunk').publish, false);
  });
});

test('isPushRejection', async (t) => {
  await t.test('recognises a clone that has fallen behind origin', () => {
    // The single most common way this job goes quiet: the pull keeps working and
    // only the publish fails, so nothing looks broken until the site is days old.
    assert.equal(
      isPushRejection('! [rejected] main -> main (non-fast-forward)\nfetch first'),
      true,
    );
    assert.equal(isPushRejection('Updates were rejected because the remote contains work'), true);
  });

  await t.test('does not retry what a retry cannot fix', () => {
    // Rebasing and pushing again after an auth failure just fails twice.
    assert.equal(isPushRejection('fatal: Authentication failed for https://github.com/'), false);
    assert.equal(isPushRejection('fatal: unable to access ... Could not resolve host'), false);
    assert.equal(isPushRejection('fatal: The current branch x has no upstream branch'), false);
    assert.equal(isPushRejection(undefined), false);
  });
});
