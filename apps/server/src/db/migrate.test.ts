import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_SCHEMA_VERSION } from '@gamebacklog/shared';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { DATABASE_FILE_NAME } from '../paths.ts';
import { openAppDatabase, openDatabase, type DatabaseHandle } from './client.ts';
import { readDataSchemaVersion, runMigrations } from './migrate.ts';
import { games, libraryEntries, playthroughs, reviews } from './schema/index.ts';

const EXPECTED_TABLES = [
  'achievement_progress',
  'achievements',
  'ai_cache',
  'ai_usage_log',
  'chapter_maps',
  'checkpoints',
  'collectible_progress',
  'collectibles',
  'game_external_ids',
  'game_times',
  'games',
  'hints_cache',
  'library_entries',
  'playthroughs',
  'progress_events',
  'reviews',
  'schema_meta',
  'sessions',
  'settings',
  'source_cache',
];

const open: DatabaseHandle[] = [];
const tempDirs: string[] = [];

function migratedMemoryDb() {
  const handle = openDatabase(':memory:');
  open.push(handle);
  runMigrations(handle.db);
  return handle.db;
}

function listTables(db: DatabaseHandle['db']): string[] {
  return db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name`,
    )
    .map((row) => row.name);
}

afterEach(() => {
  for (const handle of open.splice(0)) handle.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runMigrations', () => {
  it('creates the database file and every table inside the data folder', () => {
    const dataDir = path.join(
      mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-')),
      'nested',
      'data',
    );
    tempDirs.push(path.resolve(dataDir, '..', '..'));

    const handle = openAppDatabase(dataDir);
    open.push(handle);
    runMigrations(handle.db);

    expect(existsSync(path.join(dataDir, DATABASE_FILE_NAME))).toBe(true);
    expect(listTables(handle.db)).toEqual(EXPECTED_TABLES);
  });

  it('records the data schema version', () => {
    const db = migratedMemoryDb();
    expect(readDataSchemaVersion(db)).toBe(DATA_SCHEMA_VERSION);
  });

  it('is safe to run again on an up-to-date database', () => {
    const db = migratedMemoryDb();
    expect(() => runMigrations(db)).not.toThrow();
    expect(listTables(db)).toEqual(EXPECTED_TABLES);
    expect(readDataSchemaVersion(db)).toBe(DATA_SCHEMA_VERSION);
  });
});

describe('schema constraints', () => {
  function insertGameWithEntry(db: DatabaseHandle['db']) {
    db.insert(games).values({ id: 'g1', title: 'Test Game', origin: 'manual' }).run();
    db.insert(libraryEntries).values({ id: 'e1', gameId: 'g1', status: 'playing' }).run();
  }

  it('fills defaults: UUID ids, timestamps and empty lists', () => {
    const db = migratedMemoryDb();
    const [game] = db
      .insert(games)
      .values({ title: 'Defaults', origin: 'manual' })
      .returning()
      .all();
    expect(game?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(game?.createdAt).toBeInstanceOf(Date);
    expect(game?.platforms).toEqual([]);
    expect(game?.genres).toEqual([]);
  });

  it('enforces foreign keys', () => {
    const db = migratedMemoryDb();
    expect(() =>
      db.insert(libraryEntries).values({ gameId: 'missing', status: 'backlog' }).run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('refuses to delete a game that is in the library', () => {
    const db = migratedMemoryDb();
    insertGameWithEntry(db);
    expect(() => db.delete(games).run()).toThrow(/FOREIGN KEY/);
  });

  it('allows a single library entry per game', () => {
    const db = migratedMemoryDb();
    insertGameWithEntry(db);
    expect(() =>
      db.insert(libraryEntries).values({ gameId: 'g1', status: 'backlog' }).run(),
    ).toThrow(/UNIQUE/);
  });

  it('supports several playthroughs per game and removes them with the library entry', () => {
    const db = migratedMemoryDb();
    insertGameWithEntry(db);
    db.insert(playthroughs)
      .values([
        { libraryEntryId: 'e1', number: 1 },
        { libraryEntryId: 'e1', number: 2, type: 'ng_plus', goal: 'all_achievements' },
      ])
      .run();
    expect(db.select().from(playthroughs).all()).toHaveLength(2);

    db.delete(libraryEntries).run();
    expect(db.select().from(playthroughs).all()).toHaveLength(0);
  });

  it('accepts review scores from 0 to 10 in half-point steps only', () => {
    const db = migratedMemoryDb();
    insertGameWithEntry(db);
    db.insert(playthroughs).values({ id: 'p1', libraryEntryId: 'e1', number: 1 }).run();

    db.insert(reviews).values({ libraryEntryId: 'e1', playthroughId: 'p1', score: 8.5 }).run();
    expect(() => db.insert(reviews).values({ libraryEntryId: 'e1', score: 10.5 }).run()).toThrow(
      /CHECK/,
    );
    expect(() => db.insert(reviews).values({ libraryEntryId: 'e1', score: 7.3 }).run()).toThrow(
      /CHECK/,
    );
    expect(() => db.insert(reviews).values({ libraryEntryId: 'e1', storyScore: -1 }).run()).toThrow(
      /CHECK/,
    );
  });

  it('allows one review per playthrough and one game-level review', () => {
    const db = migratedMemoryDb();
    insertGameWithEntry(db);
    db.insert(playthroughs).values({ id: 'p1', libraryEntryId: 'e1', number: 1 }).run();

    db.insert(reviews).values({ libraryEntryId: 'e1', playthroughId: 'p1', score: 9 }).run();
    db.insert(reviews).values({ libraryEntryId: 'e1', score: 8 }).run();

    expect(() =>
      db.insert(reviews).values({ libraryEntryId: 'e1', playthroughId: 'p1', score: 7 }).run(),
    ).toThrow(/UNIQUE/);
    expect(() => db.insert(reviews).values({ libraryEntryId: 'e1', score: 6 }).run()).toThrow(
      /UNIQUE/,
    );
  });
});
