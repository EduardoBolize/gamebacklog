import type { AchievementListResponse, GameDetailResponse } from '@gamebacklog/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../../db/client.ts';
import { MemorySecretStore } from '../../secrets/store.ts';
import { createTestApp, type TestApp } from '../../test/context.ts';
import { createFakeFetch, createTestDatabase, whenUrl } from '../../test/helpers.ts';
import { SourceCache } from '../cache.ts';
import { httpDefaults } from '../http.ts';
import { createRetroAchievementsSource, parseRetroGameId, type RetroGame } from './index.ts';

// Shaped like the documented answer of API_GetGameInfoAndUserProgress.
const SONIC = {
  ID: 1,
  Title: 'Sonic the Hedgehog',
  ConsoleName: 'Mega Drive',
  NumDistinctPlayers: 20000,
  NumAchievements: 3,
  Achievements: {
    '9': {
      ID: 9,
      NumAwarded: 15000,
      NumAwardedHardcore: 10831,
      Title: 'That Was Easy',
      Description: 'Complete the first act in Green Hill Zone',
      BadgeName: '250336',
      DisplayOrder: 1,
      type: 'progression',
      DateEarned: '2016-03-12 17:40:00',
      DateEarnedHardcore: '2016-03-12 17:47:29',
    },
    '12': {
      ID: 12,
      NumAwarded: 400,
      Title: 'Perfect Bonus',
      Description: '',
      BadgeName: '250340',
      DisplayOrder: 3,
      type: 'missable',
    },
    '10': {
      ID: 10,
      NumAwarded: 9000,
      Title: 'Beat the Game',
      DisplayOrder: 2,
      type: 'win_condition',
    },
  },
};

