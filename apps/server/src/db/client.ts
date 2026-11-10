import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DATABASE_FILE_NAME } from '../paths.ts';
import * as schema from './schema/index.ts';

export type AppDatabase = ReturnType<typeof createDatabase>['db'];

export interface DatabaseHandle {
  db: AppDatabase;
  /** Closes the underlying SQLite connection. */
  close: () => void;
}

function createDatabase(filename: string) {
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  // SQLite ignores foreign keys unless asked to enforce them on every connection.
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/** Opens a database at an explicit path. Pass `:memory:` for an in-memory database (tests). */
export function openDatabase(filename: string): DatabaseHandle {
  const { db, sqlite } = createDatabase(filename);
  return { db, close: () => sqlite.close() };
}

/** Opens (creating if needed) the app database inside the data folder. */
export function openAppDatabase(dataDir: string): DatabaseHandle {
  mkdirSync(dataDir, { recursive: true });
  return openDatabase(path.join(dataDir, DATABASE_FILE_NAME));
}
