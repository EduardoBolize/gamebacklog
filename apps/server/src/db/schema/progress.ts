import { CHECKPOINT_RESOLUTIONS, CONTENT_ORIGINS } from '@gamebacklog/shared';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { games } from './catalog.ts';
import { checkpoints } from './chapters.ts';
import { createdAt, flag, id, timestamp, timestamps, updatedAt } from './columns.ts';
import { playthroughs } from './library.ts';

/** History of "where am I?" answers for a playthrough. */
export const progressEvents = sqliteTable(
  'progress_events',
  {
    id: id(),
    playthroughId: text('playthrough_id')
      .notNull()
      .references(() => playthroughs.id, { onDelete: 'cascade' }),
    /** What the user typed, verbatim. Null when a checkpoint was picked directly. */
    rawText: text('raw_text'),
    checkpointId: text('checkpoint_id').references(() => checkpoints.id, { onDelete: 'set null' }),
    /** How the text became a checkpoint. Null while unresolved. */
    resolvedBy: text('resolved_by', { enum: CHECKPOINT_RESOLUTIONS }),
    occurredAt: timestamp('occurred_at')
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (t) => [index('progress_events_playthrough_idx').on(t.playthroughId, t.occurredAt)],
);

/** Items and secrets of a game, tied to the checkpoint where they can be found. */
export const collectibles = sqliteTable(
  'collectibles',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    checkpointId: text('checkpoint_id').references(() => checkpoints.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /**
     * The item's name as the (English) sources write it. It stays the same whatever language
     * the list is written in, so a rewritten list keeps the player's ticks.
     */
    sourceName: text('source_name'),
    description: text('description'),
    /** Free grouping, e.g. "Heart Piece" or "Gold Skulltula". */
    category: text('category'),
    isMissable: flag('is_missable'),
    /**
     * Achievement or trophy the item counts towards, as the game names it. Set even when the
     * app has no achievement data for the game; `achievementId` links it when it does.
     */
    achievementName: text('achievement_name'),
    // A plain ID, not a foreign key: achievements are replaced on sync and on import, and a
    // dangling link only means the name is shown without the app's own achievement row.
    achievementId: text('achievement_id'),
    /** Language the AI wrote the description in, so a change of language can rewrite it. */
    locale: text('locale'),
    sortOrder: integer('sort_order').notNull().default(0),
    origin: text('origin', { enum: CONTENT_ORIGINS }).notNull(),
    originUrl: text('origin_url'),
    fetchedAt: timestamp('fetched_at'),
    ...timestamps(),
  },
  (t) => [
    index('collectibles_game_idx').on(t.gameId),
    index('collectibles_checkpoint_idx').on(t.checkpointId),
  ],
);

/** Per-playthrough checklist of collectibles. */
export const collectibleProgress = sqliteTable(
  'collectible_progress',
  {
    playthroughId: text('playthrough_id')
      .notNull()
      .references(() => playthroughs.id, { onDelete: 'cascade' }),
    collectibleId: text('collectible_id')
      .notNull()
      .references(() => collectibles.id, { onDelete: 'cascade' }),
    isCollected: flag('is_collected'),
    collectedAt: timestamp('collected_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.playthroughId, t.collectibleId] }),
    index('collectible_progress_collectible_idx').on(t.collectibleId),
  ],
);
