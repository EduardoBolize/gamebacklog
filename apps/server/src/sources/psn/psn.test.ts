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
import { createPsnSource, isoDurationToMinutes, psnPlatform } from './index.ts';

// Shaped like the answers of the PlayStation app's own endpoints (see `index.ts`).
const NPSSO = 'n'.repeat(64);
const authorize = whenUrl('/oauth/authorize', {
  status: 302,
  headers: { location: 'com.scee.psxandroid.scecompcall://redirect/?code=v3.CODE&cid=abc' },
});
const token = whenUrl('/oauth/token', {
  json: { access_token: 'ACCESS-1', expires_in: 3600, refresh_token: 'REFRESH-1' },
});
const trophyTitles = whenUrl('/users/me/trophyTitles', {
  json: {
    trophyTitles: [
      {
        npServiceName: 'trophy2',
        npCommunicationId: 'NPWR22392_00',
        trophyTitleName: 'ASTRO BOT',
        trophyTitleIconUrl: 'https://image.example/astro.png',
        trophyTitlePlatform: 'PS5',
        progress: 100,
        lastUpdatedDateTime: '2026-11-01T10:00:00Z',
      },
      {
        npServiceName: 'trophy',
        npCommunicationId: 'NPWR05506_00',
        trophyTitleName: 'Bloodborne™',
        trophyTitlePlatform: 'PS4',
        progress: 41,
      },
    ],
    totalItemCount: 2,
  },
});
const playedGames = whenUrl('/gamelist/v2/users/me/titles', {
  json: {
    titles: [
      { name: 'Bloodborne', playDuration: 'PT41H30M12S' },
      { name: 'Some Demo', playDuration: 'PT5M' },
    ],
  },
});

let handle: DatabaseHandle;
let secrets: MemorySecretStore;

function createSource(...routes: FakeRoute[]) {
  const fetch = createFakeFetch(...routes);
  const source = createPsnSource({ secrets, cache: new SourceCache(handle.db), fetch });
  return { source, fetch };
}

beforeAll(() => {
  httpDefaults.retryDelayMs = 0;
});
beforeEach(() => {
  handle = createTestDatabase();
  secrets = new MemorySecretStore();
  secrets.set('psn.npsso', NPSSO);
});
afterEach(() => handle.close());

