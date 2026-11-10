import type { z } from 'zod';
import type { SecretStore } from '../../secrets/store.ts';
import { SourceError, healthFromError, type SourceHealth, type Sourced } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { assertOk, requestJson, type FetchLike } from '../http.ts';
import { createRateLimiter } from '../rate-limiter.ts';
import type { CatalogGameData, CatalogSource } from '../types.ts';
import { normalizeIgdbGame } from './normalize.ts';
import {
  IGDB_GAME_FIELDS,
  IGDB_STEAM_SOURCE_ID,
  igdbExternalGameListSchema,
  igdbGameListSchema,
  igdbTokenSchema,
} from './schema.ts';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_URL = 'https://api.igdb.com/v4';

const HOUR = 60 * 60 * 1000;
const SEARCH_TTL_MS = 24 * HOUR;
const GAME_TTL_MS = 7 * 24 * HOUR;
/** Bump when `normalizeIgdbGame` changes shape, so old cache rows are ignored. */
const CACHE_VERSION = 1;
/** IGDB allows 500 rows per request. */
const PAGE_SIZE = 500;

export interface IgdbSourceOptions {
  secrets: SecretStore;
  cache: SourceCache;
  fetch?: FetchLike;
  now?: () => Date;
}

/** Escapes a value for an Apicalypse string literal. */
const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;

/**
 * IGDB catalog (https://api-docs.igdb.com), authenticated with the user's own Twitch app
 * through the OAuth client-credentials flow. Limit: 4 requests per second.
 */
