import {
  explainRecommendationsResponseSchema,
  favoriteGenreResponseSchema,
  playNextResponseSchema,
  similarCompletionResponseSchema,
  similarGamesResponseSchema,
  tasteProfileResponseSchema,
  type GameDetailResponse,
} from '@gamebacklog/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { achievements } from '../db/schema/index.ts';
import { catalogGame, createTestApp, type TestApp } from '../test/context.ts';

let t: TestApp;

async function call(method: string, url: string, payload?: unknown) {
  const response = await t.app.inject({
    method: method as 'GET',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json<unknown>() };
}

/** Calls a route and checks the answer against the contract the web app uses. */
async function get<T>(schema: z.ZodType<T>, url: string): Promise<T> {
  const { status, body } = await call('GET', url);
  expect(status, url).toBe(200);
  return schema.parse(body);
}

async function add(externalId: string, status: string) {
  const { body } = await call('POST', '/api/library', {
    status,
    game: { kind: 'igdb', externalId },
  });
  return (body as { libraryEntryId: string }).libraryEntryId;
}

async function addManual(title: string, status: string) {
  const { body } = await call('POST', '/api/library', { status, game: { kind: 'manual', title } });
  return (body as { libraryEntryId: string }).libraryEntryId;
}

const review = (entryId: string, score: number) =>
  call('PUT', `/api/library/${entryId}/reviews`, {
    playthroughId: null,
    score,
    difficultyScore: null,
    storyScore: null,
    gameplayScore: null,
    levelDesignScore: null,
    soundtrackScore: null,
    visualsScore: null,
    perceivedLengthScore: null,
    body: null,
    pros: [],
    cons: [],
    hasSpoilers: false,
    timeToBeatMinutes: null,
  });

async function giveAchievements(entryId: string, percents: number[]) {
  const { body } = await call('GET', `/api/library/${entryId}`);
  const gameId = (body as GameDetailResponse).game.id;
  t.ctx.db
    .insert(achievements)
    .values(
      percents.map((globalPercent, index) => ({
        gameId,
        origin: 'manual' as const,
        name: `Achievement ${index + 1}`,
        globalPercent,
        sortOrder: index,
      })),
    )
    .run();
}

const HARD_LIST = [70, 45, 20, 8, 3, 1];
const EASY_LIST = [99, 97, 95, 93, 90, 88, 85, 80, 78, 75, 72, 70, 68, 65, 60, 58, 55, 52, 50, 48];

const ID = {
  hollowKnight: '1',
  ori: '2',
  deadCells: '3',
  stellaris: '4',
  silksong: '5',
  celeste: '6',
} as const;

beforeEach(async () => {
  t = await createTestApp();
  const platformer = { genres: ['Platform', 'Adventure'], themes: ['Fantasy'] };
  t.sources.catalog = [
    catalogGame({
      externalId: ID.hollowKnight,
      title: 'Hollow Knight',
      ...platformer,
      tags: ['metroidvania'],
      franchise: 'Hollow Knight',
      steamAppIds: ['367520'],
    }),
    catalogGame({
      externalId: ID.ori,
      title: 'Ori and the Blind Forest',
      ...platformer,
      tags: ['metroidvania'],
      steamAppIds: ['387290'],
    }),
    catalogGame({
      externalId: ID.deadCells,
      title: 'Dead Cells',
      genres: ['Platform'],
      tags: ['roguelike', 'metroidvania'],
      steamAppIds: ['588650'],
    }),
    catalogGame({
      externalId: ID.stellaris,
      title: 'Stellaris',
      genres: ['Strategy'],
      themes: ['Science fiction'],
      tags: ['4x'],
      steamAppIds: ['281990'],
    }),
    catalogGame({
      externalId: ID.silksong,
      title: 'Hollow Knight: Silksong',
      ...platformer,
      franchise: 'Hollow Knight',
      steamAppIds: ['1030300'],
    }),
    catalogGame({
      externalId: ID.celeste,
      title: 'Celeste',
      genres: ['Platform'],
      tags: ['precision platformer'],
    }),
  ];
  t.sources.similarGames[ID.hollowKnight] = [ID.silksong, ID.ori, ID.deadCells];
});

afterEach(() => t.close());

/** A small library: one loved game, and a backlog with a close match and a far one. */
async function library() {
  const hollowKnight = await add(ID.hollowKnight, 'completed');
  await review(hollowKnight, 9.5);
  const ori = await add(ID.ori, 'backlog');
  const stellaris = await add(ID.stellaris, 'backlog');
  return { hollowKnight, ori, stellaris };
}

describe('GET /api/recommendations/profile', () => {
  it('is empty for an empty library', async () => {
    const profile = await get(tasteProfileResponseSchema, '/api/recommendations/profile');
    expect(profile).toMatchObject({ ratedGames: 0, signalGames: 0 });
    expect(profile.dimensions.every((item) => item.liked.length === 0)).toBe(true);
  });

  it('reflects the games the user rated', async () => {
    await library();
    const profile = await get(tasteProfileResponseSchema, '/api/recommendations/profile');
    expect(profile).toMatchObject({ ratedGames: 1, signalGames: 1 });
    const genres = profile.dimensions.find((item) => item.dimension === 'genre');
    expect(genres?.liked.map((feature) => feature.value)).toEqual(['Adventure', 'Platform']);
    expect(genres?.liked[0]?.because).toEqual(['Hollow Knight']);
  });
});

describe('GET /api/recommendations/play-next', () => {
  it('ranks the backlog and works with no AI connected', async () => {
    const { ori, stellaris } = await library();
    const result = await get(playNextResponseSchema, '/api/recommendations/play-next');
    expect(result.profileReady).toBe(true);
    expect(result.backlog.map((item) => item.libraryEntryId)).toEqual([ori, stellaris]);
    expect(result.backlog[0]?.affinity).toBeGreaterThan(result.backlog[1]?.affinity ?? 100);
    expect(result.backlog[0]).toMatchObject({ key: `entry:${ori}`, status: 'backlog', line: null });
    expect(t.ai.requests).toHaveLength(0);
  });

  it('answers with empty lists for an empty library', async () => {
    const result = await get(playNextResponseSchema, '/api/recommendations/play-next');
    expect(result).toEqual({ profileReady: false, backlog: [], resume: [] });
  });
});

describe('GET /api/recommendations/similar/:id', () => {
  it('joins what IGDB lists as similar with similar games from the library', async () => {
    const { hollowKnight, ori } = await library();
    await add(ID.celeste, 'completed');
    const result = await get(
      similarGamesResponseSchema,
      `/api/recommendations/similar/${hollowKnight}`,
    );

    expect(result.catalog).toBe('ok');
    expect(result.game.title).toBe('Hollow Knight');
    // Stellaris shares nothing; Celeste is already finished.
    expect(result.items.map((item) => item.title)).toEqual([
      'Hollow Knight: Silksong',
      'Ori and the Blind Forest',
      'Dead Cells',
    ]);

    const [silksong, oriItem, deadCells] = result.items;
    expect(silksong).toMatchObject({
      key: `igdb:${ID.silksong}`,
      libraryEntryId: null,
      igdbId: ID.silksong,
      listedBySource: true,
      source: { origin: 'igdb' },
    });
    expect(silksong?.shared).toContain('Hollow Knight');
    expect(oriItem).toMatchObject({ libraryEntryId: ori, status: 'backlog', listedBySource: true });
    expect(oriItem?.shared).toEqual(expect.arrayContaining(['Platform', 'metroidvania']));
    expect(deadCells?.similarity).toBeLessThan(oriItem?.similarity ?? 0);
    expect(silksong?.affinity).toBeGreaterThan(50);
  });

  it('falls back to the library alone when IGDB is not configured or is down', async () => {
    const { hollowKnight } = await library();
    const url = `/api/recommendations/similar/${hollowKnight}`;

    t.sources.catalogConfigured = false;
    const offline = await get(similarGamesResponseSchema, url);
    expect(offline.catalog).toBe('not_configured');
    expect(offline.items.map((item) => item.title)).toEqual(['Ori and the Blind Forest']);
    expect(offline.items[0]).toMatchObject({ similarity: 85, listedBySource: false });

    t.sources.catalogConfigured = true;
    t.sources.catalogFail = true;
    expect((await get(similarGamesResponseSchema, url)).catalog).toBe('failed');
  });

  it('says so when the game has no catalog ID to look similar games up with', async () => {
    const manual = await addManual('Jogo Caseiro', 'playing');
    const result = await get(similarGamesResponseSchema, `/api/recommendations/similar/${manual}`);
    expect(result).toMatchObject({ catalog: 'no_catalog_id', items: [] });
  });

  it('answers 404 for an unknown library entry', async () => {
    expect((await call('GET', '/api/recommendations/similar/nope')).status).toBe(404);
  });
});

describe('GET /api/recommendations/completion/:id', () => {
  it('finds games whose achievement list has a similar shape', async () => {
    const { hollowKnight, ori, stellaris } = await library();
    await giveAchievements(hollowKnight, HARD_LIST);
    await giveAchievements(ori, [65, 50, 22, 9, 4, 2, 1]);
    await giveAchievements(stellaris, EASY_LIST);
    // Outside the library, only Steam's public percentages are available.
    t.sources.globalPercentages['1030300'] = { a: 72, b: 40, c: 18, d: 7, e: 2 };

    const result = await get(
      similarCompletionResponseSchema,
      `/api/recommendations/completion/${hollowKnight}`,
    );
    expect(result.shape).toMatchObject({ count: 6, medianPercent: 14, rarestPercent: 1 });
    expect(result.items.map((item) => item.title).sort()).toEqual([
      'Hollow Knight: Silksong',
      'Ori and the Blind Forest',
    ]);
    for (const item of result.items) {
      expect(item.similarity).toBeGreaterThan(80);
      expect(item.shape?.count).toBeGreaterThan(0);
    }
    expect(result.items.find((item) => item.igdbId === ID.silksong)).toMatchObject({
      libraryEntryId: null,
      listedBySource: true,
    });
  });

  it('has nothing to compare while the game has no achievements stored', async () => {
    const { hollowKnight } = await library();
    const result = await get(
      similarCompletionResponseSchema,
      `/api/recommendations/completion/${hollowKnight}`,
    );
    expect(result).toMatchObject({ shape: null, items: [] });
  });

  it('still compares library games when IGDB is down', async () => {
    const { hollowKnight, ori } = await library();
    await giveAchievements(hollowKnight, HARD_LIST);
    await giveAchievements(ori, HARD_LIST);
    t.sources.catalogFail = true;
    const result = await get(
      similarCompletionResponseSchema,
      `/api/recommendations/completion/${hollowKnight}`,
    );
    expect(result.catalog).toBe('failed');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ libraryEntryId: ori, similarity: 100 });
  });
});

