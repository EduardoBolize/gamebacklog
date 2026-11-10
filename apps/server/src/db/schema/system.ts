import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { updatedAt } from './columns.ts';

/**
 * User preferences as key → JSON value.
 * Never store API keys or tokens here: secrets live in the OS keychain.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/** Internal bookkeeping, e.g. `data_schema_version`. */
export const schemaMeta = sqliteTable('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});
