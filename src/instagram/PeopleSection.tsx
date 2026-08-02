// ===== People browser =====
//
// The five ways to slice the follow graph, with search, sort, and a windowed
// list so a few thousand rows scroll as smoothly as a dozen.

import { useMemo, useState } from 'react';
import { Segmented } from '../ios';
import {
  monthYear,
  relationships,
  searchProfiles,
  sortProfiles,
  type ListKind,
  type Profile,
  type SortKey,
} from './data';
import Avatar from './Avatar';

const TABS: Array<{ kind: ListKind; label: string; tone: string }> = [
  { kind: 'followers', label: 'Followers', tone: 'blue' },
  { kind: 'following', label: 'Following', tone: 'violet' },
  { kind: 'mutuals', label: 'Mutuals', tone: 'green' },
  { kind: 'fans', label: 'You don’t follow back', tone: 'amber' },
  { kind: 'ghosts', label: 'Don’t follow you back', tone: 'pink' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

const HINTS: Record<ListKind, string> = {
  followers: 'Everyone who follows you.',
  following: 'Everyone you follow.',
  mutuals: 'You follow each other.',
  fans: 'They follow you and you haven’t followed back.',
  ghosts: 'You follow them and they haven’t followed back.',
};

export default function PeopleSection({
  followers,
  following,
  onOpen,
}: {
  followers: Profile[];
  following: Profile[];
  onOpen: (username: string) => void;
}) {
  const [kind, setKind] = useState<ListKind>('followers');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  const sets = useMemo(() => relationships(followers, following), [followers, following]);
  const mutualKeys = useMemo(
    () => new Set(sets.mutuals.map((p) => p.username.toLowerCase())),
    [sets.mutuals],
  );

  const rows = useMemo(
    () => sortProfiles(searchProfiles(sets[kind], query), sort),
    [sets, kind, query, sort],
  );

  if (followers.length === 0 && following.length === 0) {
    return (
      <section className="ig-people">
        <h2 className="ig-section-title">People</h2>
        <div className="ig-placeholder small">
          The follower and following lists appear here after the first daily pull, or as soon as you
          import a data export.
        </div>
      </section>
    );
  }

  const total = followers.length + following.length;

  return (
    <section className="ig-people">
      <div className="ig-people-head">
        <h2 className="ig-section-title">People</h2>
        <span className="ig-people-sub">{HINTS[kind]}</span>
      </div>

      <ReciprocityBar
        mutuals={sets.mutuals.length}
        fans={sets.fans.length}
        ghosts={sets.ghosts.length}
      />

      <div className="ig-tabs" role="tablist" aria-label="Relationship lists">
        {TABS.map((t) => (
          <button
            key={t.kind}
            role="tab"
            aria-selected={t.kind === kind}
            className={`ig-tab tone-${t.tone} ${t.kind === kind ? 'is-active' : ''}`}
            onClick={() => {
              setKind(t.kind);
              setQuery('');
            }}
          >
            <span className="ig-tab-count">{sets[t.kind].length.toLocaleString()}</span>
            <span className="ig-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="ig-people-controls">
        <div className="ig-search">
          <svg
            className="ig-search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="ios-input ig-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or @username"
            aria-label="Search people"
          />
        </div>
        <Segmented options={SORT_OPTIONS} value={sort} onChange={setSort} className="ig-sort" />
      </div>

      {rows.length === 0 ? (
        <p className="ig-empty">
          {query ? `Nobody in this list matches “${query}”.` : 'This list is empty. 🎉'}
        </p>
      ) : (
        // Keyed on the query so switching tab / search / sort remounts the
        // scroller, which puts you back at the top of the new list.
        <VirtualList
          key={`${kind}|${query}|${sort}`}
          rows={rows}
          mutualKeys={mutualKeys}
          kind={kind}
          onOpen={onOpen}
        />
      )}

      <p className="ig-people-foot">
        {rows.length.toLocaleString()} shown
        {query ? ` of ${sets[kind].length.toLocaleString()}` : ''} · {total.toLocaleString()}{' '}
        relationships tracked
      </p>
    </section>
  );
}

/** Proportional split of the follow graph into mutual / one-way-in / one-way-out. */
function ReciprocityBar({
  mutuals,
  fans,
  ghosts,
}: {
  mutuals: number;
  fans: number;
  ghosts: number;
}) {
  const total = mutuals + fans + ghosts;
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const mutualRate = Math.round((mutuals / total) * 100);

  return (
    <div className="ig-recip">
      <div className="ig-recip-bar" role="img" aria-label={`${mutualRate}% mutual`}>
        <span className="seg mutual" style={{ width: pct(mutuals) }} />
        <span className="seg fans" style={{ width: pct(fans) }} />
        <span className="seg ghosts" style={{ width: pct(ghosts) }} />
      </div>
      <div className="ig-recip-legend">
        <Legend tone="mutual" label="Mutual" value={mutuals} />
        <Legend tone="fans" label="One-way in" value={fans} />
        <Legend tone="ghosts" label="One-way out" value={ghosts} />
        <span className="ig-recip-rate">{mutualRate}% mutual</span>
      </div>
    </div>
  );
}

function Legend({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <span className="ig-legend">
      <span className={`dot ${tone}`} aria-hidden />
      {label} <strong>{value.toLocaleString()}</strong>
    </span>
  );
}

const ROW_H = 58;
const VIEWPORT_H = 464;
const OVERSCAN = 5;

/**
 * Windowed list — only the visible slice is in the DOM, so a few thousand rows
 * scroll as smoothly as a dozen. Rows are a fixed height by design.
 */
function VirtualList({
  rows,
  mutualKeys,
  kind,
  onOpen,
}: {
  rows: Profile[];
  mutualKeys: Set<string>;
  kind: ListKind;
  onOpen: (username: string) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visible = Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2;
  const slice = rows.slice(first, first + visible);

  return (
    <div
      className="ig-people-scroll"
      style={{ height: Math.min(VIEWPORT_H, rows.length * ROW_H) }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="ig-people-spacer" style={{ height: rows.length * ROW_H }}>
        <ul className="ig-people-list" style={{ transform: `translateY(${first * ROW_H}px)` }}>
          {slice.map((p) => (
            <PersonRow
              key={p.username}
              person={p}
              kind={kind}
              mutual={mutualKeys.has(p.username.toLowerCase())}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function PersonRow({
  person,
  kind,
  mutual,
  onOpen,
}: {
  person: Profile;
  kind: ListKind;
  mutual: boolean;
  onOpen: (username: string) => void;
}) {
  const since = monthYear(person.since);
  // In the mutuals tab the badge would be on every row, so it earns nothing.
  const showMutual = mutual && kind !== 'mutuals';

  return (
    <li className="ig-person" style={{ height: ROW_H }}>
      <button
        className="ig-person-open"
        onClick={() => onOpen(person.username)}
        aria-label={`Details for @${person.username}`}
      />
      <Avatar username={person.username} />
      <span className="ig-person-text">
        <span className="ig-person-top">
          <span className="ig-person-name">{person.name || person.username}</span>
          {person.verified && (
            <svg className="ig-verified" viewBox="0 0 24 24" aria-label="Verified" role="img">
              <path
                d="M12 2l2.4 1.8 3-.2 1 2.8 2.4 1.8-1 2.8 1 2.8-2.4 1.8-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8L3.2 15.8l1-2.8-1-2.8L5.6 8.4l1-2.8 3 .2z"
                fill="currentColor"
              />
              <path
                d="M8.5 12.2l2.2 2.2 4.6-4.6"
                stroke="#fff"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {person.private && <span className="ig-chip-mini">private</span>}
        </span>
        <span className="ig-person-handle">@{person.username}</span>
      </span>
      {showMutual && <span className="ig-person-badge mutual">mutual</span>}
      {since && <span className="ig-person-since">{since}</span>}
    </li>
  );
}
