import { z } from 'zod';
import { LIBRARY_STATUSES } from '../enums.ts';
import { isoDateSchema } from './common.ts';
import { REVIEW_SUBSCORE_KEYS } from './library.ts';

/** One bar of a breakdown. `label` is null for "not informed" (no platform, no genre). */
const sliceSchema = z.object({
  label: z.string().nullable(),
  minutes: z.number().int(),
  games: z.number().int(),
});
export type StatsSlice = z.infer<typeof sliceSchema>;

const averageSchema = z.number().nullable();

export const statsResponseSchema = z.object({
  totals: z.object({
    games: z.number().int(),
    /** Every minute on record: hours of the runs, or of the diary when a run has none. */
    playedMinutes: z.number().int(),
    completedGames: z.number().int(),
    droppedGames: z.number().int(),
    /** Finished games out of finished plus dropped, 0–100. Null while neither exists. */
    completionRate: z.number().nullable(),
  }),
  statusCounts: z.record(z.enum(LIBRARY_STATUSES), z.number().int()),
  byPlatform: z.array(sliceSchema),
  /** A game with two genres counts in both, so these do not add up to the total. */
  byGenre: z.array(sliceSchema),
  byGame: z.array(
    z.object({ libraryEntryId: z.string(), title: z.string(), minutes: z.number().int() }),
  ),
  /** From the diary: only sessions carry a date. */
  minutesByYear: z.array(z.object({ year: z.number().int(), minutes: z.number().int() })),
  /** Games finished per year. `year` is null for runs finished without a date. */
  completedByYear: z.array(
    z.object({ year: z.number().int().nullable(), games: z.number().int() }),
  ),
  backlog: z.object({
    games: z.number().int(),
    /** Time to beat every backlog game, each by the goal of its run. */
    minutes: z.number().int(),
    /** Backlog games with no time to beat on record, left out of the sum. */
    gamesWithoutTimes: z.number().int(),
  }),
  diary: z.object({
    sessions: z.number().int(),
    /** Consecutive days with a session, ending today or yesterday. */
    currentStreak: z.number().int(),
    longestStreak: z.number().int(),
    lastSessionOn: isoDateSchema.nullable(),
    /** The last twelve months, oldest first, as `YYYY-MM`. */
    byMonth: z.array(
      z.object({ month: z.string(), minutes: z.number().int(), sessions: z.number().int() }),
    ),
    /** Minutes per day of the week, Sunday first. */
    byWeekday: z.array(z.number().int()).length(7),
  }),
  reviews: z.object({
    count: z.number().int(),
    averages: z.object({
      score: averageSchema,
      ...Object.fromEntries(REVIEW_SUBSCORE_KEYS.map((key) => [key, averageSchema])),
    } as Record<'score' | (typeof REVIEW_SUBSCORE_KEYS)[number], typeof averageSchema>),
  }),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

/** A game being played that has been left alone for a while, with how close it is to the end. */
export const nudgeSchema = z.object({
  libraryEntryId: z.string(),
  title: z.string(),
  coverUrl: z.string().nullable(),
  daysIdle: z.number().int(),
  /** Share of the run's goal already played, 0–99. Null without a time to beat. */
  percent: z.number().int().nullable(),
  remainingMinutes: z.number().int().nullable(),
});
export type Nudge = z.infer<typeof nudgeSchema>;

export const nudgeListResponseSchema = z.object({
  /** Days without activity after which a game shows up here. */
  afterDays: z.number().int(),
  items: z.array(nudgeSchema),
});
export type NudgeListResponse = z.infer<typeof nudgeListResponseSchema>;
