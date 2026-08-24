import { useCallback, useEffect, useRef, useState } from 'react';
import IpadFrame from '../ios/IpadFrame';
import AppIcon from './AppIcon';
import { APPS, DOCK_APPS } from './apps';
import { capacityFor, cellHeight, cellWidth, paginate, COL_GAP, ROW_GAP } from './layout';
import './home.css';

/** How long one wheel gesture is allowed to hold the pager, in ms. */
const WHEEL_LOCK = 420;

export default function HomeScreen() {
  const pagerRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(() => capacityFor(400, 400));
  const [page, setPage] = useState(0);

  // Scroll handlers and the wheel listener run outside React's render, so they
  // read the current page and page count from refs rather than from state.
  const pageRef = useRef(0);
  const totalRef = useRef(1);

  const { cols, rows, tile } = capacity;
  const pages = paginate(APPS, cols * rows);
  useEffect(() => {
    totalRef.current = pages.length;
  }, [pages.length]);

  const land = useCallback((i: number) => {
    pageRef.current = i;
    setPage(i);
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const el = pagerRef.current;
      if (!el) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
      land(i);
    },
    [land],
  );

  // Measure the room the grid has, and re-measure whenever it changes (window
  // resize, orientation, the browser chrome coming and going on a phone). The
  // page width doesn't depend on the capacity, so the scroll offset can be
  // re-aligned here directly.
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    const measure = () => {
      const cap = capacityFor(el.clientWidth, el.clientHeight);
      setCapacity(cap);
      const total = Math.max(1, Math.ceil(APPS.length / (cap.cols * cap.rows)));
      const next = Math.min(pageRef.current, total - 1);
      if (next !== pageRef.current) land(next);
      el.scrollLeft = next * el.clientWidth;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [land]);

  // A vertical wheel is the one gesture a desktop visitor is sure to try, and
  // there is nothing to scroll vertically here — so spend it on turning the
  // page, one page per flick.
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    let lockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      // Trackpads and shift+wheel already scroll the pager sideways natively.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (Math.abs(e.deltaY) < 8) return;
      const now = performance.now();
      if (now < lockedUntil) {
        e.preventDefault();
        return;
      }
      const next = Math.min(
        totalRef.current - 1,
        Math.max(0, pageRef.current + (e.deltaY > 0 ? 1 : -1)),
      );
      if (next === pageRef.current) return;
      e.preventDefault();
      lockedUntil = now + WHEEL_LOCK;
      goTo(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [goTo]);

  const onScroll = () => {
    const el = pagerRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== pageRef.current) land(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = Math.min(
      pages.length - 1,
      Math.max(0, pageRef.current + (e.key === 'ArrowRight' ? 1 : -1)),
    );
    if (next === pageRef.current) return;
    e.preventDefault();
    goTo(next);
  };

  return (
    <IpadFrame orientation="portrait" ariaLabel="iPad home screen" contentClassName="home-content">
      <header className="home-header">
        <h1 className="home-title">Hastin Chen</h1>
        <p className="home-subtitle">Tap an app to explore my work</p>
      </header>

      <main
        className="home-pager"
        aria-label="Apps"
        ref={pagerRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={
          {
            '--home-cols': cols,
            '--home-cell-w': `${cellWidth(tile)}px`,
            '--home-cell-h': `${cellHeight(tile)}px`,
            '--home-col-gap': `${COL_GAP}px`,
            '--home-row-gap': `${ROW_GAP}px`,
          } as React.CSSProperties
        }
      >
        {pages.map((appsOnPage, p) => (
          <section
            key={p}
            className="home-page"
            aria-label={pages.length > 1 ? `Page ${p + 1} of ${pages.length}` : 'Apps'}
          >
            {appsOnPage.map((app, i) => (
              <AppIcon key={app.id} app={app} size={tile} index={p * cols * rows + i} />
            ))}
          </section>
        ))}
      </main>

      {pages.length > 1 && (
        <div className="home-dots" aria-label="Home screen pages">
          {pages.map((_, p) => (
            <button
              key={p}
              className="home-dot"
              aria-label={`Page ${p + 1} of ${pages.length}`}
              aria-current={p === page ? 'true' : undefined}
              onClick={() => goTo(p)}
            />
          ))}
        </div>
      )}

      <nav className="home-dock ios-glass-dock" aria-label="Dock">
        {DOCK_APPS.map((app, i) => (
          <AppIcon
            key={app.id}
            app={app}
            size={Math.min(64, tile)}
            showLabel={false}
            index={APPS.length + i}
          />
        ))}
      </nav>
    </IpadFrame>
  );
}
