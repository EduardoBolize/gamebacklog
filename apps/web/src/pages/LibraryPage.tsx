import { LIBRARY_STATUSES, type LibraryItem, type LibraryStatus } from '@gamebacklog/shared';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, useApiMutation, useLibrary, useNudges } from '../api.ts';
import { useAddGame } from '../components/Shell.tsx';
import { Cover, ErrorNote, Loading } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

const SORTS = ['added', 'title', 'release', 'score', 'time'] as const;
type Sort = (typeof SORTS)[number];

const SORT_LABEL = {
  added: 'library.sortAdded',
  title: 'library.sortTitle',
  release: 'library.sortRelease',
  score: 'library.sortScore',
  time: 'library.sortTime',
} as const;

/** Missing values go last whatever the direction, so "no score" never tops a ranking. */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

function sortItems(items: LibraryItem[], sort: Sort, locale: string): LibraryItem[] {
  const byTitle = (a: LibraryItem, b: LibraryItem) =>
    a.game.title.localeCompare(b.game.title, locale, { sensitivity: 'base' });
  const sorted = [...items];
  switch (sort) {
    case 'title':
      return sorted.sort(byTitle);
    case 'release':
      return sorted.sort(
        (a, b) => compareNullable(a.game.releaseYear, b.game.releaseYear, -1) || byTitle(a, b),
      );
    case 'score':
      return sorted.sort((a, b) => compareNullable(a.score, b.score, -1) || byTitle(a, b));
    case 'time':
      return sorted.sort(
        (a, b) => compareNullable(a.mainMinutes, b.mainMinutes, 1) || byTitle(a, b),
      );
    default:
      return sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || byTitle(a, b));
  }
}

