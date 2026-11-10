import type { ExportCacheName, ExportTableName } from '@gamebacklog/shared';
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema/index.ts';

/** A row as it appears in an export file: plain JSON, instants as ISO strings. */
export type ExportRow = Record<string, unknown>;

export interface TableSpec<Name extends string = string> {
  name: Name;
  table: SQLiteTable;
  /** Property names of the primary key. */
  pk: string[];
  /** Foreign keys: property name → the table whose `id` it points to. */
  fks: Record<string, ExportTableName>;
  /**
   * Identity of a row beyond its primary key, computed after foreign keys were remapped.
   * Two installs create the same thing under different IDs (the same game's playthrough #1,
   * say); a matching natural key lets a merge treat them as one row.
   */
  naturalKey?: (row: ExportRow) => string | null;
}

const key = (...parts: unknown[]) => parts.map((part) => String(part)).join('|');

/**
 * User data tables in insertion order: every table comes after the ones it references.
 * `schema_meta` is not exported: it describes the database, not the user's data.
 */
export const DATA_TABLES: TableSpec<ExportTableName>[] = [
  { name: 'games', table: schema.games, pk: ['id'], fks: {} },
  {
    name: 'gameExternalIds',
    table: schema.gameExternalIds,
    pk: ['source', 'externalId'],
    fks: { gameId: 'games' },
  },
  {
    name: 'gameTimes',
    table: schema.gameTimes,
    pk: ['id'],
    fks: { gameId: 'games' },
    naturalKey: (row) => key(row.gameId, row.origin),
  },
  {
    name: 'chapterMaps',
    table: schema.chapterMaps,
    pk: ['id'],
    fks: { gameId: 'games' },
    naturalKey: (row) => key(row.gameId),
  },
  {
    name: 'checkpoints',
    table: schema.checkpoints,
    pk: ['id'],
    fks: { chapterMapId: 'chapterMaps' },
    naturalKey: (row) => key(row.chapterMapId, row.position),
  },
  {
    name: 'libraryEntries',
    table: schema.libraryEntries,
    pk: ['id'],
    fks: { gameId: 'games' },
    naturalKey: (row) => key(row.gameId),
  },
  {
    name: 'playthroughs',
    table: schema.playthroughs,
    pk: ['id'],
    fks: { libraryEntryId: 'libraryEntries', currentCheckpointId: 'checkpoints' },
    naturalKey: (row) => key(row.libraryEntryId, row.number),
  },
  {
    name: 'sessions',
    table: schema.sessions,
    pk: ['id'],
    fks: { libraryEntryId: 'libraryEntries', playthroughId: 'playthroughs' },
  },
  {
    name: 'reviews',
    table: schema.reviews,
    pk: ['id'],
    fks: { libraryEntryId: 'libraryEntries', playthroughId: 'playthroughs' },
    naturalKey: (row) =>
      row.playthroughId ? key('run', row.playthroughId) : key('game', row.libraryEntryId),
  },
  {
    name: 'progressEvents',
    table: schema.progressEvents,
    pk: ['id'],
    fks: { playthroughId: 'playthroughs', checkpointId: 'checkpoints' },
  },
  {
    name: 'collectibles',
    table: schema.collectibles,
    pk: ['id'],
    fks: { gameId: 'games', checkpointId: 'checkpoints' },
  },
  {
    name: 'collectibleProgress',
    table: schema.collectibleProgress,
    pk: ['playthroughId', 'collectibleId'],
    fks: { playthroughId: 'playthroughs', collectibleId: 'collectibles' },
  },
  {
    name: 'achievements',
    table: schema.achievements,
    pk: ['id'],
    fks: { gameId: 'games', checkpointId: 'checkpoints' },
    naturalKey: (row) => (row.externalId ? key(row.gameId, row.origin, row.externalId) : null),
  },
  {
    name: 'achievementProgress',
    table: schema.achievementProgress,
    pk: ['playthroughId', 'achievementId'],
    fks: { playthroughId: 'playthroughs', achievementId: 'achievements' },
  },
  { name: 'settings', table: schema.settings, pk: ['key'], fks: {} },
];

/** Regenerable caches, exported only on request. */
export const CACHE_TABLES: TableSpec<ExportCacheName>[] = [
  { name: 'sourceCache', table: schema.sourceCache, pk: ['source', 'cacheKey'], fks: {} },
  { name: 'aiCache', table: schema.aiCache, pk: ['cacheKey'], fks: { gameId: 'games' } },
  {
    name: 'hintsCache',
    table: schema.hintsCache,
    pk: ['id'],
    fks: { gameId: 'games', checkpointId: 'checkpoints' },
    naturalKey: (row) => key(row.cacheKey),
  },
  { name: 'aiUsageLog', table: schema.aiUsageLog, pk: ['id'], fks: { gameId: 'games' } },
];

export function columnsOf(spec: TableSpec): Record<string, SQLiteColumn> {
  return getTableColumns(spec.table) as Record<string, SQLiteColumn>;
}

export function pkOf(spec: TableSpec, row: ExportRow): string {
  return key(...spec.pk.map((column) => row[column]));
}

/** Database row → export row. */
export function serializeRow(row: Record<string, unknown>): ExportRow {
  return Object.fromEntries(
    Object.entries(row).map(([name, value]) => [
      name,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

/** Export row → values Drizzle can insert. */
export function deserializeRow(spec: TableSpec, row: ExportRow): Record<string, unknown> {
  const columns = columnsOf(spec);
  return Object.fromEntries(
    Object.entries(row).map(([name, value]) => [
      name,
      columns[name]?.dataType === 'date' && typeof value === 'string' ? new Date(value) : value,
    ]),
  );
}
