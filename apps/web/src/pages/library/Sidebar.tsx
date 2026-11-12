import { LIBRARY_STATUSES, type LibraryItem } from '@gamebacklog/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { SearchIcon } from '../../components/icons.tsx';
import { useI18n } from '../../i18n/index.tsx';
import {
  countBy,
  FAMILIES,
  filterWithoutStatus,
  genresByCount,
  platformFamily,
  SORTS,
} from './filters.ts';
import type { Filters, SideGroup, Sort, StatusFilter } from './filters.ts';
import { STATUS_DOT } from './parts.tsx';

const FIELD =
  'h-11 w-full rounded-lg border border-line-control bg-bg text-text focus-within:border-accent';
/** Genres shown before "see all"; IGDB has a couple dozen. */
const GENRES_SHOWN = 10;
/** Games per sidebar group before "see all". */
const GROUP_SHOWN = 8;

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

function Group({ group, onPickGame }: { group: SideGroup; onPickGame: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  if (group.items.length === 0) return null;
  const shown = expanded ? group.items : group.items.slice(0, GROUP_SHOWN);

  return (
    <section aria-labelledby={id} className="flex flex-col gap-0.5">
      <h2
        id={id}
        className="flex justify-between px-1.5 pb-1.5 font-sans text-xs font-semibold tracking-[0.08em] text-muted"
      >
        <span>{t(`libraryScreen.groups.${group.id}`)}</span>
        <span>{group.items.length}</span>
      </h2>
      <ul className="flex flex-col gap-0.5">
        {shown.map((item) => (
          <li key={item.id}>
            <Link
              to={`/games/${item.id}`}
              onClick={onPickGame}
              className={`flex min-h-9 items-center gap-2.5 rounded-md px-1.5 py-1 text-[13px] font-medium text-text hover:bg-surface ${
                item.status === 'playing' ? 'bg-selected/50' : ''
              }`}
            >
              {item.game.coverUrl ? (
                <img
                  src={item.game.coverUrl}
                  alt=""
                  loading="lazy"
                  className="size-6 shrink-0 rounded object-cover"
                />
              ) : (
                <span aria-hidden="true" className="size-6 shrink-0 rounded bg-selected" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {item.game.title}
                <span className="sr-only"> ({t(`libraryScreen.badge.${item.status}`)})</span>
              </span>
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${STATUS_DOT[item.status]}`}
              />
            </Link>
          </li>
        ))}
      </ul>
      {group.items.length > GROUP_SHOWN && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="min-h-8 cursor-pointer self-start px-1.5 text-xs font-semibold text-accent hover:text-accent-hover"
        >
          {expanded
            ? t('libraryScreen.showFewer')
            : t('libraryScreen.showAll', { count: group.items.length })}
        </button>
      )}
    </section>
  );
}

export function Sidebar({
  items,
  groups,
  filters,
  onChange,
  onPickGame,
}: {
  items: LibraryItem[];
  groups: SideGroup[];
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  /** Called after a game of the list is picked (closes the drawer on phones). */
  onPickGame: () => void;
}) {
  const { t, locale } = useI18n();
  const ids = useId();
  const [allGenres, setAllGenres] = useState(false);

  // Status counts follow the other filters, so each pill predicts what a click shows.
  const narrowed = filterWithoutStatus(items, filters);
  const statusCounts = countBy(narrowed, (item) => item.status);
  const familyCounts = countBy(items, platformFamily);
  const genres = genresByCount(items, locale);
  const shownGenres = allGenres
    ? genres
    : genres.filter(([genre], index) => index < GENRES_SHOWN || filters.genres.includes(genre));
  const statuses: StatusFilter[] = ['all', ...LIBRARY_STATUSES];

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-search`} className="eyebrow">
          {t('libraryScreen.search')}
        </label>
        <div className={`${FIELD} flex items-center gap-2 px-3 text-muted`}>
          <SearchIcon />
          <input
            id={`${ids}-search`}
            type="search"
            value={filters.query}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder={t('libraryScreen.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <div role="group" aria-labelledby={`${ids}-show`} className="flex flex-col gap-2.5">
        <span id={`${ids}-show`} className="eyebrow">
          {t('libraryScreen.show')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((status) => {
            const active = filters.status === status;
            const total = status === 'all' ? narrowed.length : (statusCounts.get(status) ?? 0);
            if (status !== 'all' && total === 0 && !active) return null;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ status })}
                className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${
                  active
                    ? 'border-accent bg-accent text-accent-text'
                    : 'border-line-control text-soft hover:border-soft'
                }`}
              >
                {t(`libraryScreen.pills.${status}`)}
                <span className="font-medium opacity-75">{total}</span>
              </button>
            );
          })}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="eyebrow mb-2.5">{t('libraryScreen.platform')}</legend>
        {FAMILIES.map((family) => {
          const total = familyCounts.get(family) ?? 0;
          if (total === 0 && !filters.families.includes(family)) return null;
          return (
            <label key={family} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="size-4 accent-accent [color-scheme:light]"
                checked={filters.families.includes(family)}
                onChange={() => onChange({ families: toggle(filters.families, family) })}
              />
              <span className="flex-1">{t(`libraryScreen.families.${family}`)}</span>
              <span className="text-xs text-muted">{total}</span>
            </label>
          );
        })}
      </fieldset>

      {genres.length > 0 && (
        <div role="group" aria-labelledby={`${ids}-genre`} className="flex flex-col gap-2.5">
          <span id={`${ids}-genre`} className="eyebrow">
            {t('libraryScreen.genre')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {shownGenres.map(([genre]) => {
              const active = filters.genres.includes(genre);
              return (
                <button
                  key={genre}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ genres: toggle(filters.genres, genre) })}
                  className={`min-h-8 cursor-pointer rounded-md border px-2.5 text-xs font-medium ${
                    active
                      ? 'border-accent bg-selected text-text'
                      : 'border-line-control text-soft hover:border-soft'
                  }`}
                >
                  {genre}
                </button>
              );
            })}
          </div>
          {genres.length > GENRES_SHOWN && (
            <button
              type="button"
              aria-expanded={allGenres}
              onClick={() => setAllGenres(!allGenres)}
              className="min-h-8 cursor-pointer self-start text-xs font-semibold text-accent hover:text-accent-hover"
            >
              {allGenres
                ? t('libraryScreen.fewerGenres')
                : t('libraryScreen.moreGenres', { count: genres.length })}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-sort`} className="eyebrow">
          {t('libraryScreen.sortBy')}
        </label>
        <select
          id={`${ids}-sort`}
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value as Sort })}
          className={`${FIELD} cursor-pointer px-2.5`}
        >
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(`libraryScreen.sort.${sort}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2.5">
        {(
          [
            ['hideNeverOpened', 'libraryScreen.hideNeverOpened'],
            ['onlyAchievements', 'libraryScreen.onlyAchievements'],
            ['onlyFavorites', 'libraryScreen.onlyFavorites'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-accent [color-scheme:light]"
              checked={filters[key]}
              onChange={(event) => onChange({ [key]: event.target.checked })}
            />
            {t(label)}
          </label>
        ))}
      </div>

      <div className="h-px bg-line" />

      <div className="flex flex-col gap-[18px]">
        {groups.map((group) => (
          <Group key={group.id} group={group} onPickGame={onPickGame} />
        ))}
      </div>
    </div>
  );
}
