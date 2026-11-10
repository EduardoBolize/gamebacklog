import {
  gameDetailResponseSchema,
  libraryListResponseSchema,
  type GameDetailResponse,
} from '@gamebacklog/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { games, sessions } from '../db/schema/index.ts';
import { catalogGame, createTestApp, flushBackgroundWork, type TestApp } from '../test/context.ts';

let t: TestApp;

async function call<T = unknown>(method: string, url: string, payload?: unknown) {
  const response = await t.app.inject({
    method: method as 'GET',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json<T>() };
}

async function addIgdbGame(externalId: string, status = 'playing', platform?: string) {
  const { body } = await call<{ libraryEntryId: string }>('POST', '/api/library', {
    status,
    platform,
    game: { kind: 'igdb', externalId },
  });
  return body.libraryEntryId;
}

const detail = async (entryId: string) =>
  (await call<GameDetailResponse>('GET', `/api/library/${entryId}`)).body;

beforeEach(async () => {
  t = await createTestApp();
  t.sources.catalog = [
    catalogGame({
      externalId: '1029',
      title: 'The Legend of Zelda: Ocarina of Time',
      releaseYear: 1998,
      releaseDate: '1998-11-21',
      platforms: ['Nintendo 64'],
      genres: ['Adventure'],
    }),
    catalogGame({
      externalId: '14593',
      title: 'Hollow Knight',
      releaseYear: 2017,
      platforms: ['PC', 'Nintendo Switch'],
      steamAppIds: ['367520'],
    }),
  ];
  t.sources.times['Hollow Knight'] = {
    externalId: '26286',
    title: 'Hollow Knight',
    mainMinutes: 1620,
    mainExtraMinutes: 2460,
    completionistMinutes: 3840,
    url: 'https://howlongtobeat.com/game/26286',
  };
});

afterEach(() => t.close());

describe('catalog search', () => {
  it('returns catalog results and marks the ones already in the library', async () => {
    const entryId = await addIgdbGame('14593');
    const { body } = await call<{ configured: boolean; results: unknown[] }>(
      'GET',
      '/api/catalog/search?q=hollow',
    );
    expect(body.configured).toBe(true);
    expect(body.results).toEqual([
      expect.objectContaining({
        externalId: '14593',
        title: 'Hollow Knight',
        libraryEntryId: entryId,
      }),
    ]);

    const zelda = await call<{ results: { libraryEntryId: string | null }[] }>(
      'GET',
      '/api/catalog/search?q=zelda',
    );
    expect(zelda.body.results[0]?.libraryEntryId).toBeNull();
  });

  it('says so when the catalog is not configured, without failing', async () => {
    t.sources.catalogConfigured = false;
    const { status, body } = await call('GET', '/api/catalog/search?q=zelda');
    expect(status).toBe(200);
    expect(body).toEqual({ configured: false, results: [] });
  });
});

describe('adding games', () => {
  it('adds a catalog game with its first playthrough', async () => {
    const response = await call<{ libraryEntryId: string; created: boolean }>(
      'POST',
      '/api/library',
      {
        status: 'playing',
        game: { kind: 'igdb', externalId: '1029' },
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.created).toBe(true);

    const game = gameDetailResponseSchema.parse(await detail(response.body.libraryEntryId));
    expect(game.entry).toMatchObject({ status: 'playing', platform: 'Nintendo 64' });
    expect(game.game).toMatchObject({
      title: 'The Legend of Zelda: Ocarina of Time',
      origin: 'igdb',
      fetchedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(game.externalIds).toEqual([
      expect.objectContaining({ source: 'igdb', externalId: '1029' }),
    ]);
    expect(game.playthroughs).toEqual([
      expect.objectContaining({
        number: 1,
        type: 'normal',
        goal: 'finish',
        status: 'playing',
        startedOn: '2026-11-10',
      }),
    ]);
  });

  it('leaves the platform open when the game has several and none was chosen', async () => {
    expect((await detail(await addIgdbGame('14593'))).entry.platform).toBeNull();
  });

  it('does not add the same game twice', async () => {
    const first = await addIgdbGame('14593', 'backlog', 'PC');
    const again = await call<{ libraryEntryId: string; created: boolean }>('POST', '/api/library', {
      status: 'wishlist',
      game: { kind: 'igdb', externalId: '14593' },
    });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ libraryEntryId: first, created: false });
    expect((await detail(first)).entry.status).toBe('backlog');
    expect(t.ctx.db.select().from(games).all()).toHaveLength(1);
  });

  it('adds a game by hand when there is no catalog', async () => {
    t.sources.catalogConfigured = false;
    const { status, body } = await call<{ libraryEntryId: string }>('POST', '/api/library', {
      status: 'wishlist',
      platform: 'PlayStation 5',
      game: { kind: 'manual', title: 'Some Indie Game', releaseYear: 2024 },
    });
    expect(status).toBe(201);
    const game = await detail(body.libraryEntryId);
    expect(game.game).toMatchObject({
      title: 'Some Indie Game',
      releaseYear: 2024,
      origin: 'manual',
    });
    expect(game.entry).toMatchObject({ status: 'wishlist', platform: 'PlayStation 5' });
    expect(game.playthroughs[0]).toMatchObject({ status: 'not_started', startedOn: null });
  });

  it('answers 404 for a catalog game that does not exist', async () => {
    const { status } = await call('POST', '/api/library', {
      status: 'playing',
      game: { kind: 'igdb', externalId: '999' },
    });
    expect(status).toBe(404);
  });

  it('fetches HowLongToBeat times in the background', async () => {
    const entryId = await addIgdbGame('14593');
    await flushBackgroundWork();

    const game = await detail(entryId);
    expect(game.times).toMatchObject({
      origin: 'hltb',
      mainMinutes: 1620,
      completionistMinutes: 3840,
      originUrl: 'https://howlongtobeat.com/game/26286',
    });
    expect(game.externalIds).toContainEqual(
      expect.objectContaining({ source: 'hltb', externalId: '26286' }),
    );
  });

  it('still adds the game when HowLongToBeat is down', async () => {
    t.sources.timesFail = true;
    const entryId = await addIgdbGame('14593');
    await flushBackgroundWork();
    expect((await detail(entryId)).times).toBeNull();
  });
});

describe('library list', () => {
  it('lists entries with the data the grid sorts and filters by', async () => {
    const hollow = await addIgdbGame('14593', 'completed', 'PC');
    await addIgdbGame('1029', 'backlog');
    await flushBackgroundWork();
    await call('PUT', `/api/library/${hollow}/reviews`, {
      playthroughId: null,
      score: 9.5,
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

    const { body } = await call('GET', '/api/library');
    const { items } = libraryListResponseSchema.parse(body);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === hollow)).toMatchObject({
      status: 'completed',
      platform: 'PC',
      score: 9.5,
      mainMinutes: 1620,
      game: { title: 'Hollow Knight', releaseYear: 2017 },
    });
  });
});

describe('editing a library entry', () => {
  it('updates status, platform, favorite and tags', async () => {
    const entryId = await addIgdbGame('14593', 'backlog');
    const { body } = await call<GameDetailResponse>('PATCH', `/api/library/${entryId}`, {
      status: 'paused',
      platform: 'Nintendo Switch',
      isFavorite: true,
      tags: ['metroidvania', 'coop'],
    });
    expect(body.entry).toEqual({
      id: entryId,
      status: 'paused',
      platform: 'Nintendo Switch',
      isFavorite: true,
      tags: ['metroidvania', 'coop'],
    });
  });

  it('keeps the latest playthrough in step with the status', async () => {
    const entryId = await addIgdbGame('14593', 'backlog');
    expect((await detail(entryId)).playthroughs[0]?.status).toBe('not_started');

    await call('PATCH', `/api/library/${entryId}`, { status: 'playing' });
    expect((await detail(entryId)).playthroughs[0]).toMatchObject({
      status: 'playing',
      startedOn: '2026-11-10',
    });

    t.setNow('2026-12-01T12:00:00.000Z');
    await call('PATCH', `/api/library/${entryId}`, { status: 'completed' });
    expect((await detail(entryId)).playthroughs[0]).toMatchObject({
      status: 'completed',
      startedOn: '2026-11-10',
      finishedOn: '2026-12-01',
    });
  });

  it('removes a game from the library with everything the user logged, keeping the catalog row', async () => {
    const entryId = await addIgdbGame('14593');
    await call('POST', `/api/library/${entryId}/sessions`, {
      playthroughId: null,
      startedAt: '2026-11-09T20:00:00.000Z',
      durationMinutes: 30,
    });

    expect((await call('DELETE', `/api/library/${entryId}`)).status).toBe(200);
    expect((await call('GET', `/api/library/${entryId}`)).status).toBe(404);
    expect(t.ctx.db.select().from(sessions).all()).toHaveLength(0);
    expect(t.ctx.db.select().from(games).all()).toHaveLength(1);
  });
});

describe('playthroughs', () => {
  it('creates an NG+ run after the first one', async () => {
    const entryId = await addIgdbGame('14593', 'completed');
    const { status, body } = await call('POST', `/api/library/${entryId}/playthroughs`, {
      type: 'ng_plus',
      goal: 'all_achievements',
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({ number: 2, type: 'ng_plus', goal: 'all_achievements' });
    expect((await detail(entryId)).playthroughs.map((run) => run.number)).toEqual([1, 2]);
  });

  it('edits goal, dates and hours', async () => {
    const entryId = await addIgdbGame('14593');
    const runId = (await detail(entryId)).playthroughs[0]?.id;
    const { body } = await call('PATCH', `/api/playthroughs/${runId}`, {
      goal: 'full_100',
      startedOn: '2026-10-01',
      playtimeMinutes: 540,
    });
    expect(body).toMatchObject({ goal: 'full_100', startedOn: '2026-10-01', playtimeMinutes: 540 });
  });

  it('refuses to delete the only playthrough but deletes an extra one', async () => {
    const entryId = await addIgdbGame('14593');
    const first = (await detail(entryId)).playthroughs[0]?.id;
    expect(await call('DELETE', `/api/playthroughs/${first}`)).toMatchObject({
      status: 409,
      body: { error: 'last_playthrough' },
    });

    const second = await call<{ id: string }>('POST', `/api/library/${entryId}/playthroughs`, {
      type: 'custom',
      label: 'Sem dano',
      goal: 'finish',
    });
    expect((await call('DELETE', `/api/playthroughs/${second.body.id}`)).status).toBe(200);
    expect((await detail(entryId)).playthroughs).toHaveLength(1);
  });
});

describe('times to beat', () => {
  it('lets the user override the times and go back to HowLongToBeat', async () => {
    const entryId = await addIgdbGame('14593');
    await flushBackgroundWork();

    const manual = await call('PUT', `/api/library/${entryId}/times`, {
      mainMinutes: 1200,
      mainExtraMinutes: null,
      completionistMinutes: 4000,
    });
    expect(manual.body).toMatchObject({
      times: { origin: 'manual', mainMinutes: 1200, mainExtraMinutes: null },
    });
    expect((await detail(entryId)).times?.origin).toBe('manual');

    const cleared = await call('PUT', `/api/library/${entryId}/times`, {
      mainMinutes: null,
      mainExtraMinutes: null,
      completionistMinutes: null,
    });
    expect(cleared.body).toMatchObject({ times: { origin: 'hltb', mainMinutes: 1620 } });
  });

  it('answers with what it has when the refresh fails', async () => {
    t.sources.timesFail = true;
    const entryId = await addIgdbGame('14593');
    const { status, body } = await call('POST', `/api/library/${entryId}/times/refresh`);
    expect(status).toBe(200);
    expect(body).toEqual({ times: null, sourceFailed: true });

    t.sources.timesFail = false;
    const retry = await call('POST', `/api/library/${entryId}/times/refresh`);
    expect(retry.body).toMatchObject({ sourceFailed: false, times: { origin: 'hltb' } });
  });
});

describe('"where am I?"', () => {
  it('stores the free text with its date, newest first', async () => {
    const entryId = await addIgdbGame('1029');
    const runId = (await detail(entryId)).playthroughs[0]?.id;

    await call('POST', `/api/playthroughs/${runId}/progress`, {
      rawText: 'saí da Floresta Kokiri',
    });
    t.setNow('2026-11-11T09:00:00.000Z');
    const created = await call('POST', `/api/playthroughs/${runId}/progress`, {
      rawText: '  acabei de entrar na Árvore Deku  ',
    });
    expect(created.status).toBe(201);

    const { body } = await call<{ items: { rawText: string; occurredAt: string }[] }>(
      'GET',
      `/api/playthroughs/${runId}/progress`,
    );
    expect(body.items.map((item) => item.rawText)).toEqual([
      'acabei de entrar na Árvore Deku',
      'saí da Floresta Kokiri',
    ]);
    expect(body.items[0]?.occurredAt).toBe('2026-11-11T09:00:00.000Z');
  });

  it('rejects empty text', async () => {
    const entryId = await addIgdbGame('1029');
    const runId = (await detail(entryId)).playthroughs[0]?.id;
    expect(
      (await call('POST', `/api/playthroughs/${runId}/progress`, { rawText: '  ' })).status,
    ).toBe(400);
  });
});

describe('session diary', () => {
  it('logs sessions and keeps the playthrough hours in step', async () => {
    const entryId = await addIgdbGame('14593');
    const runId = (await detail(entryId)).playthroughs[0]?.id;
    const hours = async () => (await detail(entryId)).playthroughs[0]?.playtimeMinutes;

    const created = await call<{ id: string }>('POST', `/api/library/${entryId}/sessions`, {
      playthroughId: runId,
      startedAt: '2026-11-09T20:00:00.000Z',
      durationMinutes: 90,
      note: 'Cheguei em Greenpath.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ origin: 'manual', note: 'Cheguei em Greenpath.' });
    expect(await hours()).toBe(90);

    await call('PATCH', `/api/sessions/${created.body.id}`, { durationMinutes: 120, note: null });
    expect(await hours()).toBe(120);

    const list = await call<{ items: unknown[] }>('GET', `/api/library/${entryId}/sessions`);
    expect(list.body.items).toEqual([
      expect.objectContaining({ durationMinutes: 120, note: null, playthroughId: runId }),
    ]);

    await call('DELETE', `/api/sessions/${created.body.id}`);
    expect(await hours()).toBe(0);
    expect((await call('DELETE', `/api/sessions/${created.body.id}`)).status).toBe(404);
  });

  it('rejects a session logged against another game’s playthrough', async () => {
    const hollow = await addIgdbGame('14593');
    const zelda = await addIgdbGame('1029');
    const zeldaRun = (await detail(zelda)).playthroughs[0]?.id;
    const { status, body } = await call('POST', `/api/library/${hollow}/sessions`, {
      playthroughId: zeldaRun,
      startedAt: '2026-11-09T20:00:00.000Z',
      durationMinutes: 30,
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'playthrough_mismatch' });
  });
});

describe('reviews', () => {
  const review = (overrides: Record<string, unknown> = {}) => ({
    playthroughId: null,
    score: 9.5,
    difficultyScore: 8,
    storyScore: 8.5,
    gameplayScore: 9.5,
    levelDesignScore: 10,
    soundtrackScore: 9.5,
    visualsScore: 9.5,
    perceivedLengthScore: 8,
    body: 'Um mapa enorme que recompensa cada desvio.',
    pros: ['Exploração'],
    cons: ['Começo lento'],
    hasSpoilers: false,
    timeToBeatMinutes: 2040,
    ...overrides,
  });

  it('saves a review with sub-scores and edits it in place', async () => {
    const entryId = await addIgdbGame('14593', 'completed');
    const runId = (await detail(entryId)).playthroughs[0]?.id;

    const saved = await call<{ id: string }>(
      'PUT',
      `/api/library/${entryId}/reviews`,
      review({ playthroughId: runId }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ score: 9.5, levelDesignScore: 10, pros: ['Exploração'] });

    const edited = await call<{ id: string }>(
      'PUT',
      `/api/library/${entryId}/reviews`,
      review({ playthroughId: runId, score: 9, hasSpoilers: true }),
    );
    expect(edited.body).toMatchObject({ id: saved.body.id, score: 9, hasSpoilers: true });
  });

  it('keeps a review per playthrough and one for the game as a whole', async () => {
    const entryId = await addIgdbGame('14593', 'completed');
    const runId = (await detail(entryId)).playthroughs[0]?.id;
    await call('PUT', `/api/library/${entryId}/reviews`, review({ playthroughId: runId }));
    await call('PUT', `/api/library/${entryId}/reviews`, review({ score: 8 }));

    const { body } = await call<{ items: { id: string; playthroughId: string | null }[] }>(
      'GET',
      `/api/library/${entryId}/reviews`,
    );
    expect(body.items.map((item) => item.playthroughId).sort()).toEqual([null, runId].sort());

    await call('DELETE', `/api/reviews/${body.items[0]?.id}`);
    const after = await call<{ items: unknown[] }>('GET', `/api/library/${entryId}/reviews`);
    expect(after.body.items).toHaveLength(1);
  });

  it('rejects scores outside 0–10 or not in half points', async () => {
    const entryId = await addIgdbGame('14593');
    for (const score of [10.5, -1, 7.3]) {
      const { status } = await call('PUT', `/api/library/${entryId}/reviews`, review({ score }));
      expect(status, String(score)).toBe(400);
    }
  });
});
