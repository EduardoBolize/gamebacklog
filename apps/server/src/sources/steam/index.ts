import type { z } from 'zod';
import type { SecretStore } from '../../secrets/store.ts';
import { SourceError, healthFromError, type SourceHealth } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { assertOk, requestJson, type FetchLike, type HttpResult } from '../http.ts';
import { createRateLimiter } from '../rate-limiter.ts';
import type { SteamAchievementDefinition, SteamSource } from '../types.ts';
import {
  steamGlobalPercentagesSchema,
  steamOwnedGamesSchema,
  steamPlayerAchievementsSchema,
  steamSchemaForGameSchema,
} from './schema.ts';

const API_URL = 'https://api.steampowered.com';

const HOUR = 60 * 60 * 1000;
const SCHEMA_TTL_MS = 7 * 24 * HOUR;
const PERCENTAGES_TTL_MS = 24 * HOUR;
const CACHE_VERSION = 1;

export interface SteamSourceOptions {
  secrets: SecretStore;
  cache: SourceCache;
  /** Reads the SteamID from settings. It is an identifier, not a secret. */
  getSteamId: () => string | null;
  fetch?: FetchLike;
}

/**
 * Steam Web API with the user's own key and SteamID.
 *
 * The key travels in the query string because the API requires it there, so URLs built here
 * must never reach a log or an error message.
 */
export function createSteamSource(options: SteamSourceOptions): SteamSource {
  const { secrets, cache, getSteamId } = options;
  const fetchImpl = options.fetch ?? fetch;
  const rateLimit = { maxRequests: 4, perMs: 1000 };
  const limiter = createRateLimiter(rateLimit);

  function credentials() {
    const key = secrets.get('steam.api_key');
    const steamId = getSteamId();
    if (!key || !steamId) {
      throw new SourceError('steam', 'not_configured', 'Steam key or SteamID is not set');
    }
    return { key, steamId };
  }

  function call(path: string, params: Record<string, string>): Promise<HttpResult> {
    const url = `${API_URL}/${path}/?${new URLSearchParams({ ...params, format: 'json' }).toString()}`;
    return limiter.schedule(() => requestJson('steam', fetchImpl, url));
  }

  function parse<T>(schema: z.ZodType<T>, result: HttpResult, what: string): T {
    const parsed = schema.safeParse(result.json);
    if (!parsed.success) {
      throw new SourceError('steam', 'invalid_response', `Unexpected Steam ${what} response`);
    }
    return parsed.data;
  }

  return {
    id: 'steam',
    displayName: 'Steam',
    requiresCredentials: true,
    cacheTtlMs: SCHEMA_TTL_MS,
    rateLimit,

    getSteamId,

    isConfigured() {
      return Promise.resolve(Boolean(secrets.get('steam.api_key') && getSteamId()));
    },

    async healthCheck(): Promise<SourceHealth> {
      try {
        await this.getOwnedGames();
        return { status: 'ok', message: 'Steam answered' };
      } catch (error) {
        return healthFromError(error);
      }
    },

    async getOwnedGames() {
      const { key, steamId } = credentials();
      const result = await call('IPlayerService/GetOwnedGames/v1', {
        key,
        steamid: steamId,
        include_appinfo: '1',
        include_played_free_games: '1',
      });
      assertOk('steam', result);
      const { response } = parse(steamOwnedGamesSchema, result, 'owned games');
      if (!response.games) {
        // Steam answers 200 with an empty object when the game details are hidden.
        if (response.game_count === 0) return [];
        throw new SourceError('steam', 'profile_private', 'Steam game details are not public');
      }
      return response.games.map((game) => ({
        appId: String(game.appid),
        name: game.name ?? `App ${game.appid}`,
        playtimeMinutes: game.playtime_forever ?? 0,
        playtimeTwoWeeksMinutes: game.playtime_2weeks ?? 0,
      }));
    },

    async getAchievementSchema(appId) {
      const { key } = credentials();
      const entry = await cache.remember(
        'steam',
        `schema:${appId}`,
        { ttlMs: SCHEMA_TTL_MS, version: CACHE_VERSION },
        async (): Promise<SteamAchievementDefinition[]> => {
          const result = await call('ISteamUserStats/GetSchemaForGame/v2', {
            key,
            appid: appId,
            l: 'english',
          });
          // Apps without stats answer 400 or an empty `game` object.
          if (result.status === 400) return [];
          assertOk('steam', result);
          const { game } = parse(steamSchemaForGameSchema, result, 'achievement schema');
          return (game.availableGameStats?.achievements ?? []).map((achievement) => ({
            apiName: achievement.name,
            name: achievement.displayName ?? achievement.name,
            description: achievement.description?.trim() || null,
            iconUrl: achievement.icon ?? null,
            isHidden: achievement.hidden === 1,
          }));
        },
      );
      return {
        data: entry.data,
        fromCache: entry.fromCache,
        provenance: {
          origin: 'steam',
          url: `https://steamcommunity.com/stats/${appId}/achievements`,
          fetchedAt: entry.fetchedAt.toISOString(),
        },
      };
    },

    async getGlobalPercentages(appId) {
      // This method is public: it takes no key.
      const entry = await cache.remember(
        'steam',
        `percentages:${appId}`,
        { ttlMs: PERCENTAGES_TTL_MS, version: CACHE_VERSION },
        async (): Promise<Record<string, number>> => {
          const result = await call('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2', {
            gameid: appId,
          });
          if (result.status === 400 || result.status === 403 || result.status === 404) return {};
          assertOk('steam', result);
          const parsed = parse(steamGlobalPercentagesSchema, result, 'global percentages');
          return Object.fromEntries(
            parsed.achievementpercentages.achievements.map((item) => [item.name, item.percent]),
          );
        },
      );
      return entry.data;
    },

    async getPlayerAchievements(appId) {
      const { key, steamId } = credentials();
      const result = await call('ISteamUserStats/GetPlayerAchievements/v1', {
        key,
        steamid: steamId,
        appid: appId,
      });
      const parsed = steamPlayerAchievementsSchema.safeParse(result.json);
      if (result.status === 401) assertOk('steam', result);
      if (!parsed.success) {
        assertOk('steam', result);
        throw new SourceError(
          'steam',
          'invalid_response',
          'Unexpected Steam achievements response',
        );
      }
      const { playerstats } = parsed.data;
      if (playerstats.success === false || !playerstats.achievements) {
        // 403 "Profile is not public", or 400 when the app has no stats for this player.
        return result.status === 403 ? null : [];
      }
      return playerstats.achievements.map((achievement) => ({
        apiName: achievement.apiname,
        isUnlocked: achievement.achieved === 1,
        unlockedAt:
          achievement.achieved === 1 && achievement.unlocktime
            ? new Date(achievement.unlocktime * 1000)
            : null,
      }));
    },
  };
}