function GameCard({ item }: { item: LibraryItem }) {
  const { t } = useI18n();
  const update = useApiMutation((body: Parameters<typeof api.updateEntry>[1]) =>
    api.updateEntry(item.id, body),
  );
  const remove = useApiMutation(() => api.removeEntry(item.id));

  return (
    <li className="game-card group relative">
      <Link to={`/games/${item.id}`} className="block rounded-base">
        <Cover title={item.game.title} url={item.game.coverUrl} />
        <span className="mt-2 block truncate text-sm font-medium">{item.game.title}</span>
      </Link>
      <span className="block truncate text-sm text-muted">
        {item.isFavorite && <span aria-label={t('game.favorited')}>★ </span>}
        {t(`status.${item.status}`)} · {item.platform ?? t('library.noPlatform')}
      </span>

      <details className="absolute right-1 top-1 opacity-100 group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:open:opacity-100">
        <summary
          aria-label={t('library.options', { title: item.game.title })}
          className="flex h-9 w-9 list-none items-center justify-center rounded-base border border-line bg-bg text-lg leading-none [&::-webkit-details-marker]:hidden"
        >
          ⋯
        </summary>
        <div className="absolute right-0 z-10 mt-1 grid w-[9.5rem] gap-2 rounded-base border border-line bg-bg p-3">
          <label>
            <span className="label">{t('library.changeStatus')}</span>
            <select
              className="field"
              value={item.status}
              onChange={(event) => update.mutate({ status: event.target.value as LibraryStatus })}
            >
              {LIBRARY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => update.mutate({ isFavorite: !item.isFavorite })}
          >
            {item.isFavorite ? t('library.unfavorite') : t('library.favorite')}
          </button>
          <button
            type="button"
            className="btn text-danger"
            onClick={() => {
              if (window.confirm(t('library.confirmRemove', { title: item.game.title }))) {
                remove.mutate(undefined);
              }
            }}
          >
            {t('library.removeFromLibrary')}
          </button>
          <ErrorNote error={update.error ?? remove.error} />
        </div>
      </details>
    </li>
  );
}

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
      className="grid gap-2 rounded-base border border-line p-4"
    >
      <h2 id="nudges-title" className="section-title">
        {t('nudge.title')}
      </h2>
      <ul className="grid gap-1 text-sm">
        {items.slice(0, 3).map((item) => (
          <li key={item.libraryEntryId}>
            <Link to={`/games/${item.libraryEntryId}`} className="link font-medium">
              {item.title}
            </Link>
            <span className="text-muted">
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

export function LibraryPage() {
  const { t, locale } = useI18n();
  const library = useLibrary();
  const addGame = useAddGame();
  const [params, setParams] = useSearchParams();

  // Filters live in the URL, so coming back from a game keeps what was filtered.
  const text = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  const platform = params.get('platform') ?? '';
  const genre = params.get('genre') ?? '';
  const favorites = params.get('fav') === '1';
  const sort: Sort = SORTS.find((option) => option === params.get('sort')) ?? 'added';

  function setParam(name: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  }

  const items = useMemo(() => library.data?.items ?? [], [library.data]);

  const { platforms, genres } = useMemo(() => {
    const unique = (values: (string | null)[]) =>
      [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
        a.localeCompare(b, locale),
      );
    return {
      platforms: unique(items.map((item) => item.platform)),
      genres: unique(items.flatMap((item) => item.game.genres)),
    };
  }, [items, locale]);

  // Counts reflect every filter except the status itself, so they predict what a click shows.
  const withoutStatus = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!needle || item.game.title.toLowerCase().includes(needle)) &&
        (!platform || item.platform === platform) &&
        (!genre || item.game.genres.includes(genre)) &&
        (!favorites || item.isFavorite),
    );
  }, [items, text, platform, genre, favorites]);

  const visible = useMemo(
    () =>
      sortItems(
        status === 'all' ? withoutStatus : withoutStatus.filter((item) => item.status === status),
        sort,
        locale,
      ),
    [withoutStatus, status, sort, locale],
  );

  if (library.isPending) return <Loading />;
  if (library.isError) return <ErrorNote error={library.error} />;

  if (items.length === 0) {
    return (
      <section className="mx-auto grid max-w-md justify-items-start gap-4 py-16">
        <h1 className="text-xl">{t('library.emptyTitle')}</h1>
        <p className="text-muted">{t('library.emptyBody')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => addGame.open('playing')}>
            {t('library.emptyAdd')}
          </button>
          <Link to="/import/steam" className="btn">
            {t('library.emptyImport')}
          </Link>
        </div>
      </section>
    );
  }

  const count = (key: string) =>
    key === 'all'
      ? withoutStatus.length
      : withoutStatus.filter((item) => item.status === key).length;
  const hasFilters = Boolean(text || platform || genre || favorites || status !== 'all');

  return (
    <div className="grid gap-5">
      <h1 className="sr-only">{t('library.title')}</h1>
      <Nudges />

      <input
        type="search"
        className="field"
        aria-label={t('library.searchLabel')}
        placeholder={t('library.search')}
        value={text}
        onChange={(event) => setParam('q', event.target.value)}
      />

      <nav
        aria-label={t('library.statusFilter')}
        className="-mx-4 overflow-x-auto overflow-y-hidden px-4"
      >
        <ul className="flex gap-x-5 gap-y-1 whitespace-nowrap sm:flex-wrap">
          {(['all', ...LIBRARY_STATUSES] as const).map((key) => {
            const selected = status === key;
            const total = count(key);
            if (key !== 'all' && total === 0 && !selected) return null;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setParam('status', key === 'all' ? '' : key)}
                  className={`min-h-11 cursor-pointer border-b-2 text-sm sm:min-h-8 ${
                    selected
                      ? 'border-accent font-semibold text-text'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {t(`statusPlural.${key}`)} <span className="tabular-nums">{total}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <details className="sm:hidden">
        <summary className="text-sm text-muted">{t('library.filters')}</summary>
        <div className="mt-3 grid gap-3">
          <Filters
            platform={platform}
            genre={genre}
            favorites={favorites}
            sort={sort}
            platforms={platforms}
            genres={genres}
            setParam={setParam}
          />
        </div>
      </details>
      <div className="hidden flex-wrap items-center gap-x-6 gap-y-2 sm:flex">
        <Filters
          platform={platform}
          genre={genre}
          favorites={favorites}
          sort={sort}
          platforms={platforms}
          genres={genres}
          setParam={setParam}
        />
      </div>

      {visible.length === 0 ? (
        <div className="grid justify-items-start gap-3 py-10">
          <p className="text-muted">{t('library.noResults')}</p>
          {hasFilters && (
            <button type="button" className="btn" onClick={() => setParams({}, { replace: true })}>
              {t('library.clearFilters')}
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
          {visible.map((item) => (
            <GameCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Filters({
  platform,
  genre,
  favorites,
  sort,
  platforms,
  genres,
  setParam,
}: {
  platform: string;
  genre: string;
  favorites: boolean;
  sort: Sort;
  platforms: string[];
  genres: string[];
  setParam: (name: string, value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('library.platform')}
        <select
          className="field sm:!w-auto"
          value={platform}
          onChange={(event) => setParam('platform', event.target.value)}
        >
          <option value="">{t('library.allPlatforms')}</option>
          {platforms.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('library.genre')}
        <select
          className="field sm:!w-auto"
          value={genre}
          onChange={(event) => setParam('genre', event.target.value)}
        >
          <option value="">{t('library.allGenres')}</option>
          {genres.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm text-muted sm:min-h-0">
        <input
          type="checkbox"
          className="accent-accent"
          checked={favorites}
          onChange={(event) => setParam('fav', event.target.checked ? '1' : '')}
        />
        {t('library.onlyFavorites')}
      </label>
      <label className="flex items-center gap-2 text-sm text-muted sm:ml-auto">
        {t('library.sort')}
        <select
          className="field sm:!w-auto"
          value={sort}
          onChange={(event) =>
            setParam('sort', event.target.value === 'added' ? '' : event.target.value)
          }
        >
          {SORTS.map((option) => (
            <option key={option} value={option}>
              {t(SORT_LABEL[option])}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
