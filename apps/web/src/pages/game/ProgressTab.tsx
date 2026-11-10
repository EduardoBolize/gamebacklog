import {
  PLAYTHROUGH_STATUSES,
  type Playthrough,
  type PlaythroughStatus,
} from '@gamebacklog/shared';
import { api, useApiMutation, useFunnel, useProgress } from '../../api.ts';
import { ErrorNote, Loading, PercentBar } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';

interface Props {
  run: Playthrough;
  /** Where the time-to-beat figures came from, to cite the right source. */
  timesOrigin: 'hltb' | 'manual' | null;
  canDeleteRun: boolean;
  onFixMilestones: () => void;
  onRunDeleted: () => void;
}

export function ProgressTab({
  run,
  timesOrigin,
  canDeleteRun,
  onFixMilestones,
  onRunDeleted,
}: Props) {
  const { t, formatMinutes, formatNumber, formatDate } = useI18n();
  const funnel = useFunnel(run.id);
  const progress = useProgress(run.id);
  const update = useApiMutation((body: Parameters<typeof api.updatePlaythrough>[1]) =>
    api.updatePlaythrough(run.id, body),
  );
  const remove = useApiMutation(() => api.deletePlaythrough(run.id));

  if (funnel.isPending || progress.isPending) return <Loading />;
  if (funnel.isError) return <ErrorNote error={funnel.error} />;
  if (progress.isError) return <ErrorNote error={progress.error} />;

  const data = funnel.data;
  const goal = run.goal === 'finish' ? t('progress.goalFinish') : t('progress.goalComplete');
  const basis = data.remainingBasis === 'completionist' ? t('game.completionist') : t('game.main');

  return (
    <div className="grid gap-8">
      <section className="grid gap-1">
        {data.available && data.percentFinished !== null && (
          <p className="text-lg">
            {data.currentMilestoneId === data.finalMilestoneId
              ? t('progress.funnelDone')
              : t('progress.funnelFinished', { percent: formatNumber(data.percentFinished, 0) })}
          </p>
        )}
        {!data.available && (
          <p className="text-muted">
            {data.reason === 'no_story_achievements'
              ? t('progress.noStory')
              : data.reason === 'no_position'
                ? t('progress.noPosition')
                : t('progress.noAchievements')}
          </p>
        )}
        {data.remainingMinutes !== null && (
          <p className="text-muted">
            {data.remainingMinutes > 0
              ? t('progress.remaining', {
                  time: formatMinutes(data.remainingMinutes),
                  goal,
                  source: timesOrigin === 'manual' ? t('game.manualTimes') : 'HowLongToBeat',
                  basis,
                })
              : t('progress.remainingNone', { goal })}
          </p>
        )}
      </section>

      {data.milestones.length > 0 && (
        <section className="grid gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="section-title">{t('progress.milestones')}</h2>
            <span className="note">{t('progress.percentOfPlayers')}</span>
          </div>
          <ol className="grid gap-2">
            {data.milestones.map((milestone) => {
              const isCurrent = milestone.achievementId === data.currentMilestoneId;
              return (
                <li
                  key={milestone.achievementId}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(4rem,10rem)_3.5rem] items-center gap-3 text-sm"
                >
                  <span aria-hidden="true">{milestone.isUnlocked ? '✓' : ''}</span>
                  <span className={`truncate ${isCurrent ? 'font-semibold' : ''}`}>
                    {milestone.name}
                    {isCurrent && (
                      <span className="ml-2 text-accent">← {t('progress.youAreHere')}</span>
                    )}
                  </span>
                  <PercentBar value={milestone.globalPercent} />
                  <span className="text-right tabular-nums">
                    {formatNumber(milestone.globalPercent)}%
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="note">
            {t('progress.detected')}{' '}
            <button type="button" className="btn-quiet" onClick={onFixMilestones}>
              {t('progress.fix')}
            </button>
          </p>
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="section-title">{t('progress.history')}</h2>
        {progress.data.items.length === 0 ? (
          <p className="note">{t('progress.noHistory')}</p>
        ) : (
          <ul className="grid gap-2">
            {progress.data.items.map((event) => (
              <li key={event.id} className="grid grid-cols-[5.5rem_1fr] gap-3 text-sm">
                <time dateTime={event.occurredAt} className="text-muted tabular-nums">
                  {formatDate(event.occurredAt)}
                </time>
                <span>{event.rawText}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="section-title">{t('progress.run')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label>
            <span className="label">{t('progress.started')}</span>
            <input
              type="date"
              className="field"
              defaultValue={run.startedOn ?? ''}
              key={`start-${run.startedOn}`}
              onBlur={(event) => {
                const value = event.target.value || null;
                if (value !== run.startedOn) update.mutate({ startedOn: value });
              }}
            />
          </label>
          <label>
            <span className="label">{t('progress.finished')}</span>
            <input
              type="date"
              className="field"
              defaultValue={run.finishedOn ?? ''}
              key={`end-${run.finishedOn}`}
              onBlur={(event) => {
                const value = event.target.value || null;
                if (value !== run.finishedOn) update.mutate({ finishedOn: value });
              }}
            />
          </label>
          <label>
            <span className="label">{t('progress.hours')}</span>
            <input
              type="number"
              min={0}
              step={0.5}
              className="field"
              defaultValue={run.playtimeMinutes === null ? '' : run.playtimeMinutes / 60}
              key={`hours-${run.playtimeMinutes}`}
              onBlur={(event) => {
                const value =
                  event.target.value === '' ? null : Math.round(Number(event.target.value) * 60);
                if (value !== run.playtimeMinutes) update.mutate({ playtimeMinutes: value });
              }}
            />
          </label>
          <label>
            <span className="label">{t('progress.runStatus')}</span>
            <select
              className="field"
              value={run.status}
              onChange={(event) =>
                update.mutate({ status: event.target.value as PlaythroughStatus })
              }
            >
              {PLAYTHROUGH_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`runStatus.${status}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorNote error={update.error ?? remove.error} />
        {canDeleteRun && (
          <button
            type="button"
            className="btn-quiet justify-self-start text-danger"
            onClick={() => {
              if (window.confirm(t('progress.confirmDeleteRun'))) {
                remove.mutate(undefined, { onSuccess: onRunDeleted });
              }
            }}
          >
            {t('progress.deleteRun')}
          </button>
        )}
      </section>
    </div>
  );
}
