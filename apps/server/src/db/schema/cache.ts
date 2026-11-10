import { HINT_KINDS, SOURCE_IDS, type Provenance } from '@gamebacklog/shared';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { games } from './catalog.ts';
import { checkpoints } from './chapters.ts';
import { createdAt, flag, id, timestamp } from './columns.ts';

/**
 * Raw responses from external sources, keyed per source.
 * `version` is the adapter's normalization version: bumping it invalidates old rows.
 */
export const sourceCache = sqliteTable(
  'source_cache',
  {
    source: text('source', { enum: SOURCE_IDS }).notNull(),
    cacheKey: text('cache_key').notNull(),
    url: text('url'),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    version: integer('version').notNull().default(1),
    fetchedAt: timestamp('fetched_at').notNull(),
    /** Null means it never expires. */
    expiresAt: timestamp('expires_at'),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.cacheKey] }),
    index('source_cache_expires_idx').on(t.expiresAt),
  ],
);

/**
 * Validated AI responses. `cacheKey` is a hash of
 * feature + game + checkpoint + goal + level + prompt template version.
 */
export const aiCache = sqliteTable(
  'ai_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    feature: text('feature').notNull(),
    gameId: text('game_id').references(() => games.id, { onDelete: 'cascade' }),
    promptVersion: text('prompt_version').notNull(),
    providerId: text('provider_id'),
    model: text('model'),
    response: text('response', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at'),
  },
  (t) => [index('ai_cache_game_idx').on(t.gameId), index('ai_cache_expires_idx').on(t.expiresAt)],
);

/** Generated hints, one row per (game, checkpoint, kind, level, what the user is stuck on). */
export const hintsCache = sqliteTable(
  'hints_cache',
  {
    id: id(),
    cacheKey: text('cache_key').notNull().unique(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    checkpointId: text('checkpoint_id').references(() => checkpoints.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: HINT_KINDS }).notNull(),
    /** 1 = nudge … 4 = full solution. */
    level: integer('level').notNull(),
    /** The user's optional "where I'm stuck" text, normalized. */
    stuckOn: text('stuck_on'),
    content: text('content', { mode: 'json' }).$type<unknown>().notNull(),
    sources: text('sources', { mode: 'json' }).$type<Provenance[]>().notNull().default([]),
    promptVersion: text('prompt_version').notNull(),
    providerId: text('provider_id'),
    model: text('model'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at'),
  },
  (t) => [index('hints_cache_game_checkpoint_idx').on(t.gameId, t.checkpointId, t.level)],
);

/** One row per AI request, including cache hits. Shown on the "AI usage" screen. Never holds secrets. */
export const aiUsageLog = sqliteTable(
  'ai_usage_log',
  {
    id: id(),
    feature: text('feature').notNull(),
    providerId: text('provider_id'),
    model: text('model'),
    gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
    inputTokensEstimated: integer('input_tokens_estimated').notNull().default(0),
    outputTokensEstimated: integer('output_tokens_estimated').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    cacheHit: flag('cache_hit'),
    success: integer('success', { mode: 'boolean' }).notNull().default(true),
    /** Short machine-readable code, never the raw provider message. */
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_usage_log_created_idx').on(t.createdAt),
    index('ai_usage_log_game_idx').on(t.gameId),
  ],
);
