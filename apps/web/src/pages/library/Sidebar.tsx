import { useId } from 'react';
import { useI18n } from '../../i18n/index.tsx';
import { countBy, SORTS } from './filters.ts';
import type { Filters, SideGroup, Sort, StatusFilter } from './filters.ts';
import { SearchIcon } from './icons.tsx';
import { GENRES, MOCK_STATUSES, PLATFORMS } from './mock-library.ts';
import type { Game, Genre, Platform } from './mock-library.ts';
import { LABEL, STATUS_DOT } from './parts.tsx';

const FIELD =
  'h-11 w-full rounded-lg border border-line-control bg-bg text-text focus-within:border-accent';

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

export function Sidebar({
  games,
  groups,
  filters,
  onStatus,
  onChange,
  onPickGame,
}: {
  games: Game[];
  groups: SideGroup[];
  filters: Filters;
  onStatus: (status: StatusFilter) => void;
  onChange: (patch: Partial<Filters>) => void;
  /** Called after a game of the list is picked (closes the drawer on phones). */
  onPickGame: () => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  const statusCounts = countBy(games, (game) => game.status);
  const platformCounts = countBy(games, (game) => game.platform);
  const statuses: StatusFilter[] = ['all', ...MOCK_STATUSES];

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-search`} className={LABEL}>
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
        <span id={`${ids}-show`} className={LABEL}>
          {t('libraryScreen.show')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((status) => {
            const active = filters.status === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => onStatus(status)}
                className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${
                  active
                    ? 'border-accent bg-accent text-accent-text'
                    : 'border-line-control text-soft hover:border-soft'
                }`}
              >
                {t(`libraryScreen.pills.${status}`)}
                <span className="font-medium opacity-75">
                  {status === 'all' ? games.length : (statusCounts.get(status) ?? 0)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2.5">
        <legend className={`${LABEL} mb-2.5`}>{t('libraryScreen.platform')}</legend>
        {PLATFORMS.map((platform: Platform) => (
          <label key={platform} className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="size-4 accent-accent [color-scheme:light]"
              checked={filters.platforms.includes(platform)}
              onChange={() => onChange({ platforms: toggle(filters.platforms, platform) })}
            />
            <span className="flex-1">{t(`libraryScreen.platforms.${platform}`)}</span>
            <span className="text-xs text-muted">{platformCounts.get(platform) ?? 0}</span>
          </label>
        ))}
      </fieldset>

      <div role="group" aria-labelledby={`${ids}-genre`} className="flex flex-col gap-2.5">
        <span id={`${ids}-genre`} className={LABEL}>
          {t('libraryScreen.genre')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {GENRES.map((genre: Genre) => {
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
                {t(`libraryScreen.genres.${genre}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-sort`} className={LABEL}>
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
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-accent [color-scheme:light]"
            checked={filters.hideNeverOpened}
            onChange={(event) => onChange({ hideNeverOpened: event.target.checked })}
          />
          {t('libraryScreen.hideNeverOpened')}
        </label>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-accent [color-scheme:light]"
            checked={filters.onlyAchievements}
            onChange={(event) => onChange({ onlyAchievements: event.target.checked })}
          />
          {t('libraryScreen.onlyAchievements')}
        </label>
      </div>

      <div className="h-px bg-line" />

      <div className="flex flex-col gap-[18px]">
        {groups.map((group) => (
          <section
            key={group.id}
            aria-labelledby={`${ids}-${group.id}`}
            className="flex flex-col gap-0.5"
          >
            <h2 id={`${ids}-${group.id}`} className={`${LABEL} flex justify-between px-1.5 pb-1.5`}>
              <span>{t(`libraryScreen.groups.${group.id}`)}</span>
              <span>{group.games.length}</span>
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.games.map((game) => (
                <li key={game.id}>
                  <a
                    href={`#game-${game.id}`}
                    onClick={onPickGame}
                    className={`flex min-h-9 items-center gap-2.5 rounded-md px-1.5 py-1 text-[13px] font-medium text-text hover:bg-surface ${
                      game.status === 'playing' ? 'bg-selected/50' : ''
                    }`}
                  >
                    <span
                      className="size-6 shrink-0 rounded"
                      style={{ backgroundColor: game.coverColor }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {game.name}
                      <span className="sr-only"> ({t(`libraryScreen.badge.${game.status}`)})</span>
                    </span>
                    <span
                      className={`size-2 shrink-0 rounded-full ${STATUS_DOT[game.status]}`}
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