export function createIgdbSource(options: IgdbSourceOptions): CatalogSource {
  const { secrets, cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const rateLimit = { maxRequests: 4, perMs: 1000 };
  const limiter = createRateLimiter(rateLimit);

  // The access token is a secret: memory only, never cached in the database.
  let token: { value: string; clientId: string; expiresAt: number } | null = null;

  function credentials() {
    const clientId = secrets.get('igdb.client_id');
    const clientSecret = secrets.get('igdb.client_secret');
    if (!clientId || !clientSecret) {
      throw new SourceError('igdb', 'not_configured', 'IGDB credentials are not set');
    }
    return { clientId, clientSecret };
  }

  async function accessToken(): Promise<{ value: string; clientId: string }> {
    const { clientId, clientSecret } = credentials();
    if (token && token.clientId === clientId && token.expiresAt > now().getTime()) return token;

    const result = await requestJson('igdb', fetchImpl, TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
    });
    // Twitch answers 400 for an unknown client ID and 403 for a wrong secret.
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      throw new SourceError('igdb', 'invalid_credentials', 'Twitch rejected the IGDB credentials');
    }
    assertOk('igdb', result);
    const parsed = igdbTokenSchema.safeParse(result.json);
    if (!parsed.success) {
      throw new SourceError('igdb', 'invalid_response', 'Unexpected token response from Twitch');
    }
    token = {
      value: parsed.data.access_token,
      clientId,
      // Refresh a minute early so a request never goes out with a token about to expire.
      expiresAt: now().getTime() + (parsed.data.expires_in - 60) * 1000,
    };
    return token;
  }

  async function query<T>(endpoint: string, body: string, schema: z.ZodType<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const auth = await accessToken();
      const result = await limiter.schedule(() =>
        requestJson('igdb', fetchImpl, `${API_URL}/${endpoint}`, {
          method: 'POST',
          headers: {
            'Client-ID': auth.clientId,
            Authorization: `Bearer ${auth.value}`,
            Accept: 'application/json',
          },
          body,
        }),
      );
      if (result.status === 401 && attempt === 0) {
        // The token was revoked or expired early: get a new one and try once more.
        token = null;
        continue;
      }
      assertOk('igdb', result);
      const parsed = schema.safeParse(result.json);
      if (!parsed.success) {
        throw new SourceError('igdb', 'invalid_response', `Unexpected IGDB ${endpoint} response`);
      }
      return parsed.data;
    }
  }

  function sourced<T>(
    data: T,
    fetchedAt: Date,
    fromCache: boolean,
    url?: string | null,
  ): Sourced<T> {
    return {
      data,
      fromCache,
      provenance: { origin: 'igdb', url: url ?? undefined, fetchedAt: fetchedAt.toISOString() },
    };
  }

  async function fetchByIds(ids: string[]): Promise<CatalogGameData[]> {
    const games: CatalogGameData[] = [];
    for (let i = 0; i < ids.length; i += PAGE_SIZE) {
      const page = ids.slice(i, i + PAGE_SIZE);
      const raw = await query(
        'games',
        `fields ${IGDB_GAME_FIELDS}; where id = (${page.join(',')}); limit ${PAGE_SIZE};`,
        igdbGameListSchema,
      );
      games.push(...raw.map(normalizeIgdbGame));
    }
    for (const game of games) {
      cache.set('igdb', `game:${game.externalId}`, game, {
        ttlMs: GAME_TTL_MS,
        version: CACHE_VERSION,
        url: game.url ?? undefined,
      });
    }
    return games;
  }

  return {
    id: 'igdb',
    displayName: 'IGDB',
    requiresCredentials: true,
    cacheTtlMs: SEARCH_TTL_MS,
    rateLimit,

    isConfigured() {
      return Promise.resolve(
        Boolean(secrets.get('igdb.client_id') && secrets.get('igdb.client_secret')),
      );
    },

    async healthCheck(): Promise<SourceHealth> {
      try {
        token = null;
        await query('games', 'fields name; limit 1;', igdbGameListSchema);
        return { status: 'ok', message: 'IGDB answered' };
      } catch (error) {
        return healthFromError(error);
      }
    },

    async search(text) {
      const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
      const entry = await cache.remember(
        'igdb',
        `search:${normalized}`,
        { ttlMs: SEARCH_TTL_MS, version: CACHE_VERSION },
        async () => {
          // `version_parent = null` leaves out editions such as "Game of the Year Edition".
          const raw = await query(
            'games',
            `search ${quote(normalized)}; fields ${IGDB_GAME_FIELDS}; where version_parent = null; limit 20;`,
            igdbGameListSchema,
          );
          return raw.map(normalizeIgdbGame);
        },
      );
      return sourced(entry.data, entry.fetchedAt, entry.fromCache);
    },

    async getById(externalId) {
      if (!/^\d+$/.test(externalId)) return null;
      const cached = cache.get<CatalogGameData>('igdb', `game:${externalId}`, CACHE_VERSION);
      if (cached) return sourced(cached.data, cached.fetchedAt, true, cached.data.url);
      const [game] = await fetchByIds([externalId]);
      return game ? sourced(game, now(), false, game.url) : null;
    },

    async findBySteamAppIds(appIds) {
      const found = new Map<string, CatalogGameData>();
      const numeric = [...new Set(appIds)].filter((appId) => /^\d+$/.test(appId));

      const gameIdByApp = new Map<string, string>();
      for (let i = 0; i < numeric.length; i += PAGE_SIZE) {
        const page = numeric.slice(i, i + PAGE_SIZE);
        const links = await query(
          'external_games',
          `fields uid,game; where external_game_source = ${IGDB_STEAM_SOURCE_ID} & uid = (${page.map(quote).join(',')}); limit ${PAGE_SIZE};`,
          igdbExternalGameListSchema,
        );
        for (const link of links) {
          if (!gameIdByApp.has(link.uid)) gameIdByApp.set(link.uid, String(link.game));
        }
      }

      const games = await fetchByIds([...new Set(gameIdByApp.values())]);
      const gameById = new Map(games.map((game) => [game.externalId, game]));
      for (const [appId, gameId] of gameIdByApp) {
        const game = gameById.get(gameId);
        if (game) found.set(appId, game);
      }
      return found;
    },
  };
}