describe('GET /api/recommendations/genre', () => {
  it('opens on the favourite genre, with library games and catalog discoveries', async () => {
    const { ori } = await library();
    const result = await get(favoriteGenreResponseSchema, '/api/recommendations/genre');

    expect(result.genre).toBe('Adventure');
    expect(result.genres).toEqual(['Adventure', 'Platform', 'Strategy']);
    expect(result.catalog).toBe('ok');
    expect(result.inLibrary.map((item) => item.libraryEntryId)).toEqual([ori]);
    // Games already in the library are never "discoveries".
    expect(result.discover.map((item) => item.title)).toEqual(['Hollow Knight: Silksong']);
  });

  it('lets the user pick another genre and ranks discoveries by fit', async () => {
    await library();
    const result = await get(
      favoriteGenreResponseSchema,
      '/api/recommendations/genre?genre=platform',
    );
    expect(result.genre).toBe('Platform');
    expect(result.discover.map((item) => item.title)).toEqual([
      'Hollow Knight: Silksong',
      'Dead Cells',
      'Celeste',
    ]);
    const fits = result.discover.map((item) => item.affinity ?? 0);
    expect(fits).toEqual([...fits].sort((a, b) => b - a));
  });

  it('shows only library games when IGDB is not configured', async () => {
    await library();
    t.sources.catalogConfigured = false;
    const result = await get(favoriteGenreResponseSchema, '/api/recommendations/genre');
    expect(result).toMatchObject({ catalog: 'not_configured', discover: [] });
    expect(result.inLibrary).toHaveLength(1);
  });

  it('has no genre to offer for an empty library', async () => {
    const result = await get(favoriteGenreResponseSchema, '/api/recommendations/genre');
    expect(result).toMatchObject({ genre: null, genres: [], inLibrary: [], discover: [] });
  });
});

