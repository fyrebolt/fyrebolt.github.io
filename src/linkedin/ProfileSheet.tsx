import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildRanks, exactDate, insightFor, timeAgo, type Insight, type TrackerData } from './data';
import { Avatar } from './Avatar';

/**
 * Person popup.
 *
 * Everything here comes from the tracker's own records — dates, positions,
 * recorded events, and every time this person has viewed your profile. There's
 * no live-lookup tier like the Instagram sheet has: LinkedIn returns a login
 * wall to anything that isn't an authenticated voyager call, so a "fetch their
 * current headline" button would either need the session cookie in the browser
 * or would simply fail. The daily pull already refreshes headlines.
 */
export default function ProfileSheet({
  id,
  data,
  onClose,
}: {
  id: string;
  data: TrackerData;
  onClose: () => void;
}) {
  const connectionRanks = useMemo(() => buildRanks(data.connections ?? []), [data.connections]);
  const insight = useMemo(
    () => insightFor(id, data, connectionRanks),
    [id, data, connectionRanks],
  );

  // Where to put the dialog.
  //
  // `position: fixed` can't be trusted here: .ipad-frame is scaled and
  // .app-body is translated, and a transformed ancestor becomes the containing
  // block for fixed descendants. Portalling to <body> escapes those transforms,
  // and measuring the device screen keeps the dialog centred on it rather than
  // on the whole browser window.
  const [screenBox, setScreenBox] = useState<ScreenBox>(measureScreen);
  useEffect(() => {
    const remeasure = () => setScreenBox(measureScreen());
    window.addEventListener('resize', remeasure);
    return () => window.removeEventListener('resize', remeasure);
  }, []);

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // preventScroll matters: without it the browser scrolls the focused button
    // into view, dragging the page behind the dialog and losing your place in
    // the list you just clicked from.
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const linkable = !insight.id.startsWith('name:');
  const title = insight.name ?? insight.id;

  return createPortal(
    <div className="li-sheet-backdrop" style={screenBox} onClick={onClose} role="presentation">
      <div
        className="li-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Profile: ${title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} className="li-sheet-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <header className="li-sheet-head">
          <Avatar seed={insight.id} label={insight.name} />
          <div className="li-sheet-id">
            <span className="li-sheet-name">{title}</span>
            {insight.headline && <span className="li-sheet-headline">{insight.headline}</span>}
            {insight.location && <span className="li-sheet-location">{insight.location}</span>}
            <span className="li-sheet-badges">
              {insight.connected && <span className="li-chip connected">1st · connected</span>}
              {insight.followsYou && <span className="li-chip follower">follows you</span>}
              {insight.views.length > 0 && (
                <span className="li-chip viewer">
                  viewed you {insight.views.length}×
                </span>
              )}
            </span>
            {linkable && (
              <a
                className="li-sheet-link"
                href={`https://www.linkedin.com/in/${insight.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                linkedin.com/in/{insight.id} ↗
              </a>
            )}
          </div>
        </header>

        <Relationship insight={insight} />

        {insight.views.length > 0 && (
          <div className="li-sheet-block">
            <h3 className="li-sheet-h3">Profile views</h3>
            <ul className="li-sheet-events">
              {insight.views.slice(0, 20).map((v, i) => (
                <li key={`v-${v.t}-${i}`}>
                  <span className="li-sheet-dot viewer" aria-hidden />
                  Viewed your profile
                  <span className="li-sheet-event-date" title={exactDate(v.t)}>
                    {timeAgo(v.t)}
                  </span>
                </li>
              ))}
            </ul>
            {insight.views.length > 20 && (
              <p className="li-sheet-note">+ {insight.views.length - 20} earlier views.</p>
            )}
          </div>
        )}

        {insight.events.length > 0 && (
          <div className="li-sheet-block">
            <h3 className="li-sheet-h3">Recorded activity</h3>
            <ul className="li-sheet-events">
              {insight.events.map((e, i) => (
                <li key={`${e.kind}-${e.t}-${i}`}>
                  <span className={`li-sheet-dot ${e.kind}`} aria-hidden />
                  {describe(e.kind, e.dir)}
                  <span className="li-sheet-event-date">{exactDate(e.t)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function describe(kind: string, dir?: 'in' | 'out'): string {
  if (kind === 'connect') return 'You connected';
  if (kind === 'disconnect') return 'You were disconnected';
  if (kind === 'follow') return dir === 'out' ? 'You followed them' : 'They followed you';
  return dir === 'out' ? 'You unfollowed them' : 'They unfollowed you';
}

interface ScreenBox {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: string;
}

/** The iPad screen's on-screen rectangle, or the whole window as a fallback. */
function measureScreen(): ScreenBox {
  const el = document.querySelector('.ipad-screen');
  if (!el) {
    return {
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      borderRadius: '0px',
    };
  }
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    // Follow the device's rounded corners so the dim doesn't overhang them.
    borderRadius: getComputedStyle(el).borderRadius,
  };
}

function Relationship({ insight }: { insight: Insight }) {
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n.toLocaleString()}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
  };

  return (
    <div className="li-sheet-block">
      <h3 className="li-sheet-h3">Your history</h3>
      <dl className="li-sheet-facts">
        <dt>Connected</dt>
        <dd>
          {insight.connected ? (
            <>
              {insight.connectedAt ? exactDate(insight.connectedAt) : 'date unknown'}
              {insight.connectionRank && (
                <span className="li-sheet-rank">
                  your {ordinal(insight.connectionRank)} connection of{' '}
                  {insight.connectionTotal.toLocaleString()}
                </span>
              )}
            </>
          ) : (
            'No'
          )}
        </dd>

        <dt>Follows you</dt>
        <dd>
          {insight.followsYou
            ? insight.followedYouAt
              ? exactDate(insight.followedYouAt)
              : 'yes, date unknown'
            : 'No'}
        </dd>

        {insight.views.length > 0 && (
          <>
            <dt>Last viewed you</dt>
            <dd>{exactDate(insight.views[0].t)}</dd>
          </>
        )}
      </dl>
      <p className="li-sheet-note">
        Positions count current connections only — anyone who connected and later disconnected isn’t
        in the data, so a true all-time position can’t be recovered.
      </p>
    </div>
  );
}
