import { randomUUID } from 'node:crypto';
import { integer, text } from 'drizzle-orm/sqlite-core';

/**
 * Shared column builders.
 *
 * Conventions used across the schema:
 * - Primary keys are UUID strings, so rows keep their identity across export/import and
 *   two installs can be merged without remapping IDs.
 * - Instants are integer epoch milliseconds (`timestamp_ms`), surfaced as `Date`.
 * - Calendar dates (release date, started/finished on) are ISO `YYYY-MM-DD` text.
 * - Durations are integer minutes.
 * - Lists are JSON text.
 */

export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** Non-null boolean flag that defaults to false. */
export const flag = (name: string) => integer(name, { mode: 'boolean' }).notNull().default(false);

export const stringArray = (name: string) =>
  text(name, { mode: 'json' }).$type<string[]>().notNull().default([]);

export const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
