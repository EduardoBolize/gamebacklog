import { LIBRARY_STATUSES } from '@gamebacklog/shared';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase, type DatabaseHandle } from './client.ts';
import { runMigrations } from './migrate.ts';
import { games, libraryEntries, playthroughs, reviews } from './schema/index.ts';
import { seedDatabase } from './seed.ts';

const open: DatabaseHandle[] = [];

function seededDb(): AppDatabase {
  const handle = openDatabase(':memory:');
  open.push(handle);
  runMigrations(handle.db);
  seedDatabase(handle.db);
  return handle.db;
}

function rowCounts(db: AppDatabase): Record<string, number> {
  const tables = db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name`,
  );
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db.get<{ count: number }>(sql`select count(*) as count from ${sql.identifier(name)}`)
        ?.count ?? 0,
    ]),
  );
}

afterEach(() => {
  for (const handle of open.splice(0)) handle.close();
});

describe('seedDatabase', () => {
  it('adds example games across several platforms and every library status', () => {
    const db = seededDb();
    expect(db.select().from(games).all()).toHaveLength(27);

    const statuses = db
      .select({ status: libraryEntries.status })
      .from(libraryEntries)
      .all()
      .map((row) => row.status);
    expect(new Set(statuses)).toEqual(new Set(LIBRARY_STATUSES));
  });

  it('has more than 15 rated games, for the taste profile to work with', () => {
    const db = seededDb();
    const rated = db
      .selectDistinct({ entryId: reviews.libraryEntryId })
      .from(reviews)
      .where(isNotNull(reviews.score))
      .all();
    expect(rated.length).toBeGreaterThanOrEqual(15);
  });

  it('includes a game with a finished run and an NG+ run', () => {
    const db = seededDb();
    const runs = db
      .select()
      .from(playthroughs)
      .where(eq(playthroughs.libraryEntryId, 'seed-entry-dark-souls-remastered'))
      .orderBy(playthroughs.number)
      .all();
    expect(runs.map((run) => [run.number, run.type, run.status])).toEqual([
      [1, 'normal', 'completed'],
      [2, 'ng_plus', 'playing'],
    ]);
  });

  it('includes a review with sub-scores', () => {
    const db = seededDb();
    const review = db
      .select()
      .from(reviews)
      .where(eq(reviews.id, 'seed-review-hollow-knight'))
      .get();
    expect(review).toMatchObject({ score: 9.5, levelDesignScore: 10, hasSpoilers: false });
    expect(review?.pros.length).toBeGreaterThan(0);
  });

  it('touches every user-data table', () => {
    const counts = rowCounts(seededDb());
    for (const table of [
      'games',
      'game_external_ids',
      'game_times',
      'library_entries',
      'playthroughs',
      'chapter_maps',
      'checkpoints',
      'progress_events',
      'sessions',
      'reviews',
      'achievements',
      'achievement_progress',
      'collectibles',
      'collectible_progress',
    ]) {
      expect(counts[table], table).toBeGreaterThan(0);
    }
  });

  it('is idempotent and never overwrites edits', () => {
    const db = seededDb();
    db.update(libraryEntries)
      .set({ status: 'dropped' })
      .where(eq(libraryEntries.id, 'seed-entry-celeste'))
      .run();
    const before = rowCounts(db);

    seedDatabase(db);

    expect(rowCounts(db)).toEqual(before);
    const celeste = db
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.id, 'seed-entry-celeste'))
      .get();
    expect(celeste?.status).toBe('dropped');
  });
});
