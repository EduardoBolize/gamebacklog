import { z } from 'zod';
import type { SecretStore } from '../../secrets/store.ts';
import { SourceError, healthFromError, type SourceHealth } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { assertOk, requestJson, type FetchLike } from '../http.ts';
import { createRateLimiter } from '../rate-limiter.ts';
import type { ConsoleAchievement, ConsoleGame, ConsoleSource } from '../types.ts';

/**
 * Xbox, read-only, through OpenXBL (https://xbl.io): a third-party gateway to Xbox Live. The
 * user signs in there with their Microsoft account and pastes the API key here, so their Xbox
 * data passes through OpenXBL's servers — the settings screen says so. Microsoft offers no
 * open API for this. Paths and fields follow OpenXBL's OpenAPI description (November 2026);
 * the free plan allows 150 requests an hour.
 */

const API_URL = 'https://api.xbl.io';

const HOUR = 60 * 60 * 1000;
const GAMES_TTL_MS = HOUR;
const ACHIEVEMENTS_TTL_MS = HOUR;
const CACHE_VERSION = 1;
/** A game's achievements come in pages; this only bounds a broken answer. */
const MAX_PAGES = 10;

/** OpenXBL wraps most answers in `{ content, code }`; some pass Xbox Live's answer through. */
const unwrap = (json: unknown): unknown =>
  json && typeof json === 'object' && 'content' in json ? json.content : json;

const titlesSchema = z.object({
  titles: z.array(
    z.object({
      titleId: z.union([z.string(), z.number()]).transform(String),
      name: z.string(),
      type: z.string().optional(),
      devices: z.array(z.string()).optional(),
      displayImage: z.string().nullish(),
      achievement: z.object({ progressPercentage: z.number().optional() }).nullish(),
      titleHistory: z.object({ lastTimePlayed: z.string().optional() }).nullish(),
    }),
  ),
});

const achievementsSchema = z.object({
  achievements: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      name: z.string(),
      description: z.string().nullish(),
      lockedDescription: z.string().nullish(),
      isSecret: z.boolean().optional(),
      progressState: z.string().optional(),
      progression: z.object({ timeUnlocked: z.string().optional() }).nullish(),
      mediaAssets: z.array(z.object({ url: z.string().optional() })).nullish(),
      rarity: z.object({ currentPercentage: z.number().optional() }).nullish(),
    }),
  ),
  pagingInfo: z.object({ continuationToken: z.string().nullish() }).nullish(),
});

/** The device list of a title → one platform name, consoles first, in the catalog's wording. */
export function xboxPlatform(devices: string[] | undefined): string {
  const names = (devices ?? []).map((device) => device.toLowerCase());
  if (names.some((name) => name.includes('series'))) return 'Xbox Series X|S';
  if (names.some((name) => name.includes('one'))) return 'Xbox One';
  if (names.some((name) => name.includes('360'))) return 'Xbox 360';
  if (names.some((name) => name === 'pc' || name.includes('win'))) return 'PC';
  return 'Xbox';
}

/** Xbox Live writes "never unlocked" as year 1. */
const realDate = (value: string | undefined) =>
  value && !value.startsWith('0001-') ? value : null;

export interface XboxSourceOptions {
  secrets: SecretStore;
  cache: SourceCache;
  fetch?: FetchLike;
}

export function createXboxSource(options: XboxSourceOptions): ConsoleSource {
  const { secrets, cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  // 150 an hour on the free plan: go gently, and let the cache do the rest.
  const rateLimit = { maxRequests: 2, perMs: 1000 };
  const limiter = createRateLimiter(rateLimit);

  async function get<T>(path: string, schema: z.ZodType<T>, what: string): Promise<T> {
    const key = secrets.get('xbox.openxbl_api_key');
    if (!key) throw new SourceError('xbox', 'not_configured', 'The OpenXBL key is not set');
    const result = await limiter.schedule(() =>
      requestJson('xbox', fetchImpl, `${API_URL}${path}`, {
        headers: { 'X-Authorization': key, Accept: 'application/json', 'Accept-Language': 'en-US' },
        // A retry costs one of the hour's requests; one is enough.
        retries: 1,
      }),
    );
    assertOk('xbox', result);
    const parsed = schema.safeParse(unwrap(result.json));
    if (!parsed.success) {
      throw new SourceError('xbox', 'invalid_response', `Unexpected OpenXBL ${what} answer`);
    }
    return parsed.data;
  }

  return {
    id: 'xbox',
    displayName: 'Xbox (OpenXBL)',
    requiresCredentials: true,
    cacheTtlMs: GAMES_TTL_MS,
    rateLimit,

    isConfigured() {
      return Promise.resolve(Boolean(secrets.get('xbox.openxbl_api_key')));
    },

    async healthCheck(): Promise<SourceHealth> {
      try {
        await get('/v2/account', z.unknown(), 'account');
        return { status: 'ok', message: 'OpenXBL answered' };
      } catch (error) {
        return healthFromError(error);
      }
    },

    async getGames() {
      const entry = await cache.remember(
        'xbox',
        'games',
        { ttlMs: GAMES_TTL_MS, version: CACHE_VERSION },
        async (): Promise<ConsoleGame[]> => {
          const { titles } = await get('/v2/titles', titlesSchema, 'title history');
          return (
            titles
              // The history also lists apps (browsers, video players).
              .filter((title) => !title.type || title.type.toLowerCase() === 'game')
              .map((title) => ({
                titleId: title.titleId,
                name: title.name,
                platform: xboxPlatform(title.devices),
                coverUrl: title.displayImage?.replace(/^http:/, 'https:') ?? null,
                // Xbox Live does not report hours in the title history.
                playtimeMinutes: null,
                lastPlayedAt: title.titleHistory?.lastTimePlayed ?? null,
                progressPercent: title.achievement?.progressPercentage ?? null,
              }))
          );
        },
      );
      return entry.data;
    },

    async getAchievements(titleId) {
      if (!/^\d+$/.test(titleId)) {
        throw new SourceError('xbox', 'not_found', 'Not an Xbox title');
      }
      const entry = await cache.remember(
        'xbox',
        `achievements:${titleId}`,
        { ttlMs: ACHIEVEMENTS_TTL_MS, version: CACHE_VERSION },
        async (): Promise<ConsoleAchievement[]> => {
          const all: ConsoleAchievement[] = [];
          let token: string | null = null;
          for (let page = 0; page < MAX_PAGES; page++) {
            const path: string = token
              ? `/v2/achievements/title/${titleId}/${encodeURIComponent(token)}`
              : `/v2/achievements/title/${titleId}`;
            const data = await get(path, achievementsSchema, 'achievements');
            for (const item of data.achievements) {
              const unlockedAt = realDate(item.progression?.timeUnlocked ?? undefined);
              const isUnlocked = item.progressState === 'Achieved';
              all.push({
                id: item.id,
                name: item.name,
                description:
                  (isUnlocked
                    ? item.description
                    : item.lockedDescription || item.description
                  )?.trim() || null,
                iconUrl: item.mediaAssets?.[0]?.url ?? null,
                isHidden: item.isSecret ?? false,
                globalPercent: item.rarity?.currentPercentage ?? null,
                isUnlocked,
                unlockedAt: isUnlocked ? unlockedAt : null,
              });
            }
            token = data.pagingInfo?.continuationToken ?? null;
            if (!token) break;
          }
          return all;
        },
      );
      return {
        data: entry.data,
        fromCache: entry.fromCache,
        provenance: {
          origin: 'xbox',
          url: 'https://xbl.io',
          fetchedAt: entry.fetchedAt.toISOString(),
        },
      };
    },
  };
}
