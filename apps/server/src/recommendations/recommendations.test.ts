import type { RecommendedGame } from '@gamebacklog/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { libraryEntries, reviews } from '../db/schema/index.ts';
import { seedDatabase } from '../db/seed.ts';
import { createTestApp, type TestApp } from '../test/context.ts';
import { buildTasteProfile, entryWeight, scoreGame, type TasteSignal } from './profile.ts';
import { getPlayNext, getTasteProfile } from './service.ts';
import { achievementShape, featureSimilarity, shapeSimilarity } from './similarity.ts';

const signal = (overrides: Partial<TasteSignal> & { entryId: string }): TasteSignal => ({
  title: overrides.entryId,
  status: 'completed',
  isFavorite: false,
  score: null,
  platform: null,
  genres: [],
  themes: [],
  tags: [],
  franchise: null,
  platforms: [],
  ...overrides,
});

const blank = { genres: [], themes: [], tags: [], franchise: null, platforms: [] };

describe('entryWeight', () => {
  const weight = (status: TasteSignal['status'], score: number | null, isFavorite = false) =>
    entryWeight({ status, score, isFavorite });

  it('counts a finished game with a high score the most', () => {
    expect(weight('completed_100', 10)).toBeGreaterThan(weight('completed', 10) ?? 0);
    expect(weight('completed', 10)).toBeGreaterThan(weight('playing', 10) ?? 0);
    expect(weight('completed', 10)).toBeGreaterThan(weight('completed', 8) ?? 0);
    expect(weight('completed', 6)).toBe(0);
  });

  it('counts a dropped game against its features, whatever the score', () => {
    expect(weight('dropped', null)).toBeLessThan(0);
    expect(weight('dropped', 9)).toBeLessThan(0);
    expect(weight('dropped', 3)).toBeLessThan(weight('dropped', 9) ?? 0);
  });

  it('does not let finishing a game make a bad score worse', () => {
    expect(weight('completed_100', 2)).toBe(weight('completed', 2));
    expect(weight('completed', 2)).toBeLessThan(0);
  });

  it('says nothing about games that were never played', () => {
    expect(weight('backlog', null)).toBeNull();
    expect(weight('wishlist', null)).toBeNull();
  });

  it('adds a bonus for favourites, but only to games the user liked', () => {
    expect(weight('completed', 8, true)).toBeGreaterThan(weight('completed', 8) ?? 0);
    expect(weight('dropped', null, true)).toBe(weight('dropped', null));
  });

  it('gives finished and ongoing games a mild positive signal when unrated', () => {
    expect(weight('completed', null)).toBeGreaterThan(weight('playing', null) ?? 0);
    expect(weight('playing', null)).toBeGreaterThan(weight('paused', null) ?? 0);
    expect(weight('paused', null)).toBeGreaterThan(0);
  });
});

describe('taste profile', () => {
  it('trusts a genre more the more liked games it has', () => {
    const oneLoved = buildTasteProfile([signal({ entryId: 'a', score: 10, genres: ['Puzzle'] })]);
    const manyLiked = buildTasteProfile(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((entryId) =>
        signal({ entryId, score: 9, genres: ['Puzzle'] }),
      ),
    );
    const candidate = { ...blank, genres: ['Puzzle'] };
    expect(scoreGame(manyLiked, candidate).score).toBeGreaterThan(
      scoreGame(oneLoved, candidate).score,
    );
  });

  it('scores a game the profile knows nothing about as neutral', () => {
    const profile = buildTasteProfile([signal({ entryId: 'a', score: 10, genres: ['Puzzle'] })]);
    const fit = scoreGame(profile, { ...blank, genres: ['Racing'], tags: ['driving'] });
    expect(fit).toMatchObject({ score: 0, affinity: 50, reasons: [] });
  });

  it('compares features without regard to case', () => {
    const profile = buildTasteProfile([signal({ entryId: 'a', score: 10, tags: ['Soulslike'] })]);
    expect(scoreGame(profile, { ...blank, tags: ['soulslike'] }).affinity).toBeGreaterThan(50);
  });

  it('explains a score with the features behind it and the games behind those', () => {
    const profile = buildTasteProfile([
      signal({ entryId: 'a', title: 'Loved RPG', score: 10, genres: ['RPG'] }),
      signal({ entryId: 'b', title: 'Liked RPG', score: 8, genres: ['RPG'] }),
      signal({ entryId: 'c', title: 'Hated Racer', status: 'dropped', genres: ['Racing'] }),
    ]);
    const fit = scoreGame(profile, { ...blank, genres: ['RPG', 'Racing'] });
    expect(fit.reasons).toEqual([
      expect.objectContaining({
        dimension: 'genre',
        value: 'RPG',
        because: ['Loved RPG', 'Liked RPG'],
      }),
      expect.objectContaining({ dimension: 'genre', value: 'Racing', because: ['Hated Racer'] }),
    ]);
    expect(fit.reasons[0]?.weight).toBeGreaterThan(0);
    expect(fit.reasons[1]?.weight).toBeLessThan(0);
  });

  it("leaves a library game's own vote out when scoring that game", () => {
    const profile = buildTasteProfile([
      signal({ entryId: 'a', score: 10, genres: ['Puzzle'], status: 'paused' }),
    ]);
    const game = { ...blank, genres: ['Puzzle'] };
    expect(scoreGame(profile, game).affinity).toBeGreaterThan(50);
    expect(scoreGame(profile, game, { excludeEntryId: 'a' }).affinity).toBe(50);
  });

  it('counts only the platform the user actually played on', () => {
    const profile = buildTasteProfile([
      signal({ entryId: 'a', score: 10, platform: 'Switch', platforms: ['Switch', 'PC'] }),
    ]);
    expect(scoreGame(profile, { ...blank, platforms: ['PC'] }).affinity).toBe(50);
    expect(scoreGame(profile, { ...blank, platforms: ['PC', 'Switch'] }).affinity).toBeGreaterThan(
      50,
    );
  });
});

