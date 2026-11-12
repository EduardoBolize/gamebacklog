import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/index.tsx';
import type { Filters } from './filters.ts';
import { CloseIcon, GridIcon, ListIcon } from './icons.tsx';
import type { Game } from './mock-library.ts';
import {
  GameCover,
  HEADING,
  hoursText,
  LABEL,
  PlatformBadge,
  ProgressBar,
  StatusBadge,
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
  for (const platform of filters.platforms) {
    chips.push({
      key: `platform-${platform}`,
      label: t(`libraryScreen.platforms.${platform}`),
      remove: { platforms: filters.platforms.filter((value) => value !== platform) },
    });
  }
  for (const genre of filters.genres) {
    chips.push({
      key: `genre-${genre}`,
      label: t(`libraryScreen.genres.${genre}`),
      remove: { genres: filters.genres.filter((value) => value !== genre) },
    });
  }
  if (filters.hideNeverOpened) {
    chips.push({
      key: 'never-opened',
      label: t('libraryScreen.chipHideNeverOpened'),
      remove: { hideNeverOpened: false },
    });
  }
  if (filters.onlyAchievements) {
    chips.push({
      key: 'achievements',
      label: t('libraryScreen.chipOnlyAchievements'),
      remove: { onlyAchievements: false },
    });
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

function GameCard({ game }: { game: Game }) {
  const { t } = useI18n();
  return (
    <li id={`game-${game.id}`} className="game-card flex scroll-mt-4 flex-col gap-2">
      <GameCover
        game={game}
        shape="portrait"
        title={
          <span
            aria-hidden="true"
            className="block font-display text-2xl font-bold uppercase leading-[1.02] text-white"
          >
            {game.name}
          </span>
        }
      />
      <div className="flex flex-col gap-1">
        <h3 className="truncate text-sm font-semibold">{game.name}</h3>
        <p className="text-xs text-muted">{hoursText(game, t)}</p>
        {game.status === 'playing' && (
          <ProgressBar
            value={game.progress}
            label={t('libraryScreen.progressOf', { name: game.name })}
            className="h-1 rounded-sm bg-divider"
          />
        )}
      </div>
    </li>
  );
}

function GameList({ games }: { games: Game[] }) {
  const { t } = useI18n();
  const cell = 'px-3 py-2 text-left';
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line">
      <table className="w-full min-w-[520px] border-collapse">
        <thead className={`${LABEL} bg-surface`}>
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
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <tr key={game.id} id={`game-${game.id}`} className="border-t border-divider">
              <th scope="row" className={`${cell} font-semibold`}>
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="size-6 shrink-0 rounded"
                    style={{ backgroundColor: game.coverColor }}
                  />
                  {game.name}
                </span>
              </th>
              <td className={cell}>
                <StatusBadge status={game.status} />
              </td>
              <td className={cell}>
                <PlatformBadge game={game} />
              </td>
              <td className={`${cell} text-xs text-muted`}>{hoursText(game, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LibrarySection({
  title,
  games,
  filters,
  view,
  onView,
  onChange,
  onClear,
}: {
  title: string;
  games: Game[];
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
            {tn('libraryScreen.showing', games.length)}
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
          <span className={LABEL}>{t('libraryScreen.activeFilters')}</span>
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

      {games.length === 0 ? (
        <p className="py-8 text-muted">{t('libraryScreen.empty')}</p>
      ) : view === 'grid' ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(168px,100%),1fr))] gap-x-[18px] gap-y-[22px]">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </ul>
      ) : (
        <GameList games={games} />
      )}
    </section>
  );
}
