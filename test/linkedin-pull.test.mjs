// Unit tests for the pure logic in scripts/linkedin-pull.mjs.
// Run with `npm test` (node:test — no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alreadySucceededToday,
  appendSnapshot,
  checkCompleteness,
  collectProfiles,
  csrfFromJsessionid,
  diffConnections,
  extractCounts,
  extractViewers,
  firstNumber,
  indexByUrn,
  localDay,
  mergeSince,
  mergeViews,
  parseCookieHeader,
  redactViews,
  stableList,
  textOf,
  toPerson,
  viewTimeOf,
} from '../scripts/linkedin-pull.mjs';

const P = (id, extra = {}) => ({ id, ...extra });
const NOW = '2026-07-30T12:00:00.000Z';

test('parseCookieHeader', async (t) => {
  await t.test('extracts li_at and JSESSIONID from a real-looking header', () => {
    const jar = parseCookieHeader(
      'bcookie="v=2&abc"; li_at=AQEDATdemo123; JSESSIONID="ajax:7788990011"; lang=v=2&lang=en-us',
    );
    assert.equal(jar.li_at, 'AQEDATdemo123');
    assert.equal(jar.JSESSIONID, '"ajax:7788990011"');
  });

  await t.test('ignores junk without a value', () => {
    assert.deepEqual(parseCookieHeader('novalue; =orphan; a=1'), { a: '1' });
  });

  await t.test('survives an empty or missing header', () => {
    assert.deepEqual(parseCookieHeader(''), {});
    assert.deepEqual(parseCookieHeader(undefined), {});
  });
});

test('csrfFromJsessionid strips the quotes voyager rejects', () => {
  assert.equal(csrfFromJsessionid('"ajax:7788990011"'), 'ajax:7788990011');
  // Already unquoted, and whitespace-padded, both pass through cleanly.
  assert.equal(csrfFromJsessionid('ajax:123'), 'ajax:123');
  assert.equal(csrfFromJsessionid(' "ajax:123" '), 'ajax:123');
});

test('textOf reads plain, wrapped and double-wrapped strings', () => {
  assert.equal(textOf('Ada'), 'Ada');
  assert.equal(textOf({ text: 'Ada' }), 'Ada');
  assert.equal(textOf({ text: { text: 'Ada' } }), 'Ada');
  assert.equal(textOf('  '), undefined);
  assert.equal(textOf(null), undefined);
  assert.equal(textOf(42), undefined);
});

test('collectProfiles', async (t) => {
  await t.test('finds people at any depth and merges richer records', () => {
    const payload = {
      data: { elements: [{ '*profile': 'urn:li:fsd_profile:1' }] },
      included: [
        { entityUrn: 'urn:li:fsd_profile:1', publicIdentifier: 'ada-lovelace', firstName: 'Ada' },
        {
          entityUrn: 'urn:li:fsd_profile:1b',
          publicIdentifier: 'ada-lovelace',
          firstName: { text: 'Ada' },
          lastName: { text: 'Lovelace' },
          headline: { text: 'Mathematician at Analytical Engines' },
        },
      ],
    };
    const people = collectProfiles(payload);
    assert.equal(people.length, 1);
    assert.deepEqual(people[0], {
      id: 'ada-lovelace',
      name: 'Ada Lovelace',
      headline: 'Mathematician at Analytical Engines',
      company: undefined,
      location: undefined,
    });
  });

  await t.test('ignores objects that only look person-shaped', () => {
    assert.deepEqual(collectProfiles({ publicIdentifier: '   ' }), []);
    assert.deepEqual(collectProfiles({ firstName: 'Ada' }), []);
    assert.deepEqual(collectProfiles(null), []);
  });

  await t.test('does not loop forever on a cyclic payload', () => {
    const node = { publicIdentifier: 'ada', firstName: 'Ada' };
    node.self = node;
    assert.equal(collectProfiles(node).length, 1);
  });
});

test('toPerson builds a name from either field shape', () => {
  assert.equal(toPerson({ publicIdentifier: 'x', firstName: 'A', lastName: 'B' }).name, 'A B');
  assert.equal(toPerson({ publicIdentifier: 'x', firstName: { text: 'A' } }).name, 'A');
  assert.equal(toPerson({ publicIdentifier: 'x' }).name, undefined);
});

