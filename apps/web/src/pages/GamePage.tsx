import {
  LIBRARY_STATUSES,
  PLAYTHROUGH_GOALS,
  PLAYTHROUGH_TYPES,
  type GameDetailResponse,
  type LibraryStatus,
  type Playthrough,
  type PlaythroughGoal,
  type PlaythroughType,
} from '@gamebacklog/shared';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError, api, useApiMutation, useGame } from '../api.ts';
import { ChipInput, Cover, ErrorNote, Loading, Modal } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import {
  ACHIEVEMENT_FILTERS,
  AchievementsTab,
  type AchievementFilter,
} from './game/AchievementsTab.tsx';
import { AssistBanner } from './game/AssistBanner.tsx';
import { DiaryTab } from './game/DiaryTab.tsx';
import { HintsTab } from './game/HintsTab.tsx';
import { ProgressTab } from './game/ProgressTab.tsx';
import { ReviewTab } from './game/ReviewTab.tsx';
import { SimilarTab } from './game/SimilarTab.tsx';
import { TimeBars } from './game/TimeBars.tsx';
import { WhereAmI } from './game/WhereAmI.tsx';

const TABS = ['progress', 'hints', 'achievements', 'diary', 'review', 'similar'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL = {
  progress: 'game.tabProgress',
  hints: 'game.tabHints',
  achievements: 'game.tabAchievements',
  diary: 'game.tabDiary',
  review: 'game.tabReview',
  similar: 'game.tabSimilar',
} as const;

function useRunLabel() {
  const { t } = useI18n();
  return (run: Playthrough) => {
    const name =
      run.label ??
      (run.type === 'normal' && run.number === 1 ? t('game.firstRun') : t(`runType.${run.type}`));
    return `${run.number} · ${name}`;
  };
}

function NewRunForm({
  entryId,
  onCreated,
}: {
  entryId: string;
  onCreated: (runId: string) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<PlaythroughType>('ng_plus');
  const [label, setLabel] = useState('');
  const [goal, setGoal] = useState<PlaythroughGoal>('finish');
  const create = useApiMutation((body: Parameters<typeof api.createPlaythrough>[1]) =>
    api.createPlaythrough(entryId, body),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { type, goal, label: label.trim() || undefined },
      { onSuccess: (created) => onCreated(created.id) },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label>
        <span className="label">{t('game.playthroughType')}</span>
        <select
          className="field"
          value={type}
          onChange={(event) => setType(event.target.value as PlaythroughType)}
        >
          {PLAYTHROUGH_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`runType.${option}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">{t('game.goal')}</span>
        <select
          className="field"
          value={goal}
          onChange={(event) => setGoal(event.target.value as PlaythroughGoal)}
        >
          {PLAYTHROUGH_GOALS.map((option) => (
            <option key={option} value={option}>
              {t(`goal.${option}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="sm:col-span-2">
        <span className="label">
          {t('game.playthroughLabel')} ({t('app.optional')})
        </span>
        <input
          className="field"
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {t('game.create')}
        </button>
      </div>
      <div className="sm:col-span-2">
        <ErrorNote error={create.error} />
      </div>
    </form>
  );
}

function GameView({ detail }: { detail: GameDetailResponse }) {
  const { t, formatDate } = useI18n();
  const runLabel = useRunLabel();
  const [params, setParams] = useSearchParams();
  const [creatingRun, setCreatingRun] = useState(false);
  const [platformDraft, setPlatformDraft] = useState<string | null>(null);
  const platformListId = useId();
  const { entry, game, playthroughs, times } = detail;

  const update = useApiMutation((body: Parameters<typeof api.updateEntry>[1]) =>
    api.updateEntry(entry.id, body),
  );
  const updateRun = useApiMutation(
    ({ runId, ...body }: Parameters<typeof api.updatePlaythrough>[1] & { runId: string }) =>
      api.updatePlaythrough(runId, body),
  );

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

  // The run in progress is the one the user most likely wants to see.
  const run =
    playthroughs.find((candidate) => candidate.id === params.get('run')) ??
    playthroughs.findLast((candidate) => candidate.status === 'playing') ??
    playthroughs.at(-1);
  const tab: Tab = TABS.find((option) => option === params.get('tab')) ?? 'progress';
  const achievementFilter: AchievementFilter =
    ACHIEVEMENT_FILTERS.find((option) => option === params.get('filter')) ?? 'all';

  if (!run) return null;

  const meta = [game.releaseYear, game.genres.slice(0, 3).join(', ')].filter(Boolean).join(' · ');

  return (
    <div className="grid gap-8">
      <Link to="/" className="btn-quiet justify-self-start">
        ← {t('app.backToLibrary')}
      </Link>

      <header className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-6">
        <div className="sm:row-span-2">
          <Cover title={game.title} url={game.coverUrl} />
        </div>

        <div className="grid content-start gap-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h1 className="text-2xl leading-tight sm:text-3xl">{game.title}</h1>
            <button
              type="button"
              className="btn-quiet"
              aria-pressed={entry.isFavorite}
              onClick={() => update.mutate({ isFavorite: !entry.isFavorite })}
            >
              {entry.isFavorite ? `★ ${t('game.favorited')}` : `☆ ${t('game.favorite')}`}
            </button>
          </div>
          <p className="note">
            {meta}
            {meta && ' · '}
            {game.originUrl ? (
              <a href={game.originUrl} target="_blank" rel="noreferrer" className="link">
                {t('app.source', { source: t(`sourceName.${game.origin}`) })}
              </a>
            ) : (
              t('app.source', { source: t(`sourceName.${game.origin}`) })
            )}
            {game.fetchedAt && ` · ${t('app.collectedOn', { date: formatDate(game.fetchedAt) })}`}
          </p>
        </div>

        <div className="col-span-2 grid content-start gap-3 sm:col-span-1">
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="label">{t('game.status')}</span>
              <select
                className="field"
                value={entry.status}
                onChange={(event) => update.mutate({ status: event.target.value as LibraryStatus })}
              >
                {LIBRARY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t('game.platform')}</span>
              <input
                className="field"
                list={platformListId}
                maxLength={80}
                placeholder={t('game.platformPlaceholder')}
                value={platformDraft ?? entry.platform ?? ''}
                onChange={(event) => setPlatformDraft(event.target.value)}
                onBlur={() => {
                  if (platformDraft === null) return;
                  const value = platformDraft.trim() || null;
                  if (value !== entry.platform) update.mutate({ platform: value });
                  setPlatformDraft(null);
                }}
              />
              <datalist id={platformListId}>
                {game.platforms.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label>
              <span className="label">{t('game.playthrough')}</span>
              <select
                className="field"
                value={run.id}
                onChange={(event) => setParam('run', event.target.value)}
              >
                {playthroughs.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {runLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => setCreatingRun(true)}>
              + {t('game.newPlaythrough')}
            </button>
            <label>
              <span className="label">{t('game.goal')}</span>
              <select
                className="field"
                value={run.goal}
                onChange={(event) =>
                  updateRun.mutate({ runId: run.id, goal: event.target.value as PlaythroughGoal })
                }
              >
                {PLAYTHROUGH_GOALS.map((goal) => (
                  <option key={goal} value={goal}>
                    {t(`goal.${goal}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ChipInput
            label={t('game.tags')}
            values={entry.tags}
            placeholder={t('game.addTag')}
            removeLabel={(tag) => t('game.removeTag', { tag })}
            onChange={(tags) => update.mutate({ tags })}
          />
          <ErrorNote error={update.error ?? updateRun.error} />
        </div>
      </header>

      <TimeBars key={entry.id} entryId={entry.id} times={times} run={run} />
      <WhereAmI key={run.id} run={run} />
      <AssistBanner
        key={`assist-${run.id}`}
        runId={run.id}
        onQuestion={(question) => {
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set('tab', question.kind === 'boss_hint' ? 'hints' : 'achievements');
              if (question.kind === 'boss_hint') next.set('hint', 'boss');
              return next;
            },
            { replace: true },
          );
        }}
      />

      <div className="grid gap-5">
        <nav
          aria-label={t('game.tabs')}
          className="-mx-4 overflow-x-auto overflow-y-hidden border-b border-line px-4"
        >
          <ul className="flex gap-6 whitespace-nowrap">
            {TABS.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  aria-current={tab === option ? 'page' : undefined}
                  onClick={() => setParam('tab', option === 'progress' ? '' : option)}
                  className={`-mb-px min-h-11 cursor-pointer border-b-2 text-sm ${
                    tab === option
                      ? 'border-accent font-semibold'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {t(TAB_LABEL[option])}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {tab === 'progress' && (
          <ProgressTab
            key={run.id}
            entryId={entry.id}
            run={run}
            timesOrigin={times?.origin ?? null}
            canDeleteRun={playthroughs.length > 1}
            onRunDeleted={() => setParam('run', '')}
            onFixMilestones={() => {
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.set('tab', 'achievements');
                  next.set('filter', 'story');
                  return next;
                },
                { replace: true },
              );
            }}
          />
        )}
        {tab === 'hints' && (
          <HintsTab
            key={run.id}
            runId={run.id}
            initialKind={params.get('hint') === 'boss' ? 'boss' : 'general'}
          />
        )}
        {tab === 'achievements' && (
          <AchievementsTab
            entryId={entry.id}
            run={run}
            filter={achievementFilter}
            onFilter={(filter) => setParam('filter', filter === 'all' ? '' : filter)}
          />
        )}
        {tab === 'diary' && <DiaryTab entryId={entry.id} run={run} />}
        {tab === 'review' && <ReviewTab key={run.id} entryId={entry.id} run={run} />}
        {tab === 'similar' && (
          <SimilarTab
            entryId={entry.id}
            onOpenAchievements={() => setParam('tab', 'achievements')}
          />
        )}
      </div>

      <Modal
        open={creatingRun}
        onClose={() => setCreatingRun(false)}
        title={t('game.newPlaythroughTitle')}
      >
        <NewRunForm
          entryId={entry.id}
          onCreated={(runId) => {
            setCreatingRun(false);
            setParam('run', runId);
          }}
        />
      </Modal>
    </div>
  );
}

export function GamePage() {
  const { t } = useI18n();
  const { entryId = '' } = useParams();
  const game = useGame(entryId);

  if (game.isPending) return <Loading />;
  if (game.isError) {
    const missing = game.error instanceof ApiError && game.error.status === 404;
    return (
      <div className="grid justify-items-start gap-3 py-12">
        {missing ? <p>{t('game.notInLibrary')}</p> : <ErrorNote error={game.error} />}
        <Link to="/" className="link">
          {t('app.backToLibrary')}
        </Link>
      </div>
    );
  }
  return <GameView key={game.data.entry.id} detail={game.data} />;
}
