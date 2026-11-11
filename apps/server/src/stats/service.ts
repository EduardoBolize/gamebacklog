import {
  LIBRARY_STATUSES,
  REVIEW_SUBSCORE_KEYS,
  type GameTimes,
  type LibraryStatus,
  type NudgeListResponse,
  type PlaythroughGoal,
  type StatsResponse,
  type StatsSlice,
} from '@gamebacklog/shared';
import { eq } from 'drizzle-orm';
import { localDate, type AppContext } from '../context.ts';
import type { AppDatabase } from '../db/client.ts';
import {
  gameTimes,
  games,
  libraryEntries,
  playthroughs,
  progressEvents,
  reviews,
  sessions,
} from '../db/schema/index.ts';
import { pickEffectiveTimes } from '../library/times.ts';
import { SETTINGS, getSetting } from '../settings/store.ts';

/**
 * Statistics and nudges. Everything is counted from what is already in the database; nothing
 * here calls a source or the AI.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_GAMES = 15;
const TOP_SLICES = 12;

function group<T, K>(rows: T[], keyOf: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/** The time to beat that matches what the run is going for. */
export function goalMinutes(times: GameTimes | null, goal: PlaythroughGoal): number | null {
  if (!times) return null;
  return goal === 'finish'
    ? (times.mainMinutes ?? times.mainExtraMinutes)
    : (times.completionistMinutes ?? times.mainExtraMinutes ?? times.mainMinutes);
}

function loadLibrary(db: AppDatabase) {
  const rows = db
    .select({ entry: libraryEntries, game: games })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .all();
  const runsByEntry = group(db.select().from(playthroughs).all(), (row) => row.libraryEntryId);
  const sessionRows = db.select().from(sessions).all();
  const sessionsByEntry = group(sessionRows, (row) => row.libraryEntryId);
  const timesByGame = group(db.select().from(gameTimes).all(), (row) => row.gameId);

  const library = rows.map(({ entry, game }) => {
    const runs = [...(runsByEntry.get(entry.id) ?? [])].sort((a, b) => a.number - b.number);
    const diaryMinutes = (sessionsByEntry.get(entry.id) ?? []).reduce(
      (sum, row) => sum + row.durationMinutes,
      0,
    );
    const runMinutes = runs.reduce((sum, run) => sum + (run.playtimeMinutes ?? 0), 0);
    return {
      entry,
      game,
      runs,
      // Hours typed or synced on the runs are the fuller record; the diary fills in for none.
      minutes: runMinutes > 0 ? runMinutes : diaryMinutes,
      usesRunHours: runMinutes > 0,
      times: pickEffectiveTimes(timesByGame.get(game.id) ?? []),
    };
  });
  return { library, sessionRows };
}

function slices(parts: { label: string | null; minutes: number; entryId: string }[]): StatsSlice[] {
  const byLabel = new Map<string | null, { minutes: number; entries: Set<string> }>();
  for (const part of parts) {
    // A game with no hours on a platform or genre is not part of its total.
    if (part.minutes <= 0) continue;
    const slice = byLabel.get(part.label) ?? { minutes: 0, entries: new Set<string>() };
    slice.minutes += part.minutes;
    slice.entries.add(part.entryId);
    byLabel.set(part.label, slice);
  }
  return [...byLabel.entries()]
    .map(([label, slice]) => ({ label, minutes: slice.minutes, games: slice.entries.size }))
    .filter((slice) => slice.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || (a.label ?? '').localeCompare(b.label ?? ''))
    .slice(0, TOP_SLICES);
}

/** Longest run of consecutive days, and the run that is still going (today or yesterday). */
export function streaks(days: string[], today: string): { current: number; longest: number } {
  const unique = [...new Set(days)].sort();
  const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of unique) {
    const number = dayNumber(day);
    run = previous !== null && number === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = number;
  }
  // A streak is still alive the day after its last session.
  const alive = previous !== null && dayNumber(today) - previous <= 1;
  return { current: alive ? run : 0, longest };
}

const FINISHED: LibraryStatus[] = ['completed', 'completed_100'];

