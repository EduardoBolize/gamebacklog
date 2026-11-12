import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useI18n } from '../../i18n/index.tsx';
import { ContinuePlaying } from './ContinuePlaying.tsx';
import { applyFilters, continuePlaying, DEFAULT_FILTERS, sideGroups } from './filters.ts';
import type { Filters, StatusFilter } from './filters.ts';
import { CloseIcon } from './icons.tsx';
import { LibrarySection } from './LibrarySection.tsx';
import type { View } from './LibrarySection.tsx';
import { MOCK_STATUSES, mockGames } from './mock-library.ts';
import { HEADING } from './parts.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import type { Tab } from './TopBar.tsx';

const SIDEBAR_ID = 'library-sidebar';
/** Tailwind's `md`: below it the sidebar is a drawer over the page. */
const WIDE_QUERY = '(min-width: 768px)';

function readStatus(value: string | null): StatusFilter {
  return MOCK_STATUSES.find((status) => status === value) ?? 'all';
}

/** Open by default on wide screens, closed on phones; follows the screen across the breakpoint. */
function useSidebar() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const [open, setOpen] = useState(wide);

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => {
      setWide(query.matches);
      setOpen(query.matches);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return { wide, open, setOpen };
}

/** The library screen: top bar, filters on the side, "continue playing" and the cover grid. */
export function LibraryScreen() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const sidebar = useSidebar();
  const drawerRef = useRef<HTMLElement>(null);

  const status = readStatus(params.get('status'));
  const onWishlist = pathname === '/wishlist';
  const activeTab: Tab = onWishlist
    ? 'wishlist'
    : status === 'playing'
      ? 'playing'
      : status === 'backlog'
        ? 'backlog'
        : 'library';

  const [rest, setRest] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState<View>('grid');
  const filters: Filters = { ...rest, status };

  const shown = useMemo(
    () => applyFilters(mockGames, { ...rest, status }, locale),
    [rest, status, locale],
  );
  const groups = useMemo(() => sideGroups(mockGames), []);
  const playing = useMemo(() => continuePlaying(mockGames), []);

  const drawer = sidebar.open && !sidebar.wide;
  const setSidebarOpen = sidebar.setOpen;

  // As a drawer: focus moves in when it opens, and Escape closes it.
  useEffect(() => {
    if (!drawer) return;
    drawerRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, setSidebarOpen]);

  const setStatus = (next: StatusFilter) =>
    void navigate({ pathname: '/', search: next === 'all' ? '' : `?status=${next}` });
  const change = (patch: Partial<Filters>) => {
    const { status: nextStatus, ...others } = patch;
    if (nextStatus) setStatus(nextStatus);
    setRest((current) => ({ ...current, ...others }));
  };

  return (
    <div className="theme-library flex min-h-screen flex-col text-sm">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:p-2 focus:text-accent-text"
      >
        {t('app.skipToContent')}
      </a>

      <TopBar
        activeTab={activeTab}
        sidebarOpen={sidebar.open}
        sidebarId={SIDEBAR_ID}
        onToggleSidebar={() => sidebar.setOpen(!sidebar.open)}
      />

      <div className="flex flex-1 items-stretch">
        {drawer && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('libraryScreen.closeSidebar')}
            onClick={() => sidebar.setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-topbar/70"
          />
        )}
        <aside
          id={SIDEBAR_ID}
          ref={drawerRef}
          tabIndex={-1}
          aria-label={t('libraryScreen.sidebar')}
          hidden={!sidebar.open}
          className="fixed inset-y-0 left-0 z-50 w-[min(320px,88vw)] overflow-y-auto border-r border-divider bg-sidebar px-4 pb-8 pt-5 outline-none md:static md:z-auto md:w-[300px] md:shrink-0 md:overflow-visible"
        >
          {drawer && (
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                aria-label={t('libraryScreen.closeSidebar')}
                onClick={() => sidebar.setOpen(false)}
                className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-line text-text"
              >
                <CloseIcon size={18} />
              </button>
            </div>
          )}
          <Sidebar
            games={mockGames}
            groups={groups}
            filters={filters}
            onStatus={setStatus}
            onChange={change}
            onPickGame={() => {
              if (!sidebar.wide) sidebar.setOpen(false);
            }}
          />
        </aside>

        <main
          id="content"
          className="flex min-w-0 flex-1 flex-col gap-9 px-4 pb-12 pt-6 md:px-8 md:pt-7"
        >
          {onWishlist ? (
            <section aria-labelledby="wishlist-title" className="flex flex-col gap-3">
              <h1 id="wishlist-title" className={HEADING}>
                {t('libraryScreen.wishlistTitle')}
              </h1>
              <p className="text-muted">{t('libraryScreen.wishlistSoon')}</p>
            </section>
          ) : (
            <>
              <h1 className="sr-only">{t(`libraryScreen.tabs.${activeTab}`)}</h1>
              <ContinuePlaying games={playing} />
              <LibrarySection
                title={t(`libraryScreen.titles.${status}`)}
                games={shown}
                filters={filters}
                view={view}
                onView={setView}
                onChange={change}
                onClear={() => setRest((current) => ({ ...DEFAULT_FILTERS, sort: current.sort }))}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
