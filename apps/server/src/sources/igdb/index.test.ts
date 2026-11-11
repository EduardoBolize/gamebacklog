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
import gamesById from './fixtures/games-by-id.json' with { type: 'json' };
import searchZelda from './fixtures/games-search-zelda.json' with { type: 'json' };
import { createIgdbSource } from './index.ts';

const tokenRoute = whenUrl('id.twitch.tv/oauth2/token', {
  json: { access_token: 'token-1', expires_in: 5_000_000, token_type: 'bearer' },
});

let handle: DatabaseHandle;
let secrets: MemorySecretStore;

function createSource(...routes: FakeRoute[]) {
  const fetch = createFakeFetch(...routes);
  const source = createIgdbSource({ secrets, cache: new SourceCache(handle.db), fetch });
  return { source, fetch };
}

beforeAll(() => {
  httpDefaults.retryDelayMs = 0;
});

beforeEach(() => {
  handle = createTestDatabase();
  secrets = new MemorySecretStore();
  secrets.set('igdb.client_id', 'client-id');
  secrets.set('igdb.client_secret', 'client-secret');
});

afterEach(() => handle.close());

describe('IGDB source', () => {
  it('reports whether credentials are stored', async () => {
    const { source } = createSource();
    expect(await source.isConfigured()).toBe(true);
    secrets.delete('igdb.client_secret');
    expect(await source.isConfigured()).toBe(false);
    await expect(source.search('zelda')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('authenticates with client credentials in the body and sends the documented headers', async () => {
    const { source, fetch } = createSource(tokenRoute, whenUrl('/v4/games', { json: searchZelda }));
    await source.search('zelda');

    const [tokenCall, gamesCall] = fetch.calls;
    expect(tokenCall?.method).toBe('POST');
    expect(tokenCall?.url).toBe('https://id.twitch.tv/oauth2/token');
    expect(tokenCall?.body).toBe(
      'client_id=client-id&client_secret=client-secret&grant_type=client_credentials',
    );
    expect(gamesCall?.url).toBe('https://api.igdb.com/v4/games');
    expect(gamesCall?.headers).toMatchObject({
      'Client-ID': 'client-id',
      Authorization: 'Bearer token-1',
    });
    expect(gamesCall?.body).toContain('search "zelda";');
    expect(gamesCall?.body).toContain('where version_parent = null;');
  });

  it('normalizes search results', async () => {
    const { source } = createSource(tokenRoute, whenUrl('/v4/games', { json: searchZelda }));
    const { data, provenance, fromCache } = await source.search('Zelda');

    expect(fromCache).toBe(false);
    expect(provenance.origin).toBe('igdb');
    expect(data[0]).toEqual({
      externalId: '1029',
      title: 'The Legend of Zelda: Ocarina of Time',
      alternativeTitles: ['Zelda 64', 'OoT'],
      summary: 'A young boy sets out to stop Ganondorf from obtaining the Triforce.',
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1uii.jpg',
      releaseDate: '1998-11-21',
      releaseYear: 1998,
      platforms: ['Nintendo 64', 'Nintendo GameCube'],
      genres: ['Adventure'],
      themes: ['Action', 'Fantasy'],
      tags: ['time travel', 'dungeons'],
      franchise: 'The Legend of Zelda',
      url: 'https://www.igdb.com/games/the-legend-of-zelda-ocarina-of-time',
      steamAppIds: [],
    });
    // A game with nothing but id and name still normalizes.
    expect(data[1]).toMatchObject({ externalId: '5000', coverUrl: null, releaseYear: null });
  });

  it('answers a repeated search from the cache, without any request', async () => {
    const { source, fetch } = createSource(tokenRoute, whenUrl('/v4/games', { json: searchZelda }));
    await source.search('zelda');
    const callsAfterFirst = fetch.calls.length;

    const second = await source.search('  ZELDA ');
    expect(second.fromCache).toBe(true);
    expect(second.data).toHaveLength(2);
    expect(fetch.calls).toHaveLength(callsAfterFirst);
  });

  it('reuses the access token across requests', async () => {
    const { source, fetch } = createSource(tokenRoute, whenUrl('/v4/games', { json: searchZelda }));
    await source.search('zelda');
    await source.search('metroid');
    expect(fetch.calls.filter((call) => call.url.includes('oauth2/token'))).toHaveLength(1);
  });

  it('gets a new token and retries once when IGDB answers 401', async () => {
    let gamesCalls = 0;
    const { source, fetch } = createSource(
      tokenRoute,
      whenUrl('/v4/games', () => (++gamesCalls === 1 ? { status: 401 } : { json: searchZelda })),
    );
    const { data } = await source.search('zelda');
    expect(data).toHaveLength(2);
    expect(fetch.calls.filter((call) => call.url.includes('oauth2/token'))).toHaveLength(2);
  });

  it('escapes quotes in the search text', async () => {
    const { source, fetch } = createSource(tokenRoute, whenUrl('/v4/games', { json: [] }));
    await source.search('say "hi"; fields *');
    expect(fetch.calls.at(-1)?.body).toContain('search "say \\"hi\\"; fields *";');
  });

  it('reports wrong credentials without leaking them', async () => {
    const { source } = createSource(
      whenUrl('oauth2/token', { status: 400, json: { status: 400 } }),
    );
    const health = await source.healthCheck();
    expect(health.status).toBe('invalid_credentials');
    expect(health.message).not.toContain('client-secret');
  });

  it('reports rate limiting and unreachable servers', async () => {
    const limited = createSource(tokenRoute, whenUrl('/v4/games', { status: 429 }));
    await expect(limited.source.search('zelda')).rejects.toMatchObject({ code: 'rate_limited' });

    const down = createSource(tokenRoute, whenUrl('/v4/games', { status: 503 }));
    await expect(down.source.search('zelda')).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('rejects a response that does not match the schema', async () => {
    const { source } = createSource(tokenRoute, whenUrl('/v4/games', { json: [{ id: 'x' }] }));
    await expect(source.search('zelda')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fetches a game by ID and caches it', async () => {
    const { source, fetch } = createSource(tokenRoute, whenUrl('/v4/games', { json: gamesById }));
    const first = await source.getById('14593');
    expect(first?.data).toMatchObject({ title: 'Hollow Knight', steamAppIds: ['367520'] });
    expect(fetch.calls.at(-1)?.body).toContain('where id = (14593);');

    const calls = fetch.calls.length;
    const second = await source.getById('14593');
    expect(second?.fromCache).toBe(true);
    expect(fetch.calls).toHaveLength(calls);

    expect(await source.getById('not-a-number')).toBeNull();
  });

  it('matches Steam app IDs to catalog games', async () => {
    const { source, fetch } = createSource(
      tokenRoute,
      whenUrl('/v4/external_games', {
        json: [
          { id: 10, uid: '367520', game: 14593 },
          { id: 12, uid: '570940', game: 81085 },
        ],
      }),
      whenUrl('/v4/games', { json: gamesById }),
    );
    const found = await source.findBySteamAppIds(['367520', '570940', '999999', '367520']);

    expect([...found.keys()]).toEqual(['367520', '570940']);
    expect(found.get('570940')?.title).toBe('Dark Souls: Remastered');
    const externalCall = fetch.calls.find((call) => call.url.endsWith('/external_games'));
    expect(externalCall?.body).toContain(
      'where external_game_source = 1 & uid = ("367520","570940","999999");',
    );
  });

  it('lists similar games in the order IGDB gives, and caches the list', async () => {
    const { source, fetch } = createSource(
      tokenRoute,
      whenUrl('/v4/games', (call) =>
        call.body?.startsWith('fields similar_games;')
          ? { json: [{ id: 1029, similar_games: [81085, 14593, 424242] }] }
          : { json: gamesById },
      ),
    );
    const { data, provenance } = await source.getSimilar('1029');

    // 424242 is not in the catalog answer: it is left out rather than breaking the list.
    expect(data.map((game) => game.title)).toEqual(['Dark Souls: Remastered', 'Hollow Knight']);
    expect(provenance.origin).toBe('igdb');
    const bodies = fetch.calls.map((call) => call.body ?? '');
    expect(bodies).toContain('fields similar_games; where id = 1029; limit 1;');
    expect(bodies.at(-1)).toContain('where id = (81085,14593,424242);');

    const calls = fetch.calls.length;
    expect((await source.getSimilar('1029')).fromCache).toBe(true);
    expect(fetch.calls).toHaveLength(calls);

    expect((await source.getSimilar('not-a-number')).data).toEqual([]);
  });

  it('answers with no similar games when IGDB lists none', async () => {
    const { source, fetch } = createSource(
      tokenRoute,
      whenUrl('/v4/games', { json: [{ id: 1029 }] }),
    );
    expect((await source.getSimilar('1029')).data).toEqual([]);
    expect(fetch.calls.filter((call) => call.url.endsWith('/v4/games'))).toHaveLength(1);
  });

  it('finds the best-rated games of a genre by the genre ID', async () => {
    const { source, fetch } = createSource(
      tokenRoute,
      whenUrl('/v4/genres', {
        json: [
          { id: 8, name: 'Platform' },
          { id: 12, name: 'Role-playing (RPG)' },
        ],
      }),
      whenUrl('/v4/games', { json: gamesById }),
    );
    const { data } = await source.getTopByGenre('role-playing (rpg)');

    expect(data).toHaveLength(2);
    const query = fetch.calls.at(-1)?.body ?? '';
    expect(query).toContain(
      'where genres = (12) & version_parent = null & parent_game = null & total_rating_count >= 50;',
    );
    expect(query).toContain('sort total_rating desc; limit 50;');

    // The genre list and the ranking are both cached.
    const calls = fetch.calls.length;
    await source.getTopByGenre('Role-playing (RPG)');
    expect(fetch.calls).toHaveLength(calls);

    // A genre the catalog does not have costs no games request.
    expect((await source.getTopByGenre('Soulslike')).data).toEqual([]);
    expect(fetch.calls).toHaveLength(calls);
  });
});