describe('PSN source', () => {
  it('signs in with the NPSSO token and keeps the refresh token in the secret store', async () => {
    const { source, fetch } = createSource(authorize, token, trophyTitles, playedGames);
    const games = await source.getGames();

    const [authorizeCall, tokenCall, titlesCall] = fetch.calls;
    expect(authorizeCall?.url).toContain(
      'https://ca.account.sony.com/api/authz/v3/oauth/authorize',
    );
    expect(authorizeCall?.url).toContain('response_type=code');
    expect(authorizeCall?.headers.Cookie).toBe(`npsso=${NPSSO}`);
    expect(tokenCall?.method).toBe('POST');
    expect(tokenCall?.body).toContain('code=v3.CODE');
    expect(tokenCall?.body).toContain('grant_type=authorization_code');
    expect(tokenCall?.headers.Authorization).toMatch(/^Basic /);
    expect(titlesCall?.headers.Authorization).toBe('Bearer ACCESS-1');
    expect(secrets.get('psn.refresh_token')).toBe('REFRESH-1');

    expect(games).toEqual([
      {
        titleId: 'trophy2:NPWR22392_00',
        name: 'ASTRO BOT',
        platform: 'PlayStation 5',
        coverUrl: 'https://image.example/astro.png',
        playtimeMinutes: null,
        lastPlayedAt: '2026-11-01T10:00:00Z',
        progressPercent: 100,
      },
      {
        titleId: 'trophy:NPWR05506_00',
        name: 'Bloodborne™',
        platform: 'PlayStation 4',
        coverUrl: null,
        // Hours come from another list and are joined by name, ignoring the ™.
        playtimeMinutes: 41 * 60 + 30,
        lastPlayedAt: null,
        progressPercent: 41,
      },
    ]);

    // The list is cached, and the access token is reused.
    const calls = fetch.calls.length;
    await source.getGames();
    expect(fetch.calls).toHaveLength(calls);
  });

  it('prefers the refresh token and falls back to the NPSSO when it is spent', async () => {
    secrets.set('psn.refresh_token', 'OLD-REFRESH');
    const fresh = createSource(token, trophyTitles, playedGames);
    await fresh.source.getGames();
    expect(fresh.fetch.calls[0]?.body).toContain('grant_type=refresh_token');
    expect(fresh.fetch.calls.some((call) => call.url.includes('/authorize'))).toBe(false);

    secrets.set('psn.refresh_token', 'SPENT');
    let tokenCalls = 0;
    const spent = createSource(
      authorize,
      whenUrl('/oauth/token', () =>
        ++tokenCalls === 1
          ? { status: 400, json: { error: 'invalid_grant' } }
          : { json: { access_token: 'ACCESS-2', expires_in: 3600, refresh_token: 'REFRESH-2' } },
      ),
    );
    expect((await spent.source.healthCheck()).status).toBe('ok');
    expect(secrets.get('psn.refresh_token')).toBe('REFRESH-2');
  });

  it('reports an expired NPSSO without leaking it', async () => {
    const { source } = createSource(whenUrl('/oauth/authorize', { status: 302, headers: {} }));
    const health = await source.healthCheck();
    expect(health.status).toBe('invalid_credentials');
    expect(health.message).not.toContain(NPSSO);
    await expect(source.getGames()).rejects.toMatchObject({ code: 'invalid_credentials' });

    secrets.delete('psn.npsso');
    expect(await source.isConfigured()).toBe(false);
    await expect(source.getGames()).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('joins the trophy list with what the account earned', async () => {
    const { source, fetch } = createSource(
      authorize,
      token,
      whenUrl('/users/me/npCommunicationIds/NPWR05506_00/trophyGroups/all/trophies', {
        json: {
          trophies: [
            {
              trophyId: 0,
              earned: true,
              earnedDateTime: '2026-05-10T20:00:00Z',
              trophyEarnedRate: '5.4',
            },
            { trophyId: 1, earned: false, trophyEarnedRate: '48.1' },
          ],
        },
      }),
      whenUrl('/npCommunicationIds/NPWR05506_00/trophyGroups/all/trophies', {
        json: {
          trophies: [
            {
              trophyId: 0,
              trophyHidden: false,
              trophyName: 'Bloodborne',
              trophyDetail: 'All trophies acquired.',
              trophyIconUrl: 'https://image.example/plat.png',
            },
            { trophyId: 1, trophyHidden: true, trophyName: 'Father Gascoigne' },
          ],
        },
      }),
    );
    const { data, provenance } = await source.getAchievements('trophy:NPWR05506_00');

    expect(provenance.origin).toBe('psn');
    expect(data).toEqual([
      {
        id: '0',
        name: 'Bloodborne',
        description: 'All trophies acquired.',
        iconUrl: 'https://image.example/plat.png',
        isHidden: false,
        globalPercent: 5.4,
        isUnlocked: true,
        unlockedAt: '2026-05-10T20:00:00Z',
      },
      {
        id: '1',
        name: 'Father Gascoigne',
        description: null,
        iconUrl: null,
        isHidden: true,
        globalPercent: 48.1,
        isUnlocked: false,
        unlockedAt: null,
      },
    ]);
    // PS4 lists answer on the `trophy` service, PS5 ones on `trophy2`.
    expect(fetch.calls.at(-1)?.url).toContain('npServiceName=trophy');
    await expect(source.getAchievements('not an id')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('gets a new access token once when PlayStation answers 401', async () => {
    let titleCalls = 0;
    const { source, fetch } = createSource(
      authorize,
      token,
      whenUrl('/users/me/trophyTitles', () =>
        ++titleCalls === 1 ? { status: 401 } : { json: { trophyTitles: [] } },
      ),
      playedGames,
    );
    expect(await source.getGames()).toEqual([]);
    expect(fetch.calls.filter((call) => call.url.includes('/oauth/token'))).toHaveLength(2);
  });

  it('maps platforms and durations', () => {
    expect(psnPlatform('PS5,PS4')).toBe('PlayStation 5');
    expect(psnPlatform('PSVITA')).toBe('PlayStation Vita');
    expect(psnPlatform(undefined)).toBe('PlayStation');
    expect(isoDurationToMinutes('PT228H56M33S')).toBe(228 * 60 + 57);
    expect(isoDurationToMinutes('PT45M')).toBe(45);
    expect(isoDurationToMinutes('nonsense')).toBeNull();
  });
});