describe('similarity', () => {
  it('compares only what both games have data for, and rewards a shared franchise', () => {
    const a = { ...blank, genres: ['Platform', 'Adventure'], tags: ['metroidvania'] };
    const same = featureSimilarity(a, { ...blank, genres: ['Adventure', 'Platform'] });
    expect(same.similarity).toBeCloseTo(0.85);
    expect(same.shared).toEqual(['Platform', 'Adventure']);

    expect(featureSimilarity(a, { ...blank, genres: ['Racing'] }).similarity).toBe(0);
    expect(featureSimilarity(a, blank).similarity).toBe(0);

    const series = featureSimilarity(
      { ...a, franchise: 'Metroid' },
      { ...blank, genres: ['Shooter'], franchise: 'metroid' },
    );
    expect(series.similarity).toBeCloseTo(0.15);
    expect(series.shared).toEqual(['Metroid']);
  });

  it('describes an achievement list by its size and its rare end', () => {
    expect(achievementShape([])).toBeNull();
    expect(achievementShape([null, null])).toEqual({
      count: 2,
      medianPercent: null,
      rarestPercent: null,
      rareShare: null,
      completionRatio: null,
    });
    expect(
      achievementShape([80, 60, 40, 5, 1], { mainMinutes: 600, completionistMinutes: 1500 }),
    ).toEqual({
      count: 5,
      medianPercent: 40,
      rarestPercent: 1,
      rareShare: 0.4,
      completionRatio: 2.5,
    });
  });

  it('finds lists of similar size and difficulty more alike', () => {
    const hard = achievementShape([60, 30, 10, 4, 2, 1]);
    const alsoHard = achievementShape([55, 35, 12, 5, 2, 1, 1]);
    const easy = achievementShape([95, 90, 85, 80, 75, 70]);
    if (!hard || !alsoHard || !easy) throw new Error('shape expected');
    expect(shapeSimilarity(hard, hard)).toBe(1);
    expect(shapeSimilarity(hard, alsoHard)).toBeGreaterThan(0.85);
    expect(shapeSimilarity(hard, easy)).toBeLessThan(0.4);
  });
});

