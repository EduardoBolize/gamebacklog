import type { Achievement, Playthrough } from '@gamebacklog/shared';
import { useState } from 'react';
import { api, useAchievements, useApiMutation, useSources } from '../../api.ts';
import { ErrorNote, Loading, PercentBar } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { AreaChecklist } from './AreaChecklist.tsx';

export const ACHIEVEMENT_FILTERS = ['all', 'missing', 'story', 'missable'] as const;
export type AchievementFilter = (typeof ACHIEVEMENT_FILTERS)[number];

const matches: Record<AchievementFilter, (item: Achievement) => boolean> = {
  all: () => true,
  missing: (item) => !item.isUnlocked,
  story: (item) => item.isStory,
  missable: (item) => item.isMissable,
};

function AchievementRow({ item, runId }: { item: Achievement; runId: string }) {
  const { t, formatNumber, formatDate } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const unlock = useApiMutation((isUnlocked: boolean) =>
    api.setAchievementUnlocked(runId, item.id, isUnlocked),
  );
  const classify = useApiMutation((body: Parameters<typeof api.classifyAchievement>[1]) =>
    api.classifyAchievement(item.id, body),
  );
  const concealed = item.isHidden && !item.isUnlocked && !revealed;
  const tags = [
    item.isStory && t('achievements.tagStory'),
    item.isMissable && t('achievements.tagMissable'),
    item.isNgPlus && t('achievements.tagNgPlus'),
  ].filter(Boolean);

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line py-3 sm:grid-cols-[auto_minmax(0,1fr)_9rem]">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 accent-accent"
        aria-label={t('achievements.markUnlocked', {
          name: concealed ? t('achievements.hidden') : item.name,
        })}
        checked={item.isUnlocked}
        disabled={unlock.isPending}
        onChange={(event) => unlock.mutate(event.target.checked)}
      />
      <div className="min-w-0">
        <p className="font-medium">
          {concealed ? t('achievements.hidden') : item.name}
          {tags.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted">{tags.join(' · ')}</span>
          )}
        </p>
        {concealed ? (
          <button type="button" className="btn-quiet" onClick={() => setRevealed(true)}>
            {t('achievements.showDescription')}
          </button>
        ) : (
          item.description && <p className="note">{item.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {item.unlockedAt && (
            <time dateTime={item.unlockedAt} className="note tabular-nums">
              {formatDate(item.unlockedAt)}
            </time>
          )}
          <details className="relative">
            <summary
              className="note list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden"
              aria-label={t('achievements.classifyOf', {
                name: concealed ? t('achievements.hidden') : item.name,
              })}
            >
              {t('achievements.classify')}
            </summary>
            <div className="absolute left-0 z-10 mt-1 grid w-52 gap-1 rounded-base border border-line bg-bg p-3">
              {(
                [
                  ['isStory', 'achievements.isStory'],
                  ['isMissable', 'achievements.isMissable'],
                  ['isNgPlus', 'achievements.isNgPlus'],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={item[field]}
                    onChange={(event) => classify.mutate({ [field]: event.target.checked })}
                  />
                  {t(label)}
                </label>
              ))}
            </div>
          </details>
        </div>
        <ErrorNote error={unlock.error ?? classify.error} />
      </div>
      {item.globalPercent !== null && (
        <div className="col-start-2 grid content-start gap-1 sm:col-start-3">
          <span className="text-sm tabular-nums sm:text-right">
            {t('achievements.globalPercent', { percent: formatNumber(item.globalPercent) })}
          </span>
          <PercentBar value={item.globalPercent} />
        </div>
      )}
    </li>
  );
}

/**
 * For retro games: ties the game to its page on RetroAchievements, so its achievements can be
 * synced like any other. Only offered when RetroAchievements is connected.
 */
function RetroLink({ entryId }: { entryId: string }) {
  const { t } = useI18n();
  const sources = useSources();
  const [game, setGame] = useState('');
  const link = useApiMutation(() => api.linkRetroGame(entryId, game.trim()));
  const connected = sources.data?.items.some(
    (item) => item.id === 'retroachievements' && item.configured,
  );
  if (!connected) return null;

  return (
    <form
      className="grid max-w-prose gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (game.trim()) link.mutate(undefined);
      }}
    >
      <label>
        <span className="label">{t('achievements.retroLabel')}</span>
        <input
          className="field"
          placeholder="https://retroachievements.org/game/1"
          value={game}
          onChange={(event) => setGame(event.target.value)}
        />
      </label>
      <p className="note">{t('achievements.retroHelp')}</p>
      <button type="submit" className="btn justify-self-start" disabled={link.isPending}>
        {t('achievements.retroLink')}
      </button>
      <ErrorNote error={link.error} />
    </form>
  );
}

export function AchievementsTab({
  entryId,
  run,
  filter,
  onFilter,
}: {
  entryId: string;
  run: Playthrough;
  filter: AchievementFilter;
  onFilter: (filter: AchievementFilter) => void;
}) {
  const { t, formatDateTime, formatNumber } = useI18n();
  const runId = run.id;
  const achievements = useAchievements(runId);
  const sync = useApiMutation(() => api.syncAchievements(entryId));

  if (achievements.isPending) return <Loading />;
  if (achievements.isError) return <ErrorNote error={achievements.error} />;

  const { items, syncSource, syncedAt } = achievements.data;
  const sourceName = syncSource ? t(`sourceName.${syncSource}`) : '';
  if (!syncSource && items.length === 0) {
    return (
      <div className="grid gap-6">
        <AreaChecklist key={run.id} run={run} />
        <p className="text-muted">{t('achievements.noSteam')}</p>
        <RetroLink entryId={entryId} />
      </div>
    );
  }

  const unlocked = items.filter((item) => item.isUnlocked).length;
  const visible = items.filter(matches[filter]);

  return (
    <div className="grid gap-4">
      <AreaChecklist key={run.id} run={run} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-lg">
          {items.length > 0 &&
            t('achievements.summary', {
              unlocked,
              total: items.length,
              percent: formatNumber((unlocked / items.length) * 100, 0),
            })}
        </p>
        {syncSource && (
          <p className="note">
            {syncedAt
              ? t('achievements.syncedAt', { source: sourceName, date: formatDateTime(syncedAt) })
              : t('achievements.neverSynced', { source: sourceName })}
            {' · '}
            <button
              type="button"
              className="btn-quiet"
              disabled={sync.isPending}
              onClick={() => sync.mutate(undefined)}
            >
              {sync.isPending ? t('achievements.syncing') : t('achievements.sync')}
            </button>
          </p>
        )}
      </div>

      <ErrorNote error={sync.error} />
      {sync.data?.playerDataAvailable === false && (
        <p className="text-sm" role="status">
          {t('achievements.privateProfile')}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-muted">{t('achievements.empty')}</p>
      ) : (
        <>
          <div
            role="group"
            aria-label={t('achievements.filter')}
            className="flex flex-wrap gap-x-5"
          >
            {ACHIEVEMENT_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => onFilter(option)}
                className={`min-h-11 cursor-pointer border-b-2 text-sm sm:min-h-8 ${
                  filter === option
                    ? 'border-accent font-semibold'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {t(`achievements.${option}`)}{' '}
                <span className="tabular-nums">{items.filter(matches[option]).length}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="note">{t('achievements.emptyFilter')}</p>
          ) : (
            <ul className="border-t border-line">
              {visible.map((item) => (
                <AchievementRow key={item.id} item={item} runId={runId} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