describe('POST /api/recommendations/explain', () => {
  const explain = (body: object) => call('POST', '/api/recommendations/explain', body);
  const playNext = { list: 'play_next', locale: 'pt-BR' };

  it('needs an AI: the lists themselves never do', async () => {
    await library();
    const { status, body } = await explain(playNext);
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: 'ai_not_connected' });
  });

  it('asks for every line in one request, then answers from the cache', async () => {
    const { ori, stellaris, hollowKnight } = await library();
    t.ai.connected = true;
    t.ai.answers = [
      {
        lines: [
          { game: 1, line: 'Tem a exploração que você adorou em Hollow Knight.' },
          { game: 2, line: 'Estratégia espacial, fora do que você costuma jogar.' },
          { game: 9, line: 'Linha para um jogo que não existe.' },
        ],
      },
    ];

    const first = await explain(playNext);
    expect(first.status).toBe(200);
    expect(explainRecommendationsResponseSchema.parse(first.body)).toEqual({
      cached: false,
      lines: {
        [`entry:${ori}`]: 'Tem a exploração que você adorou em Hollow Knight.',
        [`entry:${stellaris}`]: 'Estratégia espacial, fora do que você costuma jogar.',
      },
    });

    // One request for the whole list, built only from what the app already knew.
    expect(t.ai.requests).toHaveLength(1);
    const request = t.ai.requests[0];
    expect(request?.prompt).toContain('1. Ori and the Blind Forest');
    expect(request?.prompt).toContain('2. Stellaris');
    expect(request?.prompt).toContain('(from Hollow Knight)');
    expect(request?.system).toContain('Brazilian Portuguese');

    const second = await explain(playNext);
    expect(second.body).toMatchObject({ cached: true });
    expect(t.ai.requests).toHaveLength(1);

    // The list now carries the cached lines, in the language they were written for.
    const list = await get(playNextResponseSchema, '/api/recommendations/play-next');
    expect(list.backlog[0]?.line).toBe('Tem a exploração que você adorou em Hollow Knight.');
    const english = await get(playNextResponseSchema, '/api/recommendations/play-next?locale=en');
    expect(english.backlog[0]?.line).toBeNull();

    const usage = await call('GET', '/api/ai/usage?limit=10');
    expect((usage.body as { items: { feature: string; cacheHit: boolean }[] }).items).toEqual([
      expect.objectContaining({ feature: 'recommendation_reasons', cacheHit: true }),
      expect.objectContaining({ feature: 'recommendation_reasons', cacheHit: false }),
    ]);

    // When the reasons change, the old lines no longer apply.
    await review(hollowKnight, 2);
    const changed = await get(playNextResponseSchema, '/api/recommendations/play-next');
    expect(changed.backlog.every((item) => item.line === null)).toBe(true);
  });

  it('explains the lists that have a reference game', async () => {
    const { hollowKnight } = await library();
    t.ai.connected = true;
    t.ai.answers = [{ lines: [{ game: 1, line: 'Continuação direta de Hollow Knight.' }] }];

    const { status, body } = await explain({
      list: 'similar',
      libraryEntryId: hollowKnight,
      locale: 'pt-BR',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      lines: { [`igdb:${ID.silksong}`]: 'Continuação direta de Hollow Knight.' },
    });
    expect(t.ai.requests[0]?.prompt).toContain('Reference: Hollow Knight');
    expect(t.ai.requests[0]?.prompt).toContain('shared with the reference');

    const missing = await explain({ list: 'similar', locale: 'pt-BR' });
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: 'reference_game_required' });
  });

  it('retries once and then gives up when the AI keeps answering in the wrong shape', async () => {
    await library();
    t.ai.connected = true;
    t.ai.answers = ['not json at all'];
    const { status, body } = await explain(playNext);
    expect(status).toBe(502);
    expect(body).toMatchObject({ error: 'ai_invalid_response' });
    expect(t.ai.requests).toHaveLength(2);
  });

  it('spends nothing when there is nothing to explain', async () => {
    t.ai.connected = true;
    const { status, body } = await explain(playNext);
    expect(status).toBe(200);
    expect(body).toEqual({ lines: {}, cached: true });
    expect(t.ai.requests).toHaveLength(0);
  });
});