describe('what to play now, on the example library', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    seedDatabase(t.ctx.db);
  });
  afterEach(() => t.close());

  const playNext = () => getPlayNext(t.ctx, 'pt-BR');
  const titles = (items: RecommendedGame[]) => items.map((item) => item.title);
  const affinity = (items: RecommendedGame[], title: string) => {
    const item = items.find((candidate) => candidate.title === title);
    if (item?.affinity == null) throw new Error(`${title} is not ranked`);
    return item.affinity;
  };
  const setScore = (slugs: string[], score: number) =>
    t.ctx.db
      .update(reviews)
      .set({ score })
      .where(
        inArray(
          reviews.id,
          slugs.map((slug) => `seed-review-${slug}`),
        ),
      )
      .run();

  it('ranks the backlog by how close each game is to what was played and liked', () => {
    const { profileReady, backlog } = playNext();
    expect(profileReady).toBe(true);
    // Soulslikes and metroidvanias were loved; strategy and simulation games were dropped.
    expect(titles(backlog)).toEqual([
      'Hollow Knight: Silksong',
      'Lies of P',
      'Blasphemous',
      'Hades',
      'Slay the Spire',
      'Football Manager 2024',
      'Cities: Skylines',
    ]);
    expect(affinity(backlog, 'Lies of P')).toBeGreaterThan(65);
    expect(affinity(backlog, 'Cities: Skylines')).toBeLessThan(45);
  });

  it('says why, naming the games behind each reason', () => {
    const liesOfP = playNext().backlog.find((item) => item.title === 'Lies of P');
    const soulslike = liesOfP?.reasons.find((reason) => reason.value === 'soulslike');
    expect(soulslike).toMatchObject({ dimension: 'tag' });
    expect(soulslike?.because[0]).toBe('Elden Ring');

    const cities = playNext().backlog.at(-1);
    expect(cities?.reasons.some((reason) => reason.weight < 0)).toBe(true);
  });

  it('moves a game down when the games like it get worse scores', () => {
    const before = playNext().backlog;
    setScore(['bloodborne', 'elden-ring', 'sekiro', 'dark-souls-first-run'], 2);
    const after = playNext().backlog;

    const drop = (title: string) => affinity(before, title) - affinity(after, title);
    expect(drop('Lies of P')).toBeGreaterThan(15);
    expect(titles(after).indexOf('Lies of P')).toBeGreaterThan(titles(before).indexOf('Lies of P'));
    // A game that shares only the platform with them barely moves.
    expect(Math.abs(drop('Cities: Skylines'))).toBeLessThan(5);
    expect(titles(after)[0]).toBe('Hollow Knight: Silksong');
  });

  it('moves a game up when the games like it get better scores and are finished', () => {
    const before = playNext().backlog;
    setScore(['civilization-vi', 'stardew-valley'], 10);
    t.ctx.db
      .update(libraryEntries)
      .set({ status: 'completed' })
      .where(
        inArray(libraryEntries.id, ['seed-entry-civilization-vi', 'seed-entry-stardew-valley']),
      )
      .run();
    const after = playNext().backlog;

    for (const title of ['Cities: Skylines', 'Slay the Spire', 'Football Manager 2024']) {
      expect(affinity(after, title), title).toBeGreaterThan(affinity(before, title));
    }
    expect(affinity(after, 'Cities: Skylines')).toBeGreaterThan(50);
    expect(titles(after).indexOf('Cities: Skylines')).toBeLessThan(
      titles(before).indexOf('Cities: Skylines'),
    );
  });

  it('suggests going back to paused games, and to dropped ones only when nothing says no', () => {
    // Every dropped game in the seed has a score below 6: none of them comes back.
    expect(titles(playNext().resume)).toEqual(['Celeste']);
    expect(playNext().resume[0]).toMatchObject({ status: 'paused', playedPercent: 50 });

    // Dropped without a verdict, in a genre the user loves: worth another try.
    t.ctx.db.delete(reviews).where(eq(reviews.id, 'seed-review-persona-5-royal')).run();
    const resume = playNext().resume;
    expect(titles(resume)).toEqual(['Celeste', 'Persona 5 Royal']);
    expect(resume[1]).toMatchObject({ status: 'dropped', playedPercent: 20 });
  });

  it('summarises the profile with likes and dislikes per dimension', () => {
    const profile = getTasteProfile(t.ctx);
    expect(profile.ratedGames).toBe(17);
    const tags = profile.dimensions.find((item) => item.dimension === 'tag');
    expect(tags?.liked.find((feature) => feature.value === 'soulslike')).toMatchObject({
      games: 4,
      because: ['Elden Ring', 'Bloodborne', 'Dark Souls: Remastered'],
    });
    const genres = profile.dimensions.find((item) => item.dimension === 'genre');
    expect(genres?.disliked.map((feature) => feature.value)).toContain('Strategy');
  });

  it('lists the backlog unranked while no game says anything about taste', async () => {
    const empty = await createTestApp();
    try {
      seedDatabase(empty.ctx.db);
      empty.ctx.db.delete(reviews).run();
      empty.ctx.db.update(libraryEntries).set({ status: 'backlog', isFavorite: false }).run();
      const result = getPlayNext(empty.ctx, 'pt-BR');
      expect(result.profileReady).toBe(false);
      expect(result.backlog[0]).toMatchObject({ affinity: null, reasons: [] });
      expect(titles(result.backlog)).toEqual([...titles(result.backlog)].sort());
    } finally {
      await empty.close();
    }
  });
});