test('indexByUrn maps every entity by its urn', () => {
  const map = indexByUrn({ included: [{ entityUrn: 'urn:a', v: 1 }, { entityUrn: 'urn:b' }] });
  assert.equal(map.size, 2);
  assert.equal(map.get('urn:a').v, 1);
});

test('viewTimeOf', async (t) => {
  await t.test('accepts epoch milliseconds', () => {
    assert.equal(viewTimeOf({ viewedAt: 1753876800000 }), new Date(1753876800000).toISOString());
  });

  await t.test('accepts epoch seconds', () => {
    assert.equal(viewTimeOf({ lastViewedAt: 1753876800 }), new Date(1753876800000).toISOString());
  });

  await t.test('rejects numbers that are plainly not dates', () => {
    // A count, an id, and a far-future value must not masquerade as a timestamp.
    assert.equal(viewTimeOf({ viewedAt: 42 }), null);
    assert.equal(viewTimeOf({ time: 99999999999999 }), null);
    assert.equal(viewTimeOf({ viewedAt: 'yesterday' }), null);
    assert.equal(viewTimeOf({}), null);
  });
});

test('extractViewers', async (t) => {
  await t.test('resolves a named viewer referenced by urn', () => {
    const payload = {
      data: {
        elements: [{ viewedAt: 1753876800000, '*viewerProfile': 'urn:li:fsd_profile:9' }],
      },
      included: [
        {
          entityUrn: 'urn:li:fsd_profile:9',
          publicIdentifier: 'grace-hopper',
          firstName: 'Grace',
          lastName: 'Hopper',
          headline: 'Rear Admiral',
        },
      ],
    };
    const views = extractViewers(payload);
    assert.equal(views.length, 1);
    assert.equal(views[0].id, 'grace-hopper');
    assert.equal(views[0].name, 'Grace Hopper');
    assert.equal(views[0].anonymous, undefined);
  });

  await t.test('describes an obfuscated viewer instead of dropping them', () => {
    const views = extractViewers({
      elements: [
        {
          viewedAt: 1753876800000,
          viewerObfuscationType: 'FULL_COMPANY',
          companyName: 'Northwind Robotics',
        },
      ],
    });
    assert.equal(views.length, 1);
    assert.equal(views[0].anonymous, true);
    assert.equal(views[0].label, 'Someone at Northwind Robotics');
    assert.equal(views[0].id, undefined);
  });

  await t.test('reads the degree of separation when present', () => {
    const views = extractViewers({
      elements: [
        {
          viewedAt: 1753876800000,
          distance: { value: 'DISTANCE_2' },
          publicIdentifier: 'ada',
          firstName: 'Ada',
        },
      ],
    });
    assert.equal(views[0].degree, 2);
  });

  await t.test('collapses the same record reached by two paths', () => {
    const record = { viewedAt: 1753876800000, publicIdentifier: 'ada', firstName: 'Ada' };
    const views = extractViewers({ a: { list: [record] }, b: { alsoList: [{ ...record }] } });
    assert.equal(views.length, 1);
  });

  await t.test('returns nothing for a payload with no view records', () => {
    assert.deepEqual(extractViewers({ elements: [] }), []);
    assert.deepEqual(extractViewers(null), []);
    // A timestamp with neither a person nor a description is not a view.
    assert.deepEqual(extractViewers({ elements: [{ viewedAt: 1753876800000 }] }), []);
  });
});

test('extractCounts pulls the rolling figures out of any shape', () => {
  const counts = extractCounts({ a: { numViews: 84 }, b: { numSearchAppearances: 19 } });
  assert.deepEqual(counts, { views: 84, searchAppearances: 19 });
  assert.deepEqual(extractCounts(null), {});
});

test('firstNumber finds a matching numeric field anywhere', () => {
  assert.equal(firstNumber({ x: { followersCount: 512 } }, /^followersCount$/i), 512);
  assert.equal(firstNumber({ followersCount: 'lots' }, /^followersCount$/i), null);
  assert.equal(firstNumber(null, /^anything$/), null);
});

