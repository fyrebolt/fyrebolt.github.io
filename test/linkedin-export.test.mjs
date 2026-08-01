// Tests for parsing LinkedIn's official data export.
//
// The fixtures below mirror the real files: Connections.csv opens with a quoted
// "Notes:" paragraph before the header, headlines contain commas, and the email
// column is present for some people and blank for others. Inventing a tidier
// shape here would let the tidy version pass while the real export failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  parseExportDate,
  publicIdFromUrl,
  readConnections,
  readFollowers,
  readProfile,
  toRecords,
} from '../src/linkedin/csv.ts';

const CONNECTIONS_CSV = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Lovelace,https://www.linkedin.com/in/ada-lovelace,ada@example.com,Analytical Engines,"Mathematician, Lead",24 Jul 2023
Grace,Hopper,https://www.linkedin.com/in/grace-hopper-1a2b/,,US Navy,Rear Admiral,3 Feb 2021
Alan,Turing,,,Bletchley Park,Cryptanalyst,15 Dec 2019
`;

const FOLLOWERS_CSV = `Notes:
"Followers are people who follow your posts."

Fullname,Followed On
Katherine Johnson,7/24/23, 3:14 PM
Mary Jackson,11/2/2022, 9:01 AM
`;

const PROFILE_CSV = `First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers,Profile URL
Hastin,Chen,,,,Building things,,Software,,"Los Angeles, CA",,,,https://www.linkedin.com/in/hastinchen
`;

test('parseCsv', async (t) => {
  await t.test('keeps commas that live inside a quoted field', () => {
    const rows = parseCsv('a,"b,c",d\n');
    assert.deepEqual(rows, [['a', 'b,c', 'd']]);
  });

  await t.test('unescapes a doubled quote', () => {
    assert.deepEqual(parseCsv('a,"say ""hi""",b\n'), [['a', 'say "hi"', 'b']]);
  });

  await t.test('keeps a newline inside a quoted field', () => {
    // LinkedIn's own preamble is exactly this shape.
    assert.deepEqual(parseCsv('a,"line1\nline2"\n'), [['a', 'line1\nline2']]);
  });

  await t.test('strips a UTF-8 BOM off the first header', () => {
    assert.equal(parseCsv('﻿First Name,Last Name\n')[0][0], 'First Name');
  });

  await t.test('tolerates CRLF and a missing trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\r\nc,d'), [
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

test('toRecords finds the header past LinkedIn’s preamble', () => {
  const records = toRecords(parseCsv(CONNECTIONS_CSV), /^(first name|connected on)$/i);
  assert.equal(records.length, 3);
  assert.equal(records[0]['first name'], 'Ada');
  assert.equal(records[0].position, 'Mathematician, Lead');
});

test('toRecords returns nothing when the marker never appears', () => {
  assert.deepEqual(toRecords(parseCsv('x,y\n1,2\n'), /^first name$/i), []);
});

test('publicIdFromUrl', async (t) => {
  await t.test('reads the slug with or without a trailing slash', () => {
    assert.equal(publicIdFromUrl('https://www.linkedin.com/in/ada-lovelace'), 'ada-lovelace');
    assert.equal(publicIdFromUrl('https://www.linkedin.com/in/grace-hopper-1a2b/'), 'grace-hopper-1a2b');
  });

  await t.test('ignores query strings and decodes escapes', () => {
    assert.equal(publicIdFromUrl('https://linkedin.com/in/ada?trk=abc'), 'ada');
    assert.equal(publicIdFromUrl('https://linkedin.com/in/josé%2Dgarcia'), 'josé-garcia');
  });

  await t.test('returns null for anything that isn’t a profile URL', () => {
    assert.equal(publicIdFromUrl(''), null);
    assert.equal(publicIdFromUrl('https://example.com/in/ada'), null);
    assert.equal(publicIdFromUrl('https://www.linkedin.com/company/acme'), null);
  });
});

test('parseExportDate', async (t) => {
  const day = (iso) => new Date(iso).toLocaleDateString('en-CA');

  await t.test('reads the "24 Jul 2023" form the export usually uses', () => {
    assert.equal(day(parseExportDate('24 Jul 2023')), '2023-07-24');
    assert.equal(day(parseExportDate('3 February 2021')), '2021-02-03');
  });

  await t.test('reads the slash form, with a two- or four-digit year', () => {
    assert.equal(day(parseExportDate('7/24/23, 3:14 PM')), '2023-07-24');
    assert.equal(day(parseExportDate('11/2/2022')), '2022-11-02');
  });

  await t.test('lands at midday, so serialising can’t shift the day', () => {
    // Midnight local would become the previous day in ISO for anyone west of
    // UTC — which is how a connection made on the 1st gets filed under the 31st.
    const d = new Date(parseExportDate('24 Jul 2023'));
    assert.equal(d.getHours(), 12);
    assert.equal(day(d.toISOString()), '2023-07-24');
  });

  await t.test('returns undefined rather than a wrong date', () => {
    assert.equal(parseExportDate(''), undefined);
    assert.equal(parseExportDate('   '), undefined);
    assert.equal(parseExportDate('sometime last year'), undefined);
    assert.equal(parseExportDate('24 Xyz 2023'), undefined);
  });
});

test('readConnections', async (t) => {
  const people = readConnections({ 'Connections.csv': CONNECTIONS_CSV });

  await t.test('reads every row', () => {
    assert.equal(people.length, 3);
  });

  await t.test('keys on the profile slug and keeps the headline', () => {
    assert.equal(people[0].id, 'ada-lovelace');
    assert.equal(people[0].name, 'Ada Lovelace');
    assert.equal(people[0].headline, 'Mathematician, Lead');
    assert.equal(people[0].company, 'Analytical Engines');
  });

  await t.test('never carries an email address into the data model', () => {
    // This file gets committed to a public repo; nobody consented to that.
    const serialised = JSON.stringify(people);
    assert.equal(serialised.includes('ada@example.com'), false);
    assert.equal(serialised.includes('@'), false);
    for (const p of people) assert.equal('email' in p, false);
  });

  await t.test('falls back to a name key when there is no profile URL', () => {
    assert.equal(people[2].id, 'name:alan turing');
    assert.equal(people[2].name, 'Alan Turing');
  });

  await t.test('carries the real connection date through', () => {
    assert.equal(new Date(people[1].since).toLocaleDateString('en-CA'), '2021-02-03');
  });

  await t.test('de-duplicates repeated rows', () => {
    const dupes = CONNECTIONS_CSV + 'Ada,Lovelace,https://www.linkedin.com/in/ada-lovelace,,X,Y,1 Jan 2024\n';
    assert.equal(readConnections({ 'Connections.csv': dupes }).length, 3);
  });

  await t.test('returns nothing when the file is absent', () => {
    assert.deepEqual(readConnections({ 'Followers.csv': FOLLOWERS_CSV }), []);
  });
});

test('readFollowers', async (t) => {
  const people = readFollowers({ 'Followers.csv': FOLLOWERS_CSV });

  await t.test('reads names and dates from the thinner file', () => {
    assert.equal(people.length, 2);
    assert.equal(people[0].name, 'Katherine Johnson');
    assert.equal(new Date(people[0].since).toLocaleDateString('en-CA'), '2023-07-24');
  });

  await t.test('keys followers by name, since the export gives no URL', () => {
    assert.equal(people[0].id, 'name:katherine johnson');
  });
});

test('readProfile picks up your own slug and name', () => {
  const me = readProfile({ 'Profile.csv': PROFILE_CSV });
  assert.deepEqual(me, { profile: 'hastinchen', name: 'Hastin Chen' });
});

test('readProfile returns null when the file is absent', () => {
  assert.equal(readProfile({ 'Connections.csv': CONNECTIONS_CSV }), null);
});
