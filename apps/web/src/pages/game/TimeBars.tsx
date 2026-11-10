import type { GameTimes, Playthrough } from '@gamebacklog/shared';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, useApiMutation } from '../../api.ts';
import { ErrorNote } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';

const ROWS = [
  { key: 'mainMinutes', label: 'game.main' },
  { key: 'mainExtraMinutes', label: 'game.mainExtra' },
  { key: 'completionistMinutes', label: 'game.completionist' },
] as const;

const toHours = (minutes: number | null) => (minutes === null ? '' : String(minutes / 60));
const toMinutes = (hours: string) => (hours.trim() === '' ? null : Math.round(Number(hours) * 60));

function TimesForm({
  entryId,
  times,
  onDone,
}: {
  entryId: string;
  times: GameTimes | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState({
    mainMinutes: toHours(times?.mainMinutes ?? null),
    mainExtraMinutes: toHours(times?.mainExtraMinutes ?? null),
    completionistMinutes: toHours(times?.completionistMinutes ?? null),
  });
  const save = useApiMutation((body: Parameters<typeof api.setTimes>[1]) =>
    api.setTimes(entryId, body),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      {
        mainMinutes: toMinutes(values.mainMinutes),
        mainExtraMinutes: toMinutes(values.mainExtraMinutes),
        completionistMinutes: toMinutes(values.completionistMinutes),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {ROWS.map((row) => (
          <label key={row.key}>
            <span className="label">
              {t(row.label)} ({t('game.hours')})
            </span>
            <input
              className="field"
              type="number"
              min={0}
              step={0.5}
              value={values[row.key]}
              onChange={(event) => setValues({ ...values, [row.key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t('app.save')}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t('app.cancel')}
        </button>
        {times?.origin === 'manual' && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() =>
              save.mutate(
                { mainMinutes: null, mainExtraMinutes: null, completionistMinutes: null },
                { onSuccess: onDone },
              )
            }
          >
            {t('game.useHltb')}
          </button>
        )}
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}

/**
 * The three time-to-beat figures as bars on one scale, with a mark at the player's own hours.
 * The page never waits for HowLongToBeat: the lookup runs after the page is up, and when it
 * fails the user can type the times in.
 */
export function TimeBars({
  entryId,
  times,
  run,
}: {
  entryId: string;
  times: GameTimes | null;
  run: Playthrough;
}) {
  const { t, formatMinutes, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const refresh = useApiMutation(() => api.refreshTimes(entryId));
  const asked = useRef(false);
  const mutateRefresh = refresh.mutate;

  useEffect(() => {
    if (times || asked.current) return;
    asked.current = true;
    mutateRefresh(undefined);
  }, [times, mutateRefresh]);

  const played = run.playtimeMinutes ?? 0;
  const longest = Math.max(...ROWS.map((row) => times?.[row.key] ?? 0), 1);
  const goalRow = run.goal === 'finish' ? 'mainMinutes' : 'completionistMinutes';

  return (
    <section aria-labelledby="time-title" className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="time-title" className="section-title">
          {t('game.timeTitle')}
        </h2>
        {played > 0 && (
          <span className="note">{t('game.youThisRun', { time: formatMinutes(played) })}</span>
        )}
      </div>

      {editing ? (
        <TimesForm entryId={entryId} times={times} onDone={() => setEditing(false)} />
      ) : times ? (
        <>
          <dl className="grid gap-2">
            {ROWS.map((row) => {
              const minutes = times[row.key];
              if (minutes === null) return null;
              const over = played - minutes;
              return (
                <div
                  key={row.key}
                  className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3 text-sm"
                >
                  <dt className={row.key === goalRow ? 'font-semibold' : 'text-muted'}>
                    {t(row.label)}
                  </dt>
                  <dd className="contents">
                    <span aria-hidden="true" className="block">
                      <span
                        className="block h-2.5 rounded-sm bg-surface"
                        style={{ width: `${Math.max((minutes / longest) * 100, 4)}%` }}
                      >
                        <span
                          className={`block h-full rounded-sm bg-line ${played > 0 ? 'border-r-2 border-accent' : ''}`}
                          style={{ width: `${Math.min(played / minutes, 1) * 100}%` }}
                        />
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatMinutes(minutes)}
                      {over > 0 && (
                        <span className="text-muted">
                          {' '}
                          · {t('game.overBy', { time: formatMinutes(over) })}
                        </span>
                      )}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="note">
            {times.origin === 'manual' ? (
              t('game.manualTimes')
            ) : (
              <>
                {times.originUrl ? (
                  <a href={times.originUrl} target="_blank" rel="noreferrer" className="link">
                    HowLongToBeat
                  </a>
                ) : (
                  'HowLongToBeat'
                )}
                {times.fetchedAt &&
                  ` · ${t('app.collectedOn', { date: formatDate(times.fetchedAt) })}`}
              </>
            )}
            {' · '}
            <button type="button" className="btn-quiet" onClick={() => setEditing(true)}>
              {t('game.editTimes')}
            </button>
          </p>
        </>
      ) : (
        <div className="grid justify-items-start gap-2" aria-live="polite">
          <p className="note">
            {refresh.isPending
              ? t('game.fetchingTimes')
              : refresh.data?.sourceFailed
                ? t('game.timesFailed')
                : refresh.isSuccess
                  ? t('game.timesNotFound')
                  : t('game.noTimes')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              {t('game.enterTimes')}
            </button>
            {!refresh.isPending && (
              <button type="button" className="btn-quiet" onClick={() => refresh.mutate(undefined)}>
                {t('game.fetchTimes')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
