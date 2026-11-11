import { nudgeListResponseSchema, statsResponseSchema } from '@gamebacklog/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { libraryEntries, playthroughs, sessions } from '../db/schema/index.ts';
import { seedDatabase } from '../db/seed.ts';
import { SETTINGS, setSetting } from '../settings/store.ts';
import { goalMinutes, streaks } from '../stats/service.ts';
import { createTestApp, type TestApp } from '../test/context.ts';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function stats() {
  const response = await t.app.inject({ method: 'GET', url: '/api/stats' });
  expect(response.statusCode).toBe(200);
  return statsResponseSchema.parse(response.json());
}

async function nudges() {
  const response = await t.app.inject({ method: 'GET', url: '/api/library/nudges' });
  expect(response.statusCode).toBe(200);
  return nudgeListResponseSchema.parse(response.json());
}

describe('GET /api/stats', () => {
  it('answers with zeros for an empty library', async () => {
    const empty = await stats();
    expect(empty.totals).toEqual({
      games: 0,
      playedMinutes: 0,
      completedGames: 0,
      droppedGames: 0,
      completionRate: null,
    });
    expect(empty.byGame).toEqual([]);
    expect(empty.diary).toMatchObject({ sessions: 0, currentStreak: 0, lastSessionOn: null });
    expect(empty.diary.byMonth).toHaveLength(12);
    expect(empty.reviews.averages.score).toBeNull();
  });

  it('sums up the example library', async () => {
    seedDatabase(t.ctx.db);
    const result = await stats();

    expect(result.totals).toMatchObject({
      games: 27,
      completedGames: 12,
      droppedGames: 4,
      // 12 finished out of 16 that were either finished or dropped.
      completionRate: 75,
    });
    expect(result.statusCounts).toMatchObject({ playing: 2, backlog: 7, wishlist: 1, paused: 1 });

    // Hours come from the runs: Elden Ring's 142h lead.
    expect(result.byGame[0]).toMatchObject({ title: 'Elden Ring', minutes: 142 * 60 });
    expect(result.totals.playedMinutes).toBe(
      result.byPlatform.reduce((sum, slice) => sum + slice.minutes, 0),
    );
    expect(result.byPlatform[0]?.label).toBe('PC');
    // Dark Souls has two runs on PC, but is one game.
    const pc = result.byPlatform.find((slice) => slice.label === 'PC');
    expect(pc?.games).toBe(10);
    expect(result.byGenre[0]).toMatchObject({ label: 'Role-playing (RPG)' });

    // Backlog: Hades 22h + Lies of P 29h + Blasphemous 13h + Slay the Spire 12h.
    expect(result.backlog).toEqual({ games: 7, minutes: 76 * 60, gamesWithoutTimes: 3 });

    // Two seed runs carry a finish date; the other finished games are undated.
    expect(result.completedByYear).toEqual([
      { year: 2026, games: 2 },
      { year: null, games: 11 },
    ]);

    expect(result.diary).toMatchObject({
      sessions: 3,
      longestStreak: 2,
      currentStreak: 0,
      lastSessionOn: '2026-10-29',
    });
    expect(result.minutesByYear).toEqual([{ year: 2026, minutes: 270 }]);
    expect(result.diary.byMonth.at(-1)).toMatchObject({ month: '2026-11', minutes: 0 });
    expect(result.diary.byMonth.at(-2)).toMatchObject({
      month: '2026-10',
      minutes: 150,
      sessions: 2,
    });
    expect(result.diary.byWeekday.reduce((sum, minutes) => sum + minutes, 0)).toBe(270);

    expect(result.reviews.count).toBe(17);
    expect(result.reviews.averages.score).toBe(7.7);
    expect(result.reviews.averages.levelDesignScore).toBe(9.8);
    expect(result.reviews.averages.perceivedLengthScore).toBe(8.3);
  });

  it('uses the diary for a game whose runs have no hours', async () => {
    seedDatabase(t.ctx.db);
    t.ctx.db
      .update(playthroughs)
      .set({ playtimeMinutes: null })
      .where(eq(playthroughs.libraryEntryId, 'seed-entry-ocarina-of-time'))
      .run();
    const n64 = (await stats()).byPlatform.find((slice) => slice.label === 'Nintendo 64');
    expect(n64).toEqual({ label: 'Nintendo 64', minutes: 150, games: 1 });
  });

  it('counts a streak that is still going', async () => {
    seedDatabase(t.ctx.db);
    for (const day of ['2026-11-08', '2026-11-09', '2026-11-10']) {
      t.ctx.db
        .insert(sessions)
        .values({
          libraryEntryId: 'seed-entry-celeste',
          startedAt: new Date(`${day}T15:00:00.000Z`),
          durationMinutes: 30,
        })
        .run();
    }
    expect((await stats()).diary).toMatchObject({ currentStreak: 3, longestStreak: 3 });
  });
});

