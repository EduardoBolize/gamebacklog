import { REVIEW_SUBSCORE_KEYS, statsResponseSchema, type StatsResponse } from '@gamebacklog/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { request } from '../api.ts';
import { ErrorNote, Loading } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

const useStats = () =>
  useQuery({
    queryKey: ['stats'],
    queryFn: () => request('GET', '/api/stats', statsResponseSchema),
  });

/** A headline number. Not a chart: one value, said plainly. */
function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid content-start gap-1 rounded-base border border-line p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="note">{note}</dd>}
    </div>
  );
}

interface Bar {
  key: string;
  label: ReactNode;
  /** Plain-text label, for the tooltip. */
  name: string;
  value: number;
  text: string;
}

/**
 * Horizontal bars for comparing magnitudes: one hue, every value written next to its bar, so
 * the list reads as a table too. Bars share one scale, set by the largest value.
 */
function BarList({ bars, max }: { bars: Bar[]; max?: number }) {
  const top = max ?? Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <ul className="grid gap-2">
      {bars.map((bar) => (
        <li
          key={bar.key}
          title={`${bar.name}: ${bar.text}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_6rem]"
        >
          <span className="truncate text-sm">{bar.label}</span>
          <span className="text-sm tabular-nums text-muted sm:order-3 sm:text-right">
            {bar.text}
          </span>
          <span
            aria-hidden="true"
            className="col-span-2 block h-2 rounded-full bg-surface sm:order-2 sm:col-span-1"
          >
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.max(bar.value > 0 ? 1 : 0, (bar.value / top) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars over time. Each column carries its own value for hover and screen readers. */
function Columns({
  columns,
}: {
  columns: { key: string; label: string; value: number; text: string }[];
}) {
  const top = Math.max(1, ...columns.map((column) => column.value));
  return (
    <ol className="flex h-40 items-stretch gap-0.5">
      {columns.map((column) => (
        <li
          key={column.key}
          title={`${column.label}: ${column.text}`}
          className="flex min-w-0 flex-1 flex-col justify-end gap-1"
        >
          <span className="sr-only">
            {column.label}: {column.text}
          </span>
          <span
            aria-hidden="true"
            className="block rounded-t bg-accent"
            style={{
              height: `${(column.value / top) * 100}%`,
              minHeight: column.value > 0 ? 2 : 0,
            }}
          />
          <span aria-hidden="true" className="truncate text-center text-xs text-muted">
            {column.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-3">
      <h2 className="section-title">{title}</h2>
      {note && <p className="note max-w-prose">{note}</p>}
      {children}
    </section>
  );
}

const SCORE_LABEL = {
  score: 'review.overall',
  difficultyScore: 'review.difficultyScore',
  storyScore: 'review.storyScore',
  gameplayScore: 'review.gameplayScore',
  levelDesignScore: 'review.levelDesignScore',
  soundtrackScore: 'review.soundtrackScore',
  visualsScore: 'review.visualsScore',
  perceivedLengthScore: 'review.perceivedLengthScore',
} as const;

function StatsView({ stats }: { stats: StatsResponse }) {
  const { t, tn, locale, formatMinutes, formatNumber, formatDate } = useI18n();
  const hours = (minutes: number) => formatMinutes(Math.round(minutes / 60) * 60 || minutes);
  const unknown = t('stats.notInformed');
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short' });
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });

  const sliceBars = (slices: StatsResponse['byPlatform']): Bar[] =>
    slices.map((slice) => ({
      key: slice.label ?? '—',
      label: slice.label ?? unknown,
      name: slice.label ?? unknown,
      value: slice.minutes,
      text: `${hours(slice.minutes)} · ${tn('stats.games', slice.games)}`,
    }));

  const scoreKeys = ['score', ...REVIEW_SUBSCORE_KEYS] as const;
  const scoreBars: Bar[] = scoreKeys.flatMap((key) => {
    const value = stats.reviews.averages[key];
    if (value === null) return [];
    return [
      {
        key,
        label: t(SCORE_LABEL[key]),
        name: t(SCORE_LABEL[key]),
        value,
        text: formatNumber(value),
      },
    ];
  });

  return (
    <div className="grid gap-10">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t('stats.totalHours')}
          value={hours(stats.totals.playedMinutes)}
          note={tn('stats.games', stats.totals.games)}
        />
        <Tile
          label={t('stats.completionRate')}
          value={
            stats.totals.completionRate === null ? t('app.none') : `${stats.totals.completionRate}%`
          }
          note={t('stats.completionNote', {
            completed: stats.totals.completedGames,
            dropped: stats.totals.droppedGames,
          })}
        />
        <Tile
          label={t('stats.backlogSize')}
          value={hours(stats.backlog.minutes)}
          note={
            stats.backlog.gamesWithoutTimes > 0
              ? t('stats.backlogNote', {
                  games: stats.backlog.games,
                  missing: stats.backlog.gamesWithoutTimes,
                })
              : tn('stats.games', stats.backlog.games)
          }
        />
        <Tile
          label={t('stats.streak')}
          value={tn('stats.days', stats.diary.currentStreak)}
          note={t('stats.longestStreak', { days: stats.diary.longestStreak })}
        />
      </dl>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title={t('stats.byPlatform')}>
          {stats.byPlatform.length > 0 ? (
            <BarList bars={sliceBars(stats.byPlatform)} />
          ) : (
            <p className="note">{t('stats.noHours')}</p>
          )}
        </Section>
        <Section title={t('stats.byGenre')} note={t('stats.byGenreNote')}>
          {stats.byGenre.length > 0 ? (
            <BarList bars={sliceBars(stats.byGenre)} />
          ) : (
            <p className="note">{t('stats.noHours')}</p>
          )}
        </Section>
      </div>

      <Section title={t('stats.byGame')}>
        {stats.byGame.length > 0 ? (
          <BarList
            bars={stats.byGame.map((game) => ({
              key: game.libraryEntryId,
              label: (
                <Link to={`/games/${game.libraryEntryId}`} className="link">
                  {game.title}
                </Link>
              ),
              name: game.title,
              value: game.minutes,
              text: hours(game.minutes),
            }))}
          />
        ) : (
          <p className="note">{t('stats.noHours')}</p>
        )}
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title={t('stats.completedByYear')}>
          {stats.completedByYear.length > 0 ? (
            <BarList
              bars={stats.completedByYear.map((row) => ({
                key: String(row.year),
                label: row.year ?? t('stats.noDate'),
                name: String(row.year ?? t('stats.noDate')),
                value: row.games,
                text: tn('stats.games', row.games),
              }))}
            />
          ) : (
            <p className="note">{t('stats.nothingCompleted')}</p>
          )}
        </Section>
        <Section
          title={t('stats.reviewAverages')}
          note={tn('stats.reviewCount', stats.reviews.count)}
        >
          {scoreBars.length > 0 ? <BarList bars={scoreBars} max={10} /> : null}
        </Section>
      </div>

      <Section
        title={t('stats.diary')}
        note={
          stats.diary.sessions > 0
            ? t('stats.diaryNote', {
                sessions: stats.diary.sessions,
                date: stats.diary.lastSessionOn ? formatDate(stats.diary.lastSessionOn) : '',
              })
            : t('stats.noSessions')
        }
      >
        {stats.diary.sessions > 0 && (
          <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <h3 className="label">{t('stats.byMonth')}</h3>
              <Columns
                columns={stats.diary.byMonth.map((row) => ({
                  key: row.month,
                  label: monthName.format(new Date(`${row.month}-15T12:00:00`)),
                  value: row.minutes,
                  text: `${formatMinutes(row.minutes)} · ${tn('stats.sessions', row.sessions)}`,
                }))}
              />
            </div>
            <div className="grid gap-2">
              <h3 className="label">{t('stats.byWeekday')}</h3>
              <Columns
                columns={stats.diary.byWeekday.map((minutes, day) => ({
                  key: String(day),
                  // 4 January 1970 was a Sunday.
                  label: weekdayName.format(new Date(Date.UTC(1970, 0, 4 + day))),
                  value: minutes,
                  text: formatMinutes(minutes),
                }))}
              />
            </div>
            {stats.minutesByYear.length > 1 && (
              <div className="grid gap-2 lg:col-span-2">
                <h3 className="label">{t('stats.byYear')}</h3>
                <BarList
                  bars={stats.minutesByYear.map((row) => ({
                    key: String(row.year),
                    label: row.year,
                    name: String(row.year),
                    value: row.minutes,
                    text: hours(row.minutes),
                  }))}
                />
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

export function StatsPage() {
  const { t } = useI18n();
  const stats = useStats();
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl">{t('stats.title')}</h1>
      {stats.isPending ? (
        <Loading />
      ) : stats.isError ? (
        <ErrorNote error={stats.error} />
      ) : stats.data.totals.games === 0 ? (
        <p className="text-muted">{t('stats.empty')}</p>
      ) : (
        <StatsView stats={stats.data} />
      )}
    </div>
  );
}
