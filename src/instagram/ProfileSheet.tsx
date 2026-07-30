import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildRanks,
  exactDate,
  insightFor,
  type Insight,
  type TrackerData,
} from './data';
import { fetchAvatar, fetchProfileInfo, loadToken, probeAgent, type LiveProfile } from './agent';

/**
 * Profile popup.
 *
 * Two tiers of information, deliberately kept distinct:
 *  • what the tracker knows — dates, positions, recorded events. Always present,
 *    works on any device, and is the part nothing else can tell you.
 *  • what Instagram knows right now — picture, bio, counts. Fetched through the
 *    local agent, so it appears only on the machine running it.
 */
export default function ProfileSheet({
  username,
  data,
  onClose,
}: {
  username: string;
  data: TrackerData;
  onClose: () => void;
}) {
  const followerRanks = useMemo(() => buildRanks(data.followers ?? []), [data.followers]);
  const followingRanks = useMemo(() => buildRanks(data.following ?? []), [data.following]);
  const insight = useMemo(
    () => insightFor(username, data, followerRanks, followingRanks),
    [username, data, followerRanks, followingRanks],
  );

  const [live, setLive] = useState<LiveProfile | null>(null);
  const [liveState, setLiveState] = useState<'loading' | 'done' | 'unavailable'>('loading');
  const [avatar, setAvatar] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape to dismiss, and move focus into the dialog for keyboard users.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    // No state resets here: the sheet is keyed on username by its parent, so a
    // different profile remounts with fresh initial state.
    let alive = true;
    let objectUrl: string | null = null;

    (async () => {
      const token = loadToken();
      if (!token || !(await probeAgent())) {
        if (alive) setLiveState('unavailable');
        return;
      }
      const info = await fetchProfileInfo(token, username);
      if (!alive) return;
      setLive(info);
      setLiveState(info ? 'done' : 'unavailable');
      if (info?.pic) {
        const blob = await fetchAvatar(token, info.pic);
        if (!alive) {
          if (blob) URL.revokeObjectURL(blob);
          return;
        }
        objectUrl = blob;
        setAvatar(blob);
      }
    })();

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [username]);

  const displayName = live?.fullName || insight.name;

  return (
    <div className="ig-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="ig-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Profile: @${insight.username}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} className="ig-sheet-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <header className="ig-sheet-head">
          <SheetAvatar username={insight.username} src={avatar} />
          <div className="ig-sheet-id">
            {displayName && <span className="ig-sheet-name">{displayName}</span>}
            <a
              className="ig-sheet-handle"
              href={`https://instagram.com/${insight.username}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{insight.username}
            </a>
            <span className="ig-sheet-badges">
              {(live?.verified ?? insight.verified) && <span className="ig-chip verified">verified</span>}
              {(live?.private ?? insight.private) && <span className="ig-chip">private</span>}
              {insight.followsYou && insight.youFollow && <span className="ig-chip mutual">mutual</span>}
              {insight.followsYou && !insight.youFollow && (
                <span className="ig-chip fan">you don’t follow back</span>
              )}
              {!insight.followsYou && insight.youFollow && (
                <span className="ig-chip ghost">doesn’t follow you back</span>
              )}
            </span>
          </div>
        </header>

        {live && !live.notFound && (
          <div className="ig-sheet-counts">
            <Count label="Posts" value={live.posts} />
            <Count label="Followers" value={live.followers} />
            <Count label="Following" value={live.following} />
          </div>
        )}
        {live?.bio && <p className="ig-sheet-bio">{live.bio}</p>}
        {liveState === 'loading' && <p className="ig-sheet-live-note">Loading live details…</p>}
        {liveState === 'unavailable' && (
          <p className="ig-sheet-live-note">
            Live details (picture, bio, counts) need the local agent running on this Mac.
          </p>
        )}
        {live?.notFound && (
          <p className="ig-sheet-live-note">Instagram has no such account any more.</p>
        )}

        <Relationship insight={insight} />

        {insight.events.length > 0 && (
          <div className="ig-sheet-block">
            <h3 className="ig-sheet-h3">Recorded activity</h3>
            <ul className="ig-sheet-events">
              {insight.events.map((e, i) => (
                <li key={`${e.kind}-${e.t}-${i}`}>
                  <span className={`ig-sheet-dot ${e.dir === 'out' ? 'out' : e.kind}`} aria-hidden />
                  {e.dir === 'out'
                    ? `You ${e.kind === 'follow' ? 'followed' : 'unfollowed'} them`
                    : e.kind === 'follow'
                      ? 'They followed you'
                      : 'They unfollowed you'}
                  <span className="ig-sheet-event-date">{exactDate(e.t)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Relationship({ insight }: { insight: Insight }) {
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n.toLocaleString()}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
  };

  return (
    <div className="ig-sheet-block">
      <h3 className="ig-sheet-h3">Your history</h3>
      <dl className="ig-sheet-facts">
        {insight.followsYou ? (
          <>
            <dt>They followed you</dt>
            <dd>
              {insight.followedYouAt ? exactDate(insight.followedYouAt) : 'date unknown'}
              {insight.followerRank && (
                <span className="ig-sheet-rank">
                  your {ordinal(insight.followerRank)} follower of{' '}
                  {insight.followerTotal.toLocaleString()}
                </span>
              )}
            </dd>
          </>
        ) : (
          <>
            <dt>They follow you</dt>
            <dd>No</dd>
          </>
        )}

        {insight.youFollow ? (
          <>
            <dt>You followed them</dt>
            <dd>
              {insight.youFollowedAt ? exactDate(insight.youFollowedAt) : 'date unknown'}
              {insight.followingRank && (
                <span className="ig-sheet-rank">
                  your {ordinal(insight.followingRank)} follow of{' '}
                  {insight.followingTotal.toLocaleString()}
                </span>
              )}
            </dd>
          </>
        ) : (
          <>
            <dt>You follow them</dt>
            <dd>No</dd>
          </>
        )}
      </dl>
      <p className="ig-sheet-note">
        Positions count current relationships only — anyone who followed and later left isn’t in the
        data, so a true all-time position can’t be recovered.
      </p>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="ig-sheet-count">
      <span className="ig-sheet-count-value">{value == null ? '—' : value.toLocaleString()}</span>
      <span className="ig-sheet-count-label">{label}</span>
    </div>
  );
}

/** Live picture when the agent supplied one, else the stable gradient initial. */
function SheetAvatar({ username, src }: { username: string; src: string | null }) {
  const { hue, initial } = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < username.length; i++) acc = (acc * 31 + username.charCodeAt(i)) % 360;
    const letter = [...username].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? username.slice(0, 1);
    return { hue: acc, initial: letter.toUpperCase() };
  }, [username]);

  const [broken, setBroken] = useState(false);

  if (src && !broken) {
    return (
      <img className="ig-sheet-avatar" src={src} alt="" onError={() => setBroken(true)} />
    );
  }
  return (
    <span
      className="ig-sheet-avatar"
      aria-hidden
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 72% 62%), hsl(${(hue + 42) % 360} 68% 46%))`,
      }}
    >
      {initial}
    </span>
  );
}
