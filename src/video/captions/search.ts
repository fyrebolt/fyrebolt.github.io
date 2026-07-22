// ===== Caption text find & replace (project-scoped) =====
//
// Pure string helpers shared by the Find & Replace panel (match listing +
// navigation) and the editor (the actual text mutations). All matching is plain
// substring matching — non-overlapping, with an optional case-sensitivity flag.
// The editor owns undo grouping, so these helpers never touch project state.

/** One match: which caption holds it, and the char offset of the occurrence. */
export interface CaptionMatch {
  /** Layer id of the caption/typewriter element. */
  layerId: string;
  /** Character index of the occurrence within that element's text. */
  at: number;
}

/** A caption's searchable text + a short label (for the panel's match list). */
export interface CaptionText {
  id: string;
  text: string;
  label: string;
}

/**
 * Every occurrence of `search` across `captions`, in list order (so next/prev
 * navigation is stable). Non-overlapping. Empty when `search` is empty.
 */
export function findCaptionMatches(
  captions: CaptionText[],
  search: string,
  caseSensitive: boolean,
): CaptionMatch[] {
  const out: CaptionMatch[] = [];
  if (!search) return out;
  const needle = caseSensitive ? search : search.toLowerCase();
  for (const c of captions) {
    const hay = caseSensitive ? c.text : c.text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push({ layerId: c.id, at: i });
      i = hay.indexOf(needle, i + needle.length); // non-overlapping
    }
  }
  return out;
}

/**
 * Replace every occurrence of `search` in `text` with `replacement`. Scans left
 * to right, advancing past each replacement so inserted text is never re-matched
 * (safe even when `replacement` contains `search`). Returns the new text + count.
 */
export function replaceAllInText(
  text: string,
  search: string,
  replacement: string,
  caseSensitive: boolean,
): { text: string; n: number } {
  if (!search) return { text, n: 0 };
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? search : search.toLowerCase();
  let out = '';
  let i = 0;
  let n = 0;
  while (i <= text.length) {
    const j = hay.indexOf(needle, i);
    if (j === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, j) + replacement;
    i = j + needle.length;
    n += 1;
  }
  return n === 0 ? { text, n: 0 } : { text: out, n };
}

/**
 * Replace the single occurrence at `at`, but only if the text there still
 * matches `search` (guards against a stale index after edits). Returns the new
 * text, or null when the guard fails.
 */
export function replaceOneAt(
  text: string,
  at: number,
  search: string,
  replacement: string,
  caseSensitive: boolean,
): string | null {
  if (!search || at < 0 || at + search.length > text.length) return null;
  const seg = text.substr(at, search.length);
  const ok = caseSensitive ? seg === search : seg.toLowerCase() === search.toLowerCase();
  if (!ok) return null;
  return text.slice(0, at) + replacement + text.slice(at + search.length);
}
