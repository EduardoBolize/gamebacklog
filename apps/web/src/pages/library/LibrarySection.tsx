import { LIBRARY_STATUSES, type LibraryItem, type LibraryStatus } from '@gamebacklog/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { api, useApiMutation } from '../../api.ts';
import { CloseIcon, GridIcon, ListIcon, MoreIcon, StarIcon } from '../../components/icons.tsx';
import { ErrorNote } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import type { Filters } from './filters.ts';
import {
  HEADING,
  PlatformBadge,
  PortraitCover,
  ProgressBar,
  StatusBadge,
  timeText,
} from './parts.tsx';

export type View = 'grid' | 'list';

interface Chip {
  key: string;
  label: string;
  remove: Partial<Filters>;
}

function useActiveChips(filters: Filters): Chip[] {
  const { t } = useI18n();
  const chips: Chip[] = [];
  const query = filters.query.trim();
  if (query) {
    chips.push({
      key: 'query',
      label: t('libraryScreen.chipSearch', { query }),
      remove: { query: '' },
    });
  }
  for (const family of filters.families) {
    chips.push({
      key: `platform-${family}`,
      label: t(`libraryScreen.families.${family}`),
      remove: { families: filters.families.filter((value) => value !== family) },
    });
  }
  for (const genre of filters.genres) {
    chips.push({
      key: `genre-${genre}`,
      label: genre,
      remove: { genres: filters.genres.filter((value) => value !== genre) },
    });
  }
  const toggles = [
    ['hideNeverOpened', 'libraryScreen.chipHideNeverOpened'],
    ['onlyAchievements', 'libraryScreen.chipOnlyAchievements'],
    ['onlyFavorites', 'libraryScreen.chipOnlyFavorites'],
  ] as const;
  for (const [key, label] of toggles) {
    if (filters[key]) chips.push({ key, label: t(label), remove: { [key]: false } });
  }
  return chips;
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex size-10 cursor-pointer items-center justify-center rounded-md border ${
        active
          ? 'border-accent bg-selected text-text'
          : 'border-line-control text-soft hover:border-soft'
      }`}
    >
      {children}
    </button>
  );
}

/** Status, favourite and removal, without leaving the library. */
function GameMenu({ item }: { item: LibraryItem }) {
  const { t } = useI18n();
  const update = useApiMutation((body: Parameters<typeof api.updateEntry>[1]) =>
    api.updateEntry(item.id, body),
  );
  const remove = useApiMutation(() => api.removeEntry(item.id));

  return (
    <details className="relative shrink-0">
      <summary
        aria-label={t('library.options', { title: item.game.title })}
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-muted hover:bg-surface hover:text-text [&::-webkit-details-marker]:hidden"
      >
        <MoreIcon />
      </summary>
      <div className="absolute right-0 z-20 mt-1 grid w-48 gap-2 rounded-lg border border-line bg-sidebar p-3 shadow-xl">
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
  );
}

function GameCard({ item }: { item: LibraryItem }) {
  const { t } = useI18n();
  return (
    <li className="game-card flex flex-col gap-2">
      {/* Cover and name are one link to the game's screen. */}
      <Link to={`/games/${item.id}`} className="group flex flex-col gap-2 rounded-lg">
        <span className="block transition-transform duration-150 group-hover:-translate-y-0.5">
          <PortraitCover item={item} />
        </span>
        <h3 className="truncate text-sm font-semibold group-hover:underline">
          {item.isFavorite && (
            <span className="mr-1 inline-block align-[-1px] text-accent">
              <StarIcon />
              <span className="sr-only">{t('libraryScreen.favorite')}: </span>
            </span>
          )}
          {item.game.title}
        </h3>
      </Link>
      <div className="-mt-1 flex items-start justify-between gap-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs text-muted">{timeText(item, t)}</p>
          {item.status === 'playing' && item.progressPercent !== null && (
            <ProgressBar
              value={item.progressPercent}
              label={t('libraryScreen.progressOf', { name: item.game.title })}
              className="h-1 rounded-sm bg-divider"
            />
          )}
        </div>
        <GameMenu item={item} />
      </div>
    </li>
  );
}

function GameList({ items }: { items: LibraryItem[] }) {
  const { t } = useI18n();
  const cell = 'px-3 py-2 text-left';
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line">
      <table className="w-full min-w-[560px] border-collapse">
        <thead className="eyebrow bg-surface">
          <tr>
            <th scope="col" className={cell}>
              {t('libraryScreen.listName')}
            </th>
            <th scope="col" className={cell}>
              {t('libraryScreen.listStatus')}
            </th>
            <th scope="col" className={cell}>
              {t('libraryScreen.listPlatform')}
            </th>
            <th scope="col" className={cell}>
              {t('libraryScreen.listTime')}
            </th>
            <th scope="col" className={cell}>
              <span className="sr-only">{t('library.changeStatus')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-divider">
              <th scope="row" className={`${cell} font-semibold`}>
                <Link
                  to={`/games/${item.id}`}
                  className="flex items-center gap-2.5 hover:underline"
                >
                  {item.game.coverUrl ? (
                    <img
                      src={item.game.coverUrl}
                      alt=""
                      loading="lazy"
                      className="h-10 w-7 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span aria-hidden="true" className="h-10 w-7 shrink-0 rounded bg-selected" />
                  )}
                  {item.game.title}
                </Link>
              </th>
              <td className={cell}>
                <StatusBadge status={item.status} />
              </td>
              <td className={cell}>
                <PlatformBadge item={item} />
              </td>
              <td className={`${cell} text-xs text-muted`}>{timeText(item, t)}</td>
              <td className={`${cell} w-10`}>
                <GameMenu item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LibrarySection({
  title,
  items,
  filters,
  view,
  onView,
  onChange,
  onClear,
}: {
  title: string;
  items: LibraryItem[];
  filters: Filters;
  view: View;
  onView: (view: View) => void;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const { t, tn } = useI18n();
  const chips = useActiveChips(filters);

  return (
    <section id="library" aria-labelledby="library-title" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id="library-title" className={HEADING}>
            {title}
          </h2>
          <p className="text-[13px] text-muted" aria-live="polite">
            {tn('libraryScreen.showing', items.length)}
          </p>
        </div>
        <div className="flex gap-1.5">
          <ViewButton
            active={view === 'grid'}
            label={t('libraryScreen.viewGrid')}
            onClick={() => onView('grid')}
          >
            <GridIcon />
          </ViewButton>
          <ViewButton
            active={view === 'list'}
            label={t('libraryScreen.viewList')}
            onClick={() => onView('list')}
          >
            <ListIcon />
          </ViewButton>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">{t('libraryScreen.activeFilters')}</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-label={t('libraryScreen.removeFilter', { name: chip.label })}
              onClick={() => onChange(chip.remove)}
              className="flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-full border border-line-control bg-surface px-2.5 text-xs font-medium text-text hover:border-soft"
            >
              {chip.label}
              <CloseIcon />
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="min-h-[30px] cursor-pointer px-1.5 text-xs font-semibold text-accent hover:text-accent-hover"
          >
            {t('libraryScreen.clearFilters')}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="py-8 text-muted">{t('libraryScreen.empty')}</p>
      ) : view === 'grid' ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(168px,100%),1fr))] gap-x-[18px] gap-y-[22px]">
          {items.map((item) => (
            <GameCard key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <GameList items={items} />
      )}
    </section>
  );
}
