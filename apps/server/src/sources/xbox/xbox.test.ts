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
import { createXboxSource, xboxPlatform } from './index.ts';

let handle: DatabaseHandle;
let secrets: MemorySecretStore;

function createSource(...routes: FakeRoute[]) {
  const fetch = createFakeFetch(...routes);
  const source = createXboxSource({ secrets, cache: new SourceCache(handle.db), fetch });
  return { source, fetch };
}

beforeAll(() => {
  httpDefaults.retryDelayMs = 0;
});
beforeEach(() => {
  handle = createTestDatabase();
  secrets = new MemorySecretStore();
  secrets.set('xbox.openxbl_api_key', 'XBL-KEY');
});
afterEach(() => handle.close());

// Shaped like the example in OpenXBL's OpenAPI description for `GET /v2/titles`.
const titles = whenUrl('/v2/titles', {
  json: {
    content: {
      xuid: '2533274798129181',
      titles: [
        {
          titleId: '1144039928',
          name: 'Halo: The Master Chief Collection',
          type: 'Game',
          devices: ['PC', 'XboxSeries', 'XboxOne'],
          displayImage: 'http://store-images.s-microsoft.com/image/halo',
          achievement: { currentAchievements: 138, progressPercentage: 17 },
          titleHistory: { lastTimePlayed: '2025-11-26T02:34:30.2229199Z' },
        },
        { titleId: 327370029, name: 'Microsoft Edge', type: 'Application', devices: ['XboxOne'] },
        { titleId: '1717113201', name: 'Forza Horizon 5', devices: ['Win32'] },
      ],
    },
    code: 200,
  },
});

describe('Xbox source (OpenXBL)', () => {
  it('lists the games of the account, leaving apps out', async () => {
    const { source, fetch } = createSource(titles);
    const games = await source.getGames();

    expect(fetch.calls[0]?.url).toBe('https://api.xbl.io/v2/titles');
    expect(fetch.calls[0]?.headers['X-Authorization']).toBe('XBL-KEY');
    expect(games).toEqual([
      {
        titleId: '1144039928',
        name: 'Halo: The Master Chief Collection',
        platform: 'Xbox Series X|S',
        coverUrl: 'https://store-images.s-microsoft.com/image/halo',
        playtimeMinutes: null,
        lastPlayedAt: '2025-11-26T02:34:30.2229199Z',
        progressPercent: 17,
      },
      {
        titleId: '1717113201',
        name: 'Forza Horizon 5',
        platform: 'PC',
        coverUrl: null,
        playtimeMinutes: null,
        lastPlayedAt: null,
        progressPercent: null,
      },
    ]);

    // An hour of cache protects the 150-requests-an-hour allowance.
    await source.getGames();
    expect(fetch.calls).toHaveLength(1);
  });

  it('reads every page of achievements and tells earned from locked', async () => {
    const { source, fetch } = createSource(
      whenUrl('/v2/achievements/title/1144039928/PAGE2', {
        json: {
          achievements: [
            {
              id: '3',
              name: 'Legend',
              description: 'Finish on Legendary.',
              lockedDescription: 'Secret.',
              isSecret: true,
              progressState: 'NotStarted',
              progression: { timeUnlocked: '0001-01-01T00:00:00.0000000Z' },
              rarity: { currentPercentage: 2.5 },
            },
          ],
          pagingInfo: { continuationToken: null },
        },
      }),
      whenUrl('/v2/achievements/title/1144039928', {
        json: {
          content: {
            achievements: [
              {
                id: 1,
                name: 'Your Journey Begins',
                description: 'Complete the first mission.',
                progressState: 'Achieved',
                progression: { timeUnlocked: '2025-01-05T18:00:00.0000000Z' },
                mediaAssets: [{ url: 'https://image.example/a.png' }],
                rarity: { currentPercentage: 71.2 },
              },
            ],
            pagingInfo: { continuationToken: 'PAGE2' },
          },
        },
      }),
    );
    const { data, provenance } = await source.getAchievements('1144039928');

    expect(provenance).toMatchObject({ origin: 'xbox', url: 'https://xbl.io' });
    expect(data).toEqual([
      {
        id: '1',
        name: 'Your Journey Begins',
        description: 'Complete the first mission.',
        iconUrl: 'https://image.example/a.png',
        isHidden: false,
        globalPercent: 71.2,
        isUnlocked: true,
        unlockedAt: '2025-01-05T18:00:00.0000000Z',
      },
      {
        id: '3',
        name: 'Legend',
        // A locked secret achievement keeps its real description hidden.
        description: 'Secret.',
        iconUrl: null,
        isHidden: true,
        globalPercent: 2.5,
        isUnlocked: false,
        unlockedAt: null,
      },
    ]);
    expect(fetch.calls).toHaveLength(2);
    await expect(source.getAchievements('abc')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reports a wrong key, a spent allowance and a missing key', async () => {
    const wrong = createSource(whenUrl('/v2/account', { status: 401 }));
    const health = await wrong.source.healthCheck();
    expect(health.status).toBe('invalid_credentials');
    expect(health.message).not.toContain('XBL-KEY');

    const limited = createSource(whenUrl('/v2/titles', { status: 429 }));
    await expect(limited.source.getGames()).rejects.toMatchObject({ code: 'rate_limited' });

    const odd = createSource(whenUrl('/v2/titles', { json: { content: { nothing: true } } }));
    await expect(odd.source.getGames()).rejects.toMatchObject({ code: 'invalid_response' });

    secrets.delete('xbox.openxbl_api_key');
    expect(await wrong.source.isConfigured()).toBe(false);
    await expect(wrong.source.getGames()).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('names the platform from the device list, consoles first', () => {
    expect(xboxPlatform(['PC', 'XboxOne'])).toBe('Xbox One');
    expect(xboxPlatform(['Xbox360'])).toBe('Xbox 360');
    expect(xboxPlatform(undefined)).toBe('Xbox');
  });
});