describe('streaks and goal times', () => {
  it('finds the longest run of days and whether one is still alive', () => {
    const days = ['2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03', '2026-01-10'];
    expect(streaks(days, '2026-01-10')).toEqual({ current: 1, longest: 3 });
    // The day after the last session the streak still counts; two days after, it is over.
    expect(streaks(days, '2026-01-11').current).toBe(1);
    expect(streaks(days, '2026-01-12').current).toBe(0);
    expect(streaks([], '2026-01-01')).toEqual({ current: 0, longest: 0 });
    // Across a month boundary.
    expect(streaks(['2026-01-31', '2026-02-01'], '2026-02-01')).toEqual({ current: 2, longest: 2 });
  });

  it('picks the time to beat that matches the goal of the run', () => {
    const times = {
      origin: 'manual' as const,
      mainMinutes: 600,
      mainExtraMinutes: 900,
      completionistMinutes: 1500,
      originUrl: null,
      fetchedAt: null,
    };
    expect(goalMinutes(times, 'finish')).toBe(600);
    expect(goalMinutes(times, 'full_100')).toBe(1500);
    expect(goalMinutes({ ...times, completionistMinutes: null }, 'all_achievements')).toBe(900);
    expect(goalMinutes(null, 'finish')).toBeNull();
  });
});

describe('GET /api/library/nudges', () => {
  beforeEach(() => {
    seedDatabase(t.ctx.db);
    // The seed rows were "edited" when they were inserted; pretend that was long ago.
    t.ctx.db
      .update(libraryEntries)
      .set({ updatedAt: new Date('2026-09-01T12:00:00.000Z') })
      .run();
  });

  it('lists games being played that were left alone, closest to the end first', async () => {
    t.setNow('2026-11-20T12:00:00.000Z');
    const result = await nudges();
    expect(result.afterDays).toBe(14);
    expect(result.items).toEqual([
      // NG+ run going for every achievement: 9h of 70h.
      expect.objectContaining({
        title: 'Dark Souls: Remastered',
        daysIdle: 65,
        percent: 13,
        remainingMinutes: 61 * 60,
      }),
      // 100% run: 2.5h of 38h; last session on 29 October.
      expect.objectContaining({
        title: 'The Legend of Zelda: Ocarina of Time',
        daysIdle: 21,
        percent: 7,
        remainingMinutes: 35.5 * 60,
      }),
    ]);
  });

  it('leaves out games with recent activity, and follows the configured number of days', async () => {
    // 12 days after Ocarina's last session; Dark Souls has been idle for 55.
    expect((await nudges()).items.map((item) => item.title)).toEqual(['Dark Souls: Remastered']);

    setSetting(t.ctx.db, SETTINGS.nudgeAfterDays, 7);
    expect((await nudges()).items).toHaveLength(2);

    setSetting(t.ctx.db, SETTINGS.nudgeAfterDays, 90);
    expect((await nudges()).items).toEqual([]);
  });

  it('never calls a game 100% done, and copes with no time to beat', async () => {
    t.setNow('2026-12-20T12:00:00.000Z');
    t.ctx.db
      .update(playthroughs)
      .set({ playtimeMinutes: 100 * 60 })
      .where(eq(playthroughs.id, 'seed-run-dark-souls-2'))
      .run();
    t.ctx.db
      .update(libraryEntries)
      .set({ status: 'playing' })
      .where(eq(libraryEntries.id, 'seed-entry-cities-skylines'))
      .run();
    const items = (await nudges()).items;
    expect(items[0]).toMatchObject({
      title: 'Dark Souls: Remastered',
      percent: 99,
      remainingMinutes: null,
    });
    expect(items.at(-1)).toMatchObject({
      title: 'Cities: Skylines',
      percent: null,
      remainingMinutes: null,
    });
  });
});
