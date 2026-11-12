import { z } from 'zod';
import type { SecretStore } from '../../secrets/store.ts';
import { SourceError, healthFromError, type SourceAdapter, type SourceHealth } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { assertOk, requestJson, type FetchLike } from '../http.ts';
import { createRateLimiter } from '../rate-limiter.ts';

/**
 * RetroAchievements (https://retroachievements.org): achievements for retro games, with the
 * user's own username and web API key. Endpoint and fields follow
 * https://api-docs.retroachievements.org (checked November 2026).
 */

const API_URL = 'https://retroachievements.org/API';
const BADGE_URL = 'https://media.retroachievements.org/Badge';
const SITE_URL = 'https://retroachievements.org';

const PROGRESS_TTL_MS = 60 * 60 * 1000;
const CACHE_VERSION = 1;

const gameProgressSchema = z.object({
  ID: z.number().int(),
  Title: z.string(),
  ConsoleName: z.string().nullish(),
  NumDistinctPlayers: z.number().nullish(),
  // An object keyed by achievement ID; PHP sends an empty array when there are none.
  Achievements: z.union([
    z.array(z.unknown()).transform(() => ({})),
    z.record(
      z.string(),
      z.object({
        ID: z.number().int(),
        Title: z.string(),
        Description: z.string().nullish(),
        BadgeName: z.string().nullish(),
        DisplayOrder: z.number().nullish(),
        NumAwarded: z.number().nullish(),
        /** `progression`, `win_condition`, `missable` or null. */
        type: z.string().nullish(),
        /** `YYYY-MM-DD HH:MM:SS`, in UTC. */
        DateEarned: z.string().nullish(),
        DateEarnedHardcore: z.string().nullish(),
      }),
    ),
  ]),
});

export interface RetroAchievement {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  /** Share of the game's players who have it, 0–100. */
  globalPercent: number | null;
  /** The site's own classification: part of the main path, or possible to lose for good. */
  isStory: boolean;
  isMissable: boolean;
  isUnlocked: boolean;
  /** ISO date-time, or null. */
  unlockedAt: string | null;
}

export interface RetroGame {
  gameId: string;
  title: string;
  consoleName: string | null;
  url: string;
  achievements: RetroAchievement[];
}

export interface RetroSource extends SourceAdapter {
  /** Achievements of a game with the user's unlocks. Null when the site has no such game. */
  getGame(gameId: string): Promise<{ data: RetroGame; fetchedAt: Date; fromCache: boolean } | null>;
}

/** Accepts a bare ID or a game page URL (`…/game/1234`), and returns the ID. */
export function parseRetroGameId(input: string): string | null {
  const text = input.trim();
  if (/^\d{1,9}$/.test(text)) return text;
  const match = /retroachievements\.org\/game\/(\d{1,9})/i.exec(text);
  return match?.[1] ?? null;
}

/** `2016-03-12 17:47:29` (UTC) → ISO. */
const toIso = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : null;

export interface RetroSourceOptions {
  secrets: SecretStore;
  cache: SourceCache;
  fetch?: FetchLike;
}

export function createRetroAchievementsSource(options: RetroSourceOptions): RetroSource {
  const { secrets, cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  const rateLimit = { maxRequests: 2, perMs: 1000 };
  const limiter = createRateLimiter(rateLimit);

  function credentials() {
    const username = secrets.get('retroachievements.username');
    const key = secrets.get('retroachievements.api_key');
    if (!username || !key) {
      throw new SourceError('retroachievements', 'not_configured', 'RetroAchievements is not set');
    }
    return { username, key };
  }

  async function load(gameId: string): Promise<RetroGame | null> {
    const { username, key } = credentials();
    const query = new URLSearchParams({ y: key, u: username, g: gameId });
    const result = await limiter.schedule(() =>
      requestJson(
        'retroachievements',
        fetchImpl,
        `${API_URL}/API_GetGameInfoAndUserProgress.php?${query.toString()}`,
      ),
    );
    if (result.status === 404) return null;
    assertOk('retroachievements', result);
    const parsed = gameProgressSchema.safeParse(result.json);
    // An unknown game ID answers 200 with an empty or partial object.
    if (!parsed.success) return null;

    const players = parsed.data.NumDistinctPlayers ?? 0;
    const achievements = Object.values(parsed.data.Achievements)
      .sort((a, b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0) || a.ID - b.ID)
      .map((item): RetroAchievement => {
        const earned = toIso(item.DateEarnedHardcore) ?? toIso(item.DateEarned);
        return {
          id: String(item.ID),
          name: item.Title,
          description: item.Description?.trim() || null,
          iconUrl: item.BadgeName ? `${BADGE_URL}/${item.BadgeName}.png` : null,
          globalPercent:
            players > 0 && item.NumAwarded != null
              ? Math.min(100, Math.round((item.NumAwarded / players) * 1000) / 10)
              : null,
          isStory: item.type === 'progression' || item.type === 'win_condition',
          isMissable: item.type === 'missable',
          isUnlocked: earned !== null,
          unlockedAt: earned,
        };
      });
    return {
      gameId: String(parsed.data.ID),
      title: parsed.data.Title,
      consoleName: parsed.data.ConsoleName ?? null,
      url: `${SITE_URL}/game/${parsed.data.ID}`,
      achievements,
    };
  }

  return {
    id: 'retroachievements',
    displayName: 'RetroAchievements',
    requiresCredentials: true,
    cacheTtlMs: PROGRESS_TTL_MS,
    rateLimit,

    isConfigured() {
      return Promise.resolve(
        Boolean(
          secrets.get('retroachievements.username') && secrets.get('retroachievements.api_key'),
        ),
      );
    },

    async healthCheck(): Promise<SourceHealth> {
      try {
        // Game 1 always exists; a wrong key answers 401.
        await load('1');
        return { status: 'ok', message: 'RetroAchievements answered' };
      } catch (error) {
        return healthFromError(error);
      }
    },

    async getGame(gameId) {
      if (!/^\d{1,9}$/.test(gameId)) return null;
      credentials();
      const entry = await cache.remember(
        'retroachievements',
        `game:${gameId}`,
        { ttlMs: PROGRESS_TTL_MS, version: CACHE_VERSION },
        () => load(gameId),
      );
      return entry.data
        ? { data: entry.data, fetchedAt: entry.fetchedAt, fromCache: entry.fromCache }
        : null;
    },
  };
}
