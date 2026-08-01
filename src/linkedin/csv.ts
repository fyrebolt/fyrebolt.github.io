// ===== LinkedIn export parsing (pure, no dependencies) =====
//
// Split out from importExport.ts so it can be unit-tested directly: this module
// imports nothing but a type, which means `node --test` can load it as-is while
// the ZIP handling next door needs a bundler for fflate.

import type { Person } from './data';

const CONNECTIONS_RE = /^connections\.csv$/i;
const FOLLOWERS_RE = /^followers\.csv$/i;
const PROFILE_RE = /^profile\.csv$/i;

/**
 * Minimal RFC-4180 reader: quoted fields, embedded commas, doubled quotes,
 * and newlines inside quotes. LinkedIn quotes headlines liberally and they
 * routinely contain commas, so none of this is optional.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Strip a UTF-8 BOM — Excel-friendly exports carry one and it would otherwise
  // become part of the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Turn CSV rows into objects, skipping LinkedIn's preamble.
 *
 * Connections.csv opens with a "Notes:" paragraph and a blank line before the
 * real header, so the header can't be assumed to be row 0 — it's found by
 * looking for the row that contains an expected column name.
 */
export function toRecords(rows: string[][], marker: RegExp): Array<Record<string, string>> {
  const headerIdx = rows.findIndex((r) => r.some((c) => marker.test(c.trim())));
  if (headerIdx < 0) return [];
  const header = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const out: Array<Record<string, string>> = [];
  for (const row of rows.slice(headerIdx + 1)) {
    if (row.every((c) => c.trim() === '')) continue;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = (row[i] ?? '').trim();
    });
    out.push(rec);
  }
  return out;
}

/**
 * The public id out of a profile URL.
 *
 * Handles the trailing slash, query strings, and percent-encoded slugs.
 */
export function publicIdFromUrl(url: string): string | null {
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(url ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Parse the several date shapes LinkedIn exports use.
 *
 * Seen in the wild: "24 Jul 2023" (most common), "7/24/23, 3:14 PM" in
 * Followers.csv, and plain ISO. Anything unrecognised returns undefined rather
 * than a wrong date — an undated connection is honest, a misdated one isn't.
 */
export function parseExportDate(value: string): string | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;

  // "24 Jul 2023"
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(raw);
  if (dmy) {
    const month = MONTHS.indexOf(dmy[2].slice(0, 3).toLowerCase());
    if (month >= 0) return isoAtNoon(Number(dmy[3]), month, Number(dmy[1]));
  }

  // "7/24/23" or "07/24/2023", optionally followed by a time we don't need.
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(raw);
  if (mdy) {
    const year = Number(mdy[3]) < 100 ? 2000 + Number(mdy[3]) : Number(mdy[3]);
    return isoAtNoon(year, Number(mdy[1]) - 1, Number(mdy[2]));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Midday local time. The export gives a date with no time, and midnight would
 * land on the previous day for anyone west of UTC once it's serialised — which
 * is how a connection made on the 1st ends up filed under the 31st.
 */
function isoAtNoon(year: number, monthIdx: number, day: number): string {
  return new Date(year, monthIdx, day, 12, 0, 0).toISOString();
}

function fullName(first: string, last: string): string | undefined {
  const name = `${first ?? ''} ${last ?? ''}`.trim();
  return name || undefined;
}

/**
 * Connections.csv → people.
 *
 * The email column is dropped on the floor and never enters the data model.
 * LinkedIn includes it for connections who allow it, this file gets committed
 * to a public repo, and nobody consented to that.
 */
export function readConnections(texts: Record<string, string>): Person[] {
  const file = Object.entries(texts).find(([name]) => CONNECTIONS_RE.test(name));
  if (!file) return [];

  const records = toRecords(parseCsv(file[1]), /^(first name|connected on)$/i);
  const out: Person[] = [];
  const seen = new Set<string>();

  for (const rec of records) {
    const id = publicIdFromUrl(rec.url ?? '');
    const name = fullName(rec['first name'], rec['last name']);
    // No URL means a connection whose profile LinkedIn wouldn't name (a closed
    // account, usually). Keyed on the name so they still count, still sort, and
    // still show — just without a link.
    const key = id ?? (name ? `name:${name.toLowerCase()}` : '');
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());

    out.push({
      id: key,
      name,
      headline: rec.position || undefined,
      company: rec.company || undefined,
      since: parseExportDate(rec['connected on']),
    });
  }
  return out;
}

/**
 * Followers.csv → people.
 *
 * This file is thinner than Connections.csv: recent exports carry only a name
 * and a date, with no profile URL, so followers are keyed by name and can't be
 * linked. They still count, and the daily pull fills in real ids for anyone it
 * can resolve.
 */
export function readFollowers(texts: Record<string, string>): Person[] {
  const file = Object.entries(texts).find(([name]) => FOLLOWERS_RE.test(name));
  if (!file) return [];

  const records = toRecords(parseCsv(file[1]), /^(fullname|full name|followed on)$/i);
  const out: Person[] = [];
  const seen = new Set<string>();

  for (const rec of records) {
    const name =
      rec.fullname || rec['full name'] || fullName(rec['first name'], rec['last name']) || '';
    const id = publicIdFromUrl(rec.url ?? '') ?? (name ? `name:${name.toLowerCase()}` : '');
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());

    out.push({
      id,
      name: name || undefined,
      since: parseExportDate(rec['followed on'] ?? ''),
    });
  }
  return out;
}

/** Profile.csv → your own public id and name, so the header can fill itself in. */
export function readProfile(
  texts: Record<string, string>,
): { profile?: string; name?: string } | null {
  const file = Object.entries(texts).find(([name]) => PROFILE_RE.test(name));
  if (!file) return null;
  const rec = toRecords(parseCsv(file[1]), /^(first name|maiden name)$/i)[0];
  if (!rec) return null;
  return {
    profile: publicIdFromUrl(rec['profile url'] ?? '') ?? undefined,
    name: fullName(rec['first name'], rec['last name']),
  };
}
