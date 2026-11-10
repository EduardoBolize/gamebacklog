import {
  DATA_ORIGINS,
  EXTERNAL_ID_SOURCES,
  GAME_TIME_ORIGINS,
  MATCH_METHODS,
} from '@gamebacklog/shared';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { createdAt, id, stringArray, timestamp, timestamps } from './columns.ts';

/** Normalized game metadata. One row per game, whatever the source. */
export const games = sqliteTable(
  'games',
  {
    id: id(),
    title: text('title').notNull(),
    /** Other names the game is known by; helps matching against HLTB and wikis. */
    alternativeTitles: stringArray('alternative_titles'),
    summary: text('summary'),
    coverUrl: text('cover_url'),
    /** ISO `YYYY-MM-DD`. Null when only the year is known. */
    releaseDate: text('release_date'),
    releaseYear: integer('release_year'),
    platforms: stringArray('platforms'),
    genres: stringArray('genres'),
    themes: stringArray('themes'),
    /** Mechanics / keywords, used by the taste profile. Not the user's own tags. */
    tags: stringArray('tags'),
    franchise: text('franchise'),
    origin: text('origin', { enum: DATA_ORIGINS }).notNull(),
    originUrl: text('origin_url'),
    fetchedAt: timestamp('fetched_at'),
    ...timestamps(),
  },
  (t) => [
    index('games_title_idx').on(t.title),
    index('games_release_year_idx').on(t.releaseYear),
    index('games_franchise_idx').on(t.franchise),
  ],
);

/**
 * Links one game to its IDs on each source. An external ID belongs to exactly one game;
 * a game may have several IDs on the same source (e.g. editions on Steam).
 */
export const gameExternalIds = sqliteTable(
  'game_external_ids',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    source: text('source', { enum: EXTERNAL_ID_SOURCES }).notNull(),
    externalId: text('external_id').notNull(),
    url: text('url'),
    /** `user` means the user corrected the match; automatic matching must not overwrite it. */
    matchedBy: text('matched_by', { enum: MATCH_METHODS }).notNull().default('auto'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.externalId] }),
    index('game_external_ids_game_idx').on(t.gameId),
  ],
);

/**
 * Time-to-beat figures. A game can have one `hltb` row and one `manual` row;
 * the manual one is the editable fallback and wins when present.
 */
export const gameTimes = sqliteTable(
  'game_times',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    origin: text('origin', { enum: GAME_TIME_ORIGINS }).notNull(),
    mainMinutes: integer('main_minutes'),
    mainExtraMinutes: integer('main_extra_minutes'),
    completionistMinutes: integer('completionist_minutes'),
    originUrl: text('origin_url'),
    fetchedAt: timestamp('fetched_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('game_times_game_origin_uq').on(t.gameId, t.origin)],
);
