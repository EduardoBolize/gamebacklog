import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../../db/client.ts';
import { MemorySecretStore } from '../../secrets/store.ts';
import {
  createFakeFetch,
  createTestDatabase,
  whenUrl,
  type FakeRoute,
} from '../../test/helpers.ts';
import { SourceCache } from '../cache.ts';
import { httpDefaults } from '../http.ts';
import ownedGames from './fixtures/owned-games.json' with { type: 'json' };
import schemaForGame from './fixtures/schema-for-game.json' with { type: 'json' };
import { createSteamSource } from './index.ts';

const STEAM_ID = '76561198000000000';
const API_KEY = 'SECRETKEY1234567890';

let handle: DatabaseHandle;
let secrets: MemorySecretStore;
let steamId: string | null;

function createSource(...routes: FakeRoute[]) {
  const fetch = createFakeFetch(...routes);
  const source = createSteamSource({
    secrets,
    cache: new SourceCache(handle.db),
    getSteamId: () => steamId,
    fetch,
  });
  return { source, fetch };
}

beforeAll(() => {
  httpDefaults.retryDelayMs = 0;
});

beforeEach(() => {
  handle = createTestDatabase();
  secrets = new MemorySecretStore();
  secrets.set('steam.api_key', API_KEY);
  steamId = STEAM_ID;
});

afterEach(() => handle.close());

describe('Steam source', () => {
  it('needs both the key and the SteamID', async () => {
    const { source } = createSource();
    expect(await source.isConfigured()).toBe(true);
    steamId = null;
    expect(await source.isConfigured()).toBe(false);
    await expect(source.getOwnedGames()).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('lists owned games with playtime in minutes', async () => {
    const { source, fetch } = createSource(whenUrl('GetOwnedGames', { json: ownedGames }));
    const games = await source.getOwnedGames();

    expect(games).toEqual([
      { appId: '367520', name: 'Hollow Knight', playtimeMinutes: 2040, playtimeTwoWeeksMinutes: 0 },
      {
        appId: '570940',
        name: 'DARK SOULS™: REMASTERED',
        playtimeMinutes: 3660,
        playtimeTwoWeeksMinutes: 120,
      },
      { appId: '1145360', name: 'Hades', playtimeMinutes: 0, playtimeTwoWeeksMinutes: 0 },
    ]);
    const url = new URL(fetch.calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: API_KEY,
      steamid: STEAM_ID,
      include_appinfo: '1',
      include_played_free_games: '1',
      format: 'json',
    });
  });

  it('detects a private profile', async () => {
    const { source } = createSource(whenUrl('GetOwnedGames', { json: { response: {} } }));
    await expect(source.getOwnedGames()).rejects.toMatchObject({ code: 'profile_private' });
    expect((await source.healthCheck()).status).toBe('profile_private');
  });

  it('treats an account with no games as an empty library, not a private profile', async () => {
    const { source } = createSource(
      whenUrl('GetOwnedGames', { json: { response: { game_count: 0 } } }),
    );
    expect(await source.getOwnedGames()).toEqual([]);
  });

  it('reports an invalid key without leaking it', async () => {
    const { source } = createSource(whenUrl('GetOwnedGames', { status: 403 }));
    const error = await source.getOwnedGames().catch((caught: unknown) => caught as Error);
    expect(error).toMatchObject({ code: 'invalid_credentials' });
    expect((error as Error).message).not.toContain(API_KEY);

    const down = createSource();
    const unreachable = await down.source
      .getOwnedGames()
      .catch((caught: unknown) => caught as Error);
    expect((unreachable as Error).message).not.toContain(API_KEY);
    expect((unreachable as Error).message).not.toContain('steampowered');
  });

  it('reads the achievement schema and caches it', async () => {
    const { source, fetch } = createSource(whenUrl('GetSchemaForGame', { json: schemaForGame }));
    const { data, provenance } = await source.getAchievementSchema('570940');

    expect(data).toEqual([
      {
        apiName: 'ACH_RING_BELL_1',
        name: 'Ring the Bell (Undead Church)',
        description: 'Ring the first Bell of Awakening.',
        iconUrl:
          'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/570940/a1.jpg',
        isHidden: false,
      },
      {
        apiName: 'ACH_ENDING_LINK',
        name: 'To Link the Fire',
        description: null,
        iconUrl:
          'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/570940/a2.jpg',
        isHidden: true,
      },
      expect.objectContaining({ apiName: 'ACH_KNIGHTS_HONOR' }),
    ]);
    expect(provenance.origin).toBe('steam');

    const again = await source.getAchievementSchema('570940');
    expect(again.fromCache).toBe(true);
    expect(fetch.calls).toHaveLength(1);
  });

  it('returns no achievements for an app without stats', async () => {
    const { source } = createSource(whenUrl('GetSchemaForGame', { json: { game: {} } }));
    expect((await source.getAchievementSchema('1')).data).toEqual([]);
  });

  it('reads global percentages without sending the key, as numbers or numeric strings', async () => {
    const { source, fetch } = createSource(
      whenUrl('GetGlobalAchievementPercentagesForApp', {
        json: {
          achievementpercentages: {
            achievements: [
              { name: 'ACH_RING_BELL_1', percent: 60.2 },
              { name: 'ACH_ENDING_LINK', percent: '22.9' },
            ],
          },
        },
      }),
    );
    expect(await source.getGlobalPercentages('570940')).toEqual({
      ACH_RING_BELL_1: 60.2,
      ACH_ENDING_LINK: 22.9,
    });
    const url = new URL(fetch.calls[0]?.url ?? '');
    expect(url.searchParams.get('gameid')).toBe('570940');
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('reads the player achievements', async () => {
    const { source } = createSource(
      whenUrl('GetPlayerAchievements', {
        json: {
          playerstats: {
            steamID: STEAM_ID,
            gameName: 'DARK SOULS™: REMASTERED',
            achievements: [
              { apiname: 'ACH_RING_BELL_1', achieved: 1, unlocktime: 1778443200 },
              { apiname: 'ACH_ENDING_LINK', achieved: 0, unlocktime: 0 },
            ],
            success: true,
          },
        },
      }),
    );
    expect(await source.getPlayerAchievements('570940')).toEqual([
      { apiName: 'ACH_RING_BELL_1', isUnlocked: true, unlockedAt: new Date(1778443200 * 1000) },
      { apiName: 'ACH_ENDING_LINK', isUnlocked: false, unlockedAt: null },
    ]);
  });

  it('returns null when the player achievements are not public', async () => {
    const { source } = createSource(
      whenUrl('GetPlayerAchievements', {
        status: 403,
        json: { playerstats: { error: 'Profile is not public', success: false } },
      }),
    );
    expect(await source.getPlayerAchievements('570940')).toBeNull();
  });

  it('returns an empty list when the app has no stats for the player', async () => {
    const { source } = createSource(
      whenUrl('GetPlayerAchievements', {
        status: 400,
        json: { playerstats: { error: 'Requested app has no stats', success: false } },
      }),
    );
    expect(await source.getPlayerAchievements('1')).toEqual([]);
  });
});
