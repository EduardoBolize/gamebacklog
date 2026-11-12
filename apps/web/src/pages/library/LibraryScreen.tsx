import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLibrary, useNudges } from '../../api.ts';
import { CloseIcon } from '../../components/icons.tsx';
import { useAddGame, useSidebar } from '../../components/Shell.tsx';
import { ErrorNote, Loading } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { ContinuePlaying } from './ContinuePlaying.tsx';
import { applyFilters, continuePlaying, readFilters, sideGroups, writeFilters } from './filters.ts';
import type { Filters } from './filters.ts';
import { LibrarySection } from './LibrarySection.tsx';
import type { View } from './LibrarySection.tsx';
import { HEADING } from './parts.tsx';
import { Sidebar } from './Sidebar.tsx';

/**
 * Games being played that were left alone: a quiet reminder with how close each one is to the
 * end, before they are dropped without anyone deciding to.
 */
function Nudges() {
  const { t, formatMinutes } = useI18n();
  const nudges = useNudges();
  const items = nudges.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="nudges-title"
      className="grid gap-2 rounded-[10px] border border-line-control bg-selected/60 px-4 py-3.5"
    >
      <h2 id="nudges-title" className="font-display text-lg font-bold">
        {t('nudge.title')}
      </h2>
      <ul className="grid gap-1">
        {items.slice(0, 3).map((item) => (
          <li key={item.libraryEntryId}>
            <Link
              to={`/games/${item.libraryEntryId}`}
              className="font-semibold text-accent hover:text-accent-hover hover:underline"
            >
              {item.title}
            </Link>
            <span className="text-soft">
              {' · '}
              {t('nudge.idle', { days: item.daysIdle })}
              {item.percent !== null && ' · '}
              {item.percent !== null &&
                (item.remainingMinutes !== null
                  ? t('nudge.close', {
                      time: formatMinutes(item.remainingMinutes),
                      percent: item.percent,
                    })
                  : t('nudge.percentOnly', { percent: item.percent }))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyLibrary() {
  const { t } = useI18n();
  const addGame = useAddGame();
  return (
    <main id="content" className="mx-auto grid max-w-md justify-items-start gap-4 px-4 py-16">
      <h1 className={HEADING}>{t('library.emptyTitle')}</h1>
      <p className="text-muted">{t('library.emptyBody')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => addGame.open('playing')}>
          {t('library.emptyAdd')}
        </button>
        <Link to="/import/steam" className="btn">
          {t('library.emptyImport')}
        </Link>
      </div>
    </main>
  );
}

/** The library: filters and the game list on the side, "continue playing" and the covers. */
export function LibraryScreen() {
  const { t, locale } = useI18n();
  const library = useLibrary();
  const sidebar = useSidebar();
  const [params, setParams] = useSearchParams();
  const drawerRef = useRef<HTMLElement>(null);
  // Read once per render: the "recently played" window does not need to tick.
  const [now] = useState(() => Date.now());

  const filters = readFilters(params);
  const view: View = params.get('view') === 'list' ? 'list' : 'grid';
  const items = useMemo(() => library.data?.items ?? [], [library.data]);

  const paramsKey = params.toString();
  const shown = useMemo(
    () => applyFilters(items, readFilters(new URLSearchParams(paramsKey)), locale),
    [items, paramsKey, locale],
  );
  const groups = useMemo(() => sideGroups(items, locale, now), [items, locale, now]);
  const playing = useMemo(() => continuePlaying(items, locale), [items, locale]);

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

  // Typing in the search replaces the history entry; every other filter is a step back-able.
  const change = (patch: Partial<Filters>) =>
    setParams((current) => writeFilters(current, { ...readFilters(current), ...patch }), {
      replace: Object.keys(patch).every((key) => key === 'query'),
    });
  const setView = (next: View) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === 'list') copy.set('view', 'list');
        else copy.delete('view');
        return copy;
      },
      { replace: true },
    );
  const clear = () =>
    change({
      query: '',
      families: [],
      genres: [],
      hideNeverOpened: false,
      onlyAchievements: false,
      onlyFavorites: false,
    });

  if (library.isPending) {
    return (
      <main id="content" className="px-4 md:px-8">
        <Loading />
      </main>
    );
  }
  if (library.isError) {
    return (
      <main id="content" className="px-4 py-8 md:px-8">
        <ErrorNote error={library.error} />
      </main>
    );
  }
  if (items.length === 0) return <EmptyLibrary />;

  const onLibraryTab = filters.status === 'all';

  return (
    <div className="flex flex-1 items-stretch">
      {drawer && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('libraryScreen.closeSidebar')}
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-topbar/70"
        />
      )}
      <aside
        id={sidebar.id}
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
              onClick={() => setSidebarOpen(false)}
              className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-line text-text"
            >
              <CloseIcon size={18} />
            </button>
          </div>
        )}
        <Sidebar
          items={items}
          groups={groups}
          filters={filters}
          onChange={change}
          onPickGame={() => {
            if (!sidebar.wide) setSidebarOpen(false);
          }}
        />
      </aside>

      <main
        id="content"
        className="flex min-w-0 flex-1 flex-col gap-9 px-4 pb-12 pt-6 md:px-8 md:pt-7"
      >
        <h1 className="sr-only">{t(`libraryScreen.titles.${filters.status}`)}</h1>
        {onLibraryTab && <Nudges />}
        {(onLibraryTab || filters.status === 'playing') && <ContinuePlaying items={playing} />}
        <LibrarySection
          title={t(`libraryScreen.titles.${filters.status}`)}
          items={shown}
          filters={filters}
          view={view}
          onView={setView}
          onChange={change}
          onClear={clear}
        />
      </main>
    </div>
  );
}
