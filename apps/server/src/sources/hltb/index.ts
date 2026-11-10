import { HowLongToBeatService, type HowLongToBeatEntry } from 'howlongtobeat-ts';
import { SourceError, type SourceHealth, type Sourced } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { createRateLimiter } from '../rate-limiter.ts';
import type { GameTimesData, GameTimesQuery, GameTimesSource } from '../types.ts';

const DAY = 24 * 60 * 60 * 1000;
const FOUND_TTL_MS = 30 * DAY;
/** "Not found" is remembered for a shorter time: the game may be added to the site later. */
const NOT_FOUND_TTL_MS = 3 * DAY;
const CACHE_VERSION = 1;

/** Below this, a result is treated as a different game. */
const MIN_SIMILARITY = 0.75;
/** A result at or above this is accepted without looking at the release year. */
const CONFIDENT_SIMILARITY = 0.95;

/** The part of the unofficial library this adapter uses; lets tests swap in a fake. */
export interface HltbClient {
  search(
    title: string,
  ): Promise<
    | { success: true; data: HowLongToBeatEntry[] }
    | { success: false; error: string; kind?: string; status?: number }
  >;
}

export interface HltbSourceOptions {
  cache: SourceCache;
  isEnabled: () => boolean;
  client?: HltbClient;
}

const toMinutes = (seconds: number | undefined) =>
  seconds && seconds > 0 ? Math.round(seconds / 60) : null;

/** Trademark signs and edition noise make store titles miss on HowLongToBeat. */
export function cleanTitle(title: string): string {
  return title.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
}

function pickBest(entries: HowLongToBeatEntry[], releaseYear?: number | null) {
  const candidates = entries
    .filter((entry) => entry.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity);
  if (candidates.length === 0) return null;

  if (releaseYear) {
    // Remakes and remasters share a title; the release year tells them apart.
    const sameYear = candidates.find(
      (entry) => entry.releaseYear > 0 && Math.abs(entry.releaseYear - releaseYear) <= 1,
    );
    if (sameYear) return sameYear;
  }
  const best = candidates[0];
  return best && best.similarity >= CONFIDENT_SIMILARITY ? best : (best ?? null);
}

/**
 * HowLongToBeat has no official API. This adapter goes through an unofficial library that
 * calls the site's own search, so it can stop working whenever the site changes. That is
 * expected: failures surface as `SourceError`, callers fall back to the manual fields, and
 * the user can switch the source off in Settings.
 */
export function createHltbSource(options: HltbSourceOptions): GameTimesSource {
  const { cache, isEnabled } = options;
  const client: HltbClient =
    options.client ?? new HowLongToBeatService({ timeout: 15_000, retries: 2, minSimilarity: 0.4 });
  // One request every 1.5s keeps a large import from hammering the site.
  const rateLimit = { maxRequests: 1, perMs: 1500 };
  const limiter = createRateLimiter(rateLimit);

  async function search(title: string): Promise<HowLongToBeatEntry[]> {
    const result = await limiter.schedule(() => client.search(title));
    if (result.success) return result.data;
    if (result.kind === 'http' && result.status === 429) {
      throw new SourceError('hltb', 'rate_limited', 'HowLongToBeat rate limit reached');
    }
    if (result.kind === 'parse') {
      throw new SourceError('hltb', 'invalid_response', 'HowLongToBeat changed its response');
    }
    throw new SourceError('hltb', 'unreachable', 'Could not reach HowLongToBeat');
  }

  return {
    id: 'hltb',
    displayName: 'HowLongToBeat',
    requiresCredentials: false,
    cacheTtlMs: FOUND_TTL_MS,
    rateLimit,

    isConfigured() {
      return Promise.resolve(true);
    },

    async healthCheck(): Promise<SourceHealth> {
      if (!isEnabled()) return { status: 'not_configured', message: 'HowLongToBeat is turned off' };
      try {
        await search('Celeste');
        return { status: 'ok', message: 'HowLongToBeat answered' };
      } catch (error) {
        const status =
          error instanceof SourceError && error.code === 'rate_limited'
            ? 'rate_limited'
            : 'unreachable';
        return { status, message: 'HowLongToBeat did not answer as expected' };
      }
    },

    async findTimes(query: GameTimesQuery): Promise<Sourced<GameTimesData> | null> {
      if (!isEnabled())
        throw new SourceError('hltb', 'not_configured', 'HowLongToBeat is turned off');

      const titles = [query.title, ...(query.alternativeTitles ?? []).slice(0, 2)]
        .map(cleanTitle)
        .filter((title, index, all) => title.length > 0 && all.indexOf(title) === index);
      const cacheKey = `times:${titles[0]?.toLowerCase() ?? ''}:${query.releaseYear ?? ''}`;

      const cached = cache.get<GameTimesData | null>('hltb', cacheKey, CACHE_VERSION);
      let data = cached?.data ?? null;
      let fetchedAt = cached?.fetchedAt ?? new Date();

      if (!cached) {
        for (const title of titles) {
          const best = pickBest(await search(title), query.releaseYear);
          if (best) {
            data = {
              externalId: String(best.id),
              title: best.name,
              mainMinutes: toMinutes(best.mainTime),
              mainExtraMinutes: toMinutes(best.mainExtraTime),
              completionistMinutes: toMinutes(best.completionistTime),
              url: `https://howlongtobeat.com/game/${best.id}`,
            };
            break;
          }
        }
        fetchedAt = cache.set('hltb', cacheKey, data, {
          ttlMs: data ? FOUND_TTL_MS : NOT_FOUND_TTL_MS,
          version: CACHE_VERSION,
          url: data?.url,
        });
      }

      if (!data) return null;
      return {
        data,
        fromCache: Boolean(cached),
        provenance: { origin: 'hltb', url: data.url, fetchedAt: fetchedAt.toISOString() },
      };
    },
  };
}