export function getStats(ctx: AppContext): StatsResponse {
  const { library, sessionRows } = loadLibrary(ctx.db);
  const now = ctx.now();

  const statusCounts = Object.fromEntries(
    LIBRARY_STATUSES.map((status) => [
      status,
      library.filter((item) => item.entry.status === status).length,
    ]),
  ) as Record<LibraryStatus, number>;
  const completedGames = statusCounts.completed + statusCounts.completed_100;
  const decided = completedGames + statusCounts.dropped;

  // Hours by platform: each run counts on the platform it was played on.
  const platformParts = library.flatMap((item) =>
    item.usesRunHours
      ? item.runs.map((run) => ({
          label: run.platform ?? item.entry.platform,
          minutes: run.playtimeMinutes ?? 0,
          entryId: item.entry.id,
        }))
      : [{ label: item.entry.platform, minutes: item.minutes, entryId: item.entry.id }],
  );
  const genreParts = library.flatMap((item) =>
    (item.game.genres.length > 0 ? item.game.genres : [null]).map((label) => ({
      label,
      minutes: item.minutes,
      entryId: item.entry.id,
    })),
  );

  const minutesByYear = new Map<number, number>();
  const months = new Map<string, { minutes: number; sessions: number }>();
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const row of sessionRows) {
    const day = localDate(row.startedAt);
    const year = Number(day.slice(0, 4));
    minutesByYear.set(year, (minutesByYear.get(year) ?? 0) + row.durationMinutes);
    const month = months.get(day.slice(0, 7)) ?? { minutes: 0, sessions: 0 };
    month.minutes += row.durationMinutes;
    month.sessions++;
    months.set(day.slice(0, 7), month);
    byWeekday[row.startedAt.getDay()] =
      (byWeekday[row.startedAt.getDay()] ?? 0) + row.durationMinutes;
  }
  const lastTwelve = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    const month = localDate(date).slice(0, 7);
    return { month, ...(months.get(month) ?? { minutes: 0, sessions: 0 }) };
  });

  // A game counts once per year it was finished in, however many runs ended that year.
  const finishedIn = new Map<number | null, Set<string>>();
  for (const item of library) {
    const finishedRuns = item.runs.filter((run) => run.status === 'completed');
    const years = finishedRuns.map((run) =>
      run.finishedOn ? Number(run.finishedOn.slice(0, 4)) : null,
    );
    // Marked as finished with no finished run on record: still a finished game, undated.
    if (years.length === 0 && FINISHED.includes(item.entry.status)) years.push(null);
    for (const year of years) {
      const set = finishedIn.get(year) ?? new Set<string>();
      set.add(item.entry.id);
      finishedIn.set(year, set);
    }
  }

  const backlog = library.filter((item) => item.entry.status === 'backlog');
  const backlogTimes = backlog.map((item) =>
    goalMinutes(item.times, item.runs.at(-1)?.goal ?? 'finish'),
  );

  const days = sessionRows.map((row) => localDate(row.startedAt));
  const streak = streaks(days, localDate(now));

  const reviewRows = ctx.db.select().from(reviews).all();
  const average = (values: (number | null)[]) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length === 0
      ? null
      : Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 10) / 10;
  };

  return {
    totals: {
      games: library.length,
      playedMinutes: library.reduce((sum, item) => sum + item.minutes, 0),
      completedGames,
      droppedGames: statusCounts.dropped,
      completionRate: decided === 0 ? null : Math.round((completedGames / decided) * 100),
    },
    statusCounts,
    byPlatform: slices(platformParts),
    byGenre: slices(genreParts),
    byGame: library
      .filter((item) => item.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes || a.game.title.localeCompare(b.game.title))
      .slice(0, TOP_GAMES)
      .map((item) => ({
        libraryEntryId: item.entry.id,
        title: item.game.title,
        minutes: item.minutes,
      })),
    minutesByYear: [...minutesByYear.entries()]
      .map(([year, minutes]) => ({ year, minutes }))
      .sort((a, b) => a.year - b.year),
    completedByYear: [...finishedIn.entries()]
      .map(([year, set]) => ({ year, games: set.size }))
      .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity)),
    backlog: {
      games: backlog.length,
      minutes: backlogTimes.reduce<number>((sum, minutes) => sum + (minutes ?? 0), 0),
      gamesWithoutTimes: backlogTimes.filter((minutes) => minutes === null).length,
    },
    diary: {
      sessions: sessionRows.length,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      lastSessionOn: days.length > 0 ? ([...days].sort().at(-1) ?? null) : null,
      byMonth: lastTwelve,
      byWeekday,
    },
    reviews: {
      count: reviewRows.length,
      averages: {
        score: average(reviewRows.map((row) => row.score)),
        ...Object.fromEntries(
          REVIEW_SUBSCORE_KEYS.map((key) => [key, average(reviewRows.map((row) => row[key]))]),
        ),
      } as StatsResponse['reviews']['averages'],
    },
  };
}

const MAX_NUDGES = 5;

/**
 * Games being played that were left alone: the ones at risk of being dropped without a
 * decision. Each comes with how close it is to the end, which is the best reason to return.
 */
export function getNudges(ctx: AppContext): NudgeListResponse {
  const { library } = loadLibrary(ctx.db);
  const afterDays = getSetting(ctx.db, SETTINGS.nudgeAfterDays);
  const now = ctx.now().getTime();

  const lastSession = new Map<string, number>();
  for (const row of ctx.db.select().from(sessions).all()) {
    lastSession.set(
      row.libraryEntryId,
      Math.max(lastSession.get(row.libraryEntryId) ?? 0, row.startedAt.getTime()),
    );
  }
  const lastProgress = new Map<string, number>();
  for (const row of ctx.db.select().from(progressEvents).all()) {
    lastProgress.set(
      row.playthroughId,
      Math.max(lastProgress.get(row.playthroughId) ?? 0, row.occurredAt.getTime()),
    );
  }

  const items = library
    .filter((item) => item.entry.status === 'playing')
    .flatMap((item) => {
      const run =
        item.runs.findLast((candidate) => candidate.status === 'playing') ?? item.runs.at(-1);
      // The last sign of life: a session, a "where am I?", or the day it was added or edited.
      const lastActivity = Math.max(
        lastSession.get(item.entry.id) ?? 0,
        ...item.runs.map((candidate) => lastProgress.get(candidate.id) ?? 0),
        item.entry.updatedAt.getTime(),
      );
      const daysIdle = Math.floor((now - lastActivity) / DAY_MS);
      if (daysIdle < afterDays) return [];

      const goal = goalMinutes(item.times, run?.goal ?? 'finish');
      const played = run?.playtimeMinutes ?? null;
      const known = goal !== null && goal > 0 && played !== null;
      return [
        {
          libraryEntryId: item.entry.id,
          title: item.game.title,
          coverUrl: item.game.coverUrl,
          daysIdle,
          // Never 100%: the game is not finished, whatever the estimate says.
          percent: known ? Math.min(99, Math.round((played / goal) * 100)) : null,
          remainingMinutes: known && played < goal ? goal - played : null,
        },
      ];
    })
    // Closest to the end first; then the longest forgotten.
    .sort(
      (a, b) =>
        (b.percent ?? -1) - (a.percent ?? -1) ||
        b.daysIdle - a.daysIdle ||
        a.title.localeCompare(b.title),
    )
    .slice(0, MAX_NUDGES);

  return { afterDays, items };
}
