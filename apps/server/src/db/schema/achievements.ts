import {
  ACHIEVEMENT_ORIGINS,
  ACHIEVEMENT_PROGRESS_ORIGINS,
  CLASSIFICATION_ORIGINS,
} from '@gamebacklog/shared';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { games } from './catalog.ts';
import { checkpoints } from './chapters.ts';
import { flag, id, timestamp, timestamps, updatedAt } from './columns.ts';
import { playthroughs } from './library.ts';

/**
 * Achievement / trophy catalog of a game.
 * `steam` and `retroachievements` rows are official; `wiki` and `ai` rows are shown as unofficial.
 */
export const achievements = sqliteTable(
  'achievements',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    origin: text('origin', { enum: ACHIEVEMENT_ORIGINS }).notNull(),
    /** ID on the source (e.g. the Steam API name). Null for manual entries. */
    externalId: text('external_id'),
    name: text('name').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'),
    /** Share of players who unlocked it, 0–100, when the source provides it. */
    globalPercent: real('global_percent'),
    isHidden: flag('is_hidden'),
    isMissable: flag('is_missable'),
    /** Marks story progress; feeds the abandonment funnel. */
    isStory: flag('is_story'),
    isNgPlus: flag('is_ng_plus'),
    /** Who set the three flags above. Null while unclassified. */
    classifiedBy: text('classified_by', { enum: CLASSIFICATION_ORIGINS }),
    checkpointId: text('checkpoint_id').references(() => checkpoints.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    originUrl: text('origin_url'),
    fetchedAt: timestamp('fetched_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('achievements_game_origin_external_uq').on(t.gameId, t.origin, t.externalId),
    index('achievements_game_idx').on(t.gameId),
    index('achievements_checkpoint_idx').on(t.checkpointId),
  ],
);

/** Unlock state of an achievement within one playthrough (so NG+ achievements land on the right run). */
export const achievementProgress = sqliteTable(
  'achievement_progress',
  {
    playthroughId: text('playthrough_id')
      .notNull()
      .references(() => playthroughs.id, { onDelete: 'cascade' }),
    achievementId: text('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    isUnlocked: flag('is_unlocked'),
    unlockedAt: timestamp('unlocked_at'),
    origin: text('origin', { enum: ACHIEVEMENT_PROGRESS_ORIGINS }).notNull().default('manual'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.playthroughId, t.achievementId] }),
    index('achievement_progress_achievement_idx').on(t.achievementId),
  ],
);
