import { CONTENT_ORIGINS, type Provenance } from '@gamebacklog/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { games } from './catalog.ts';
import { flag, id, stringArray, timestamp, timestamps } from './columns.ts';

/** Chapter / area map of a game. Built once (wiki + story achievements + AI), cached, editable. */
export const chapterMaps = sqliteTable(
  'chapter_maps',
  {
    id: id(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    origin: text('origin', { enum: CONTENT_ORIGINS }).notNull(),
    /** Every source the map was built from. */
    sources: text('sources', { mode: 'json' }).$type<Provenance[]>().notNull().default([]),
    /** Version of the prompt template, when the AI took part. */
    promptVersion: text('prompt_version'),
    /** Once the user edits the map, regeneration must not overwrite it silently. */
    isUserEdited: flag('is_user_edited'),
    generatedAt: timestamp('generated_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('chapter_maps_game_uq').on(t.gameId)],
);

/** One step of a chapter map: a chapter, area or dungeon, in play order. */
export const checkpoints = sqliteTable(
  'checkpoints',
  {
    id: id(),
    chapterMapId: text('chapter_map_id')
      .notNull()
      .references(() => chapterMaps.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    /** Alternative names, used to match the user's free text locally before asking the AI. */
    aliases: stringArray('aliases'),
    isPointOfNoReturn: flag('is_point_of_no_return'),
    /** Boss fought at this checkpoint, when there is one. Feeds the proactive "boss tips?" question. */
    bossName: text('boss_name'),
    /**
     * Checkpoints of the same map that can be reached from here. Empty means "the next one by
     * position", which is all a linear game needs; open games branch.
     */
    leadsTo: stringArray('leads_to'),
    /** Item, key or event that opens the way here, as the game names it. */
    requirement: text('requirement'),
    origin: text('origin', { enum: CONTENT_ORIGINS }).notNull(),
    ...timestamps(),
  },
  (t) => [index('checkpoints_map_position_idx').on(t.chapterMapId, t.position)],
);