describe('RetroAchievements source', () => {
  let handle: DatabaseHandle;
  let secrets: MemorySecretStore;
  beforeAll(() => {
    httpDefaults.retryDelayMs = 0;
  });
  beforeEach(() => {
    handle = createTestDatabase();
    secrets = new MemorySecretStore();
    secrets.set('retroachievements.username', 'player');
    secrets.set('retroachievements.api_key', 'RA-KEY');
  });
  afterEach(() => handle.close());

  const create = (...routes: Parameters<typeof createFakeFetch>) => {
    const fetch = createFakeFetch(...routes);
    const cache = new SourceCache(handle.db);
    return { source: createRetroAchievementsSource({ secrets, cache, fetch }), fetch };
  };

  it('reads a game with the achievements in display order and the user unlocks', async () => {
    const { source, fetch } = create(
      whenUrl('API_GetGameInfoAndUserProgress.php', { json: SONIC }),
    );
    const game = await source.getGame('1');

    const url = new URL(fetch.calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({ y: 'RA-KEY', u: 'player', g: '1' });

    expect(game?.data).toMatchObject({
      gameId: '1',
      title: 'Sonic the Hedgehog',
      consoleName: 'Mega Drive',
      url: 'https://retroachievements.org/game/1',
    });
    expect(game?.data.achievements).toEqual([
      {
        id: '9',
        name: 'That Was Easy',
        description: 'Complete the first act in Green Hill Zone',
        iconUrl: 'https://media.retroachievements.org/Badge/250336.png',
        globalPercent: 75,
        isStory: true,
        isMissable: false,
        isUnlocked: true,
        unlockedAt: '2016-03-12T17:47:29Z',
      },
      expect.objectContaining({ id: '10', isStory: true, isUnlocked: false, iconUrl: null }),
      expect.objectContaining({ id: '12', isMissable: true, description: null, globalPercent: 2 }),
    ]);

    await source.getGame('1');
    expect(fetch.calls).toHaveLength(1);
  });

  it('answers null for a game the site does not have, and reports a wrong key', async () => {
    const unknown = create(whenUrl('API_GetGameInfoAndUserProgress.php', { json: {} }));
    expect(await unknown.source.getGame('999999')).toBeNull();
    expect(await unknown.source.getGame('not-a-number')).toBeNull();

    const wrong = create(whenUrl('API_GetGameInfoAndUserProgress.php', { status: 401 }));
    const health = await wrong.source.healthCheck();
    expect(health.status).toBe('invalid_credentials');
    expect(health.message).not.toContain('RA-KEY');

    secrets.delete('retroachievements.api_key');
    await expect(wrong.source.getGame('1')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('copes with a game that has no achievements', async () => {
    const { source } = create(
      whenUrl('API_GetGameInfoAndUserProgress.php', { json: { ...SONIC, Achievements: [] } }),
    );
    expect((await source.getGame('1'))?.data.achievements).toEqual([]);
  });

  it('accepts a game ID or the address of the game page', () => {
    expect(parseRetroGameId(' 14402 ')).toBe('14402');
    expect(parseRetroGameId('https://retroachievements.org/game/1/sonic')).toBe('1');
    expect(parseRetroGameId('https://example.com/game/1')).toBeNull();
    expect(parseRetroGameId('sonic')).toBeNull();
  });
});

describe('linking a game to RetroAchievements', () => {
  let t: TestApp;
  const game: RetroGame = {
    gameId: '1',
    title: 'Sonic the Hedgehog',
    consoleName: 'Mega Drive',
    url: 'https://retroachievements.org/game/1',
    achievements: [
      {
        id: '9',
        name: 'That Was Easy',
        description: null,
        iconUrl: null,
        globalPercent: 75,
        isStory: true,
        isMissable: false,
        isUnlocked: true,
        unlockedAt: '2016-03-12T17:47:29Z',
      },
      {
        id: '12',
        name: 'Perfect Bonus',
        description: null,
        iconUrl: null,
        globalPercent: 2,
        isStory: false,
        isMissable: true,
        isUnlocked: false,
        unlockedAt: null,
      },
    ],
  };

  beforeEach(async () => {
    t = await createTestApp();
    t.sources.retro.games['1'] = game;
  });
  afterEach(() => t.close());

  async function call<T = unknown>(method: string, url: string, payload?: unknown) {
    const response = await t.app.inject({
      method: method as 'GET',
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.json<T>() };
  }

  it('links by page address, then syncs with the classification the site gives', async () => {
    const added = await call<{ libraryEntryId: string }>('POST', '/api/library', {
      status: 'playing',
      game: { kind: 'manual', title: 'Sonic the Hedgehog' },
    });
    const entryId = added.body.libraryEntryId;
    const detail = await call<GameDetailResponse>('GET', `/api/library/${entryId}`);
    const runId = detail.body.playthroughs[0]?.id ?? '';

    const bad = await call('PUT', `/api/library/${entryId}/retroachievements`, { game: 'sonic' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'retro_game_invalid' });
    const missing = await call('PUT', `/api/library/${entryId}/retroachievements`, { game: '77' });
    expect(missing.status).toBe(404);

    const linked = await call('PUT', `/api/library/${entryId}/retroachievements`, {
      game: 'https://retroachievements.org/game/1',
    });
    expect(linked.body).toEqual({
      gameId: '1',
      title: 'Sonic the Hedgehog',
      consoleName: 'Mega Drive',
    });

    const sync = await call('POST', `/api/library/${entryId}/achievements/sync`);
    expect(sync.body).toEqual({ total: 2, unlocked: 1, playerDataAvailable: true });

    const list = await call<AchievementListResponse>(
      'GET',
      `/api/playthroughs/${runId}/achievements`,
    );
    expect(list.body.syncSource).toBe('retroachievements');
    expect(
      list.body.items.map((item) => [
        item.name,
        item.origin,
        item.isStory,
        item.isMissable,
        item.isUnlocked,
      ]),
    ).toEqual([
      ['That Was Easy', 'retroachievements', true, false, true],
      ['Perfect Bonus', 'retroachievements', false, true, false],
    ]);

    // Linking again (to the same or another game) keeps a single link.
    await call('PUT', `/api/library/${entryId}/retroachievements`, { game: '1' });
    const after = await call<GameDetailResponse>('GET', `/api/library/${entryId}`);
    expect(
      after.body.externalIds.filter((link) => link.source === 'retroachievements'),
    ).toHaveLength(1);
  });
});