test('mergeSince', async (t) => {
  await t.test('keeps an existing date and stamps genuinely new people', () => {
    const merged = mergeSince(
      [P('ada'), P('grace')],
      [{ id: 'ada', since: '2024-01-05T00:00:00.000Z' }],
      NOW,
      false,
    );
    assert.equal(merged[0].since, '2024-01-05T00:00:00.000Z');
    assert.equal(merged[1].since, NOW);
  });

  await t.test('leaves everyone undated on the first real run', () => {
    // Otherwise the entire back catalogue would claim to have connected today.
    const merged = mergeSince([P('ada'), P('grace')], null, NOW, true);
    assert.deepEqual(merged.map((p) => p.since), [undefined, undefined]);
  });

  await t.test('matches case-insensitively', () => {
    const merged = mergeSince([P('Ada')], [{ id: 'ada', since: '2020-01-01T00:00:00.000Z' }], NOW, false);
    assert.equal(merged[0].since, '2020-01-01T00:00:00.000Z');
  });
});

test('diffConnections', async (t) => {
  await t.test('reports both directions of change', () => {
    const { gained, lost } = diffConnections(
      [P('ada', { name: 'Ada' }), P('grace')],
      [P('grace'), P('alan', { name: 'Alan' })],
      NOW,
    );
    assert.deepEqual(gained.map((e) => e.id), ['ada']);
    assert.equal(gained[0].kind, 'connect');
    assert.equal(gained[0].name, 'Ada');
    assert.deepEqual(lost.map((e) => e.id), ['alan']);
    assert.equal(lost[0].kind, 'disconnect');
  });

  await t.test('an unchanged set produces no events', () => {
    const { gained, lost } = diffConnections([P('ada')], [P('ada')], NOW);
    assert.equal(gained.length + lost.length, 0);
  });
});

test('stableList', async (t) => {
  await t.test('a read that misses someone does not delete them', () => {
    // This is the whole point: paging is eventually consistent, and rebuilding
    // the list from each read turns a dropped page into a phantom disconnect.
    const next = stableList([P('ada'), P('grace')], [P('ada')], new Set());
    assert.deepEqual(next.map((p) => p.id), ['ada', 'grace']);
  });

  await t.test('only a confirmed disconnect removes anyone', () => {
    const next = stableList([P('ada'), P('grace')], [P('ada')], new Set(['grace']));
    assert.deepEqual(next.map((p) => p.id), ['ada']);
  });

  await t.test('fresh fields win but the earliest date is kept', () => {
    const next = stableList(
      [P('ada', { headline: 'old', since: '2020-01-01T00:00:00.000Z' })],
      [P('ada', { headline: 'new', since: NOW })],
      new Set(),
    );
    assert.equal(next[0].headline, 'new');
    assert.equal(next[0].since, '2020-01-01T00:00:00.000Z');
  });
});

test('appendSnapshot keeps one point per calendar day', () => {
  const first = appendSnapshot([], { t: '2026-07-30T09:00:00.000Z', connections: 10 });
  const second = appendSnapshot(first, { t: '2026-07-30T18:00:00.000Z', connections: 12 });
  assert.equal(second.length, 1);
  assert.equal(second[0].connections, 12);

  const nextDay = appendSnapshot(second, { t: '2026-07-31T09:00:00.000Z', connections: 13 });
  assert.equal(nextDay.length, 2);
  assert.deepEqual(nextDay.map((s) => s.connections), [12, 13]);
});

