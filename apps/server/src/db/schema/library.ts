import {
  LIBRARY_STATUSES,
  PLAYTHROUGH_GOALS,
  PLAYTHROUGH_STATUSES,
  PLAYTHROUGH_TYPES,
  SESSION_ORIGINS,
} from '@gamebacklog/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { games } from './catalog.ts';
import { checkpoints } from './chapters.ts';
import { flag, id, stringArray, timestamp, timestamps } from './columns.ts';

/** A game in the user's library. Everything the user owns hangs from this row. */
export const libraryEntries = sqliteTable(
  'library_entries',
  {
    id: id(),
    // `restrict`: a game the user has in the library can never be deleted by accident.
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
    status: text('status', { enum: LIBRARY_STATUSES }).notNull(),
    /** Platform the user plays this game on. */
    platform: text('platform'),
    isFavorite: flag('is_favorite'),
    /** The user's own tags. */
    tags: stringArray('tags'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('library_entries_game_uq').on(t.gameId),
    index('library_entries_status_idx').on(t.status),
  ],
);

/** One run through a game. A library entry can have many (first run, NG+, NG++, custom). */
export const playthroughs = sqliteTable(
  'playthroughs',
  {
    id: id(),
    libraryEntryId: text('library_entry_id')
      .notNull()
      .references(() => libraryEntries.id, { onDelete: 'cascade' }),
    /** 1-based order within the library entry. */
    number: integer('number').notNull(),
    type: text('type', { enum: PLAYTHROUGH_TYPES }).notNull().default('normal'),
    /** Free name, mainly for `custom` runs. */
    label: text('label'),
    goal: text('goal', { enum: PLAYTHROUGH_GOALS }).notNull().default('finish'),
    status: text('status', { enum: PLAYTHROUGH_STATUSES }).notNull().default('not_started'),
    /** Overrides the library entry platform for this run, when different. */
    platform: text('platform'),
    /** ISO `YYYY-MM-DD`. */
    startedOn: text('started_on'),
    /** ISO `YYYY-MM-DD`. */
    finishedOn: text('finished_on'),
    playtimeMinutes: integer('playtime_minutes'),
    currentCheckpointId: text('current_checkpoint_id').references(() => checkpoints.id, {
      onDelete: 'set null',
    }),
    /** Checkpoints the player said they finished; open games are not done in map order. */
    completedCheckpointIds: stringArray('completed_checkpoint_ids'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('playthroughs_entry_number_uq').on(t.libraryEntryId, t.number)],
);

/** Play diary. Manual entries, or automatic ones derived from Steam playtime deltas. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    libraryEntryId: text('library_entry_id')
      .notNull()
      .references(() => libraryEntries.id, { onDelete: 'cascade' }),
    playthroughId: text('playthrough_id').references(() => playthroughs.id, {
      onDelete: 'set null',
    }),
    startedAt: timestamp('started_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    note: text('note'),
    origin: text('origin', { enum: SESSION_ORIGINS }).notNull().default('manual'),
    ...timestamps(),
  },
  (t) => [
    index('sessions_entry_started_idx').on(t.libraryEntryId, t.startedAt),
    index('sessions_started_idx').on(t.startedAt),
    index('sessions_playthrough_idx').on(t.playthroughId),
  ],
);

/** A score from 0 to 10 in half-point steps, or null when not rated. */
const scoreCheck = (name: string, column: AnySQLiteColumn) =>
  check(
    name,
    sql`${column} is null or (${column} >= 0 and ${column} <= 10 and ${column} * 2 = round(${column} * 2))`,
  );

/**
 * Review of a playthrough (`playthroughId` set) or of the game as a whole (`playthroughId` null).
 * At most one of each: one per playthrough, and one game-level review per library entry.
 */
export const reviews = sqliteTable(
  'reviews',
  {
    id: id(),
    libraryEntryId: text('library_entry_id')
      .notNull()
      .references(() => libraryEntries.id, { onDelete: 'cascade' }),
    playthroughId: text('playthrough_id').references(() => playthroughs.id, {
      onDelete: 'cascade',
    }),
    score: real('score'),
    difficultyScore: real('difficulty_score'),
    storyScore: real('story_score'),
    gameplayScore: real('gameplay_score'),
    levelDesignScore: real('level_design_score'),
    soundtrackScore: real('soundtrack_score'),
    visualsScore: real('visuals_score'),
    perceivedLengthScore: real('perceived_length_score'),
    body: text('body'),
    pros: stringArray('pros'),
    cons: stringArray('cons'),
    hasSpoilers: flag('has_spoilers'),
    /** Derived from the playthrough when created; the user can edit it. */
    timeToBeatMinutes: integer('time_to_beat_minutes'),
    reviewedAt: timestamp('reviewed_at')
      .notNull()
      .$defaultFn(() => new Date()),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('reviews_playthrough_uq')
      .on(t.playthroughId)
      .where(sql`${t.playthroughId} is not null`),
    uniqueIndex('reviews_entry_game_level_uq')
      .on(t.libraryEntryId)
      .where(sql`${t.playthroughId} is null`),
    index('reviews_entry_idx').on(t.libraryEntryId),
    scoreCheck('reviews_score_ck', t.score),
    scoreCheck('reviews_difficulty_score_ck', t.difficultyScore),
    scoreCheck('reviews_story_score_ck', t.storyScore),
    scoreCheck('reviews_gameplay_score_ck', t.gameplayScore),
    scoreCheck('reviews_level_design_score_ck', t.levelDesignScore),
    scoreCheck('reviews_soundtrack_score_ck', t.soundtrackScore),
    scoreCheck('reviews_visuals_score_ck', t.visualsScore),
    scoreCheck('reviews_perceived_length_score_ck', t.perceivedLengthScore),
  ],
);