test('mergeViews', async (t) => {
  const view = (extra) => ({ t: '2026-07-30T10:00:00.000Z', ...extra });

  await t.test('adds genuinely new views', () => {
    const { views, added } = mergeViews([], [view({ id: 'ada' }), view({ id: 'grace' })], NOW);
    assert.equal(added, 2);
    assert.equal(views.length, 2);
    assert.equal(views[0].seen, NOW);
  });

  await t.test('re-seeing the same visit does not double-count it', () => {
    // The same viewer keeps appearing in LinkedIn's window for days, and some
    // surfaces return a coarse timestamp that drifts as it ages — so the same
    // visit must collapse rather than being re-recorded on every run.
    const first = mergeViews([], [view({ id: 'ada' })], NOW);
    const again = mergeViews(first.views, [view({ id: 'ada', t: '2026-07-30T15:22:00.000Z' })], NOW);
    assert.equal(again.added, 0);
    assert.equal(again.views.length, 1);
    // The earliest timestamp wins.
    assert.equal(again.views[0].t, '2026-07-30T10:00:00.000Z');
  });

  await t.test('the same person on a different day is a separate visit', () => {
    const first = mergeViews([], [view({ id: 'ada' })], NOW);
    const next = mergeViews(first.views, [view({ id: 'ada', t: '2026-07-31T10:00:00.000Z' })], NOW);
    assert.equal(next.added, 1);
    assert.equal(next.views.length, 2);
  });

  await t.test('refreshes details but keeps the original first-seen stamp', () => {
    const first = mergeViews([], [view({ id: 'ada', company: 'Old Co' })], '2026-07-30T00:00:00.000Z');
    const next = mergeViews(first.views, [view({ id: 'ada', company: 'New Co' })], NOW);
    assert.equal(next.views[0].company, 'New Co');
    assert.equal(next.views[0].seen, '2026-07-30T00:00:00.000Z');
  });

  await t.test('anonymous viewers are keyed by their description', () => {
    const { added } = mergeViews(
      [],
      [
        view({ anonymous: true, label: 'Someone at Acme' }),
        view({ anonymous: true, label: 'Someone at Acme' }),
        view({ anonymous: true, label: 'Someone at Globex' }),
      ],
      NOW,
    );
    assert.equal(added, 2);
  });

  await t.test('returns newest first', () => {
    const { views } = mergeViews(
      [],
      [view({ id: 'ada', t: '2026-07-28T10:00:00.000Z' }), view({ id: 'grace' })],
      NOW,
    );
    assert.deepEqual(views.map((v) => v.id), ['grace', 'ada']);
  });
});

test('redactViews strips every route back to a named person', () => {
  const out = redactViews([
    { t: NOW, id: 'ada-lovelace', name: 'Ada Lovelace', headline: 'Mathematician', company: 'Acme', degree: 2 },
  ]);
  assert.equal(out[0].id, undefined);
  assert.equal(out[0].name, undefined);
  assert.equal(out[0].headline, undefined);
  assert.equal(out[0].anonymous, true);
  assert.equal(out[0].label, 'Someone at Acme');
  // The analytically useful shape survives.
  assert.equal(out[0].company, 'Acme');
  assert.equal(out[0].degree, 2);
  assert.equal(out[0].t, NOW);
});

test('redactViews falls back when there is no company', () => {
  assert.equal(redactViews([{ t: NOW, id: 'ada', name: 'Ada' }])[0].label, 'Someone on LinkedIn');
  assert.equal(
    redactViews([{ t: NOW, anonymous: true, label: 'Someone in Recruiting' }])[0].label,
    'Someone in Recruiting',
  );
});

test('checkCompleteness', async (t) => {
  const many = (n) => Array.from({ length: n }, (_, i) => P('p' + i));

  await t.test('flags a read well short of the reported total', () => {
    assert.match(checkCompleteness(many(50), 400, null), /paged 50 connections/);
  });

  await t.test('passes a read within the tolerance', () => {
    assert.equal(checkCompleteness(many(95), 100, null), null);
  });

  await t.test('flags a halving against the previous run', () => {
    const prev = { connections: many(200) };
    assert.match(checkCompleteness(many(80), null, prev), /halved/);
  });

  await t.test('ignores sample data as a baseline', () => {
    assert.equal(checkCompleteness(many(30), null, { sample: true, connections: many(500) }), null);
  });

  await t.test('does not fire on a genuinely tiny network', () => {
    assert.equal(checkCompleteness(many(5), null, { connections: many(15) }), null);
  });
});

test('alreadySucceededToday', async (t) => {
  const now = new Date('2026-07-30T20:00:00');

  await t.test('true once a real run has landed today', () => {
    assert.equal(
      alreadySucceededToday({ generatedAt: new Date('2026-07-30T09:41:00').toISOString() }, now),
      true,
    );
  });

  await t.test('false for yesterday, sample data, or nothing at all', () => {
    assert.equal(
      alreadySucceededToday({ generatedAt: new Date('2026-07-29T09:41:00').toISOString() }, now),
      false,
    );
    assert.equal(alreadySucceededToday({ sample: true, generatedAt: now.toISOString() }, now), false);
    assert.equal(alreadySucceededToday(null, now), false);
    assert.equal(alreadySucceededToday({ generatedAt: 'not a date' }, now), false);
  });
});

test('localDay uses local time, not UTC', () => {
  // Late-evening local time is already tomorrow in UTC for anyone west of it;
  // the tracker's "today" must follow the user, not the clock in Greenwich.
  const d = new Date(2026, 6, 30, 23, 30);
  assert.equal(localDay(d), '2026-07-30');
});
