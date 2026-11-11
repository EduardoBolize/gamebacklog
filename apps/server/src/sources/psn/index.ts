import { z } from 'zod';
import type { SecretStore } from '../../secrets/store.ts';
import { SourceError, healthFromError, type SourceHealth } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { assertOk, requestJson, type FetchLike } from '../http.ts';
import { createRateLimiter } from '../rate-limiter.ts';
import type { ConsoleAchievement, ConsoleGame, ConsoleSource } from '../types.ts';

/**
 * PlayStation Network, read-only: the games the account has trophies for, and those trophies.
 *
 * Sony publishes no API. This talks to the endpoints the official PlayStation app uses, signed
 * in with a token (NPSSO) the user copies from their own logged-in browser session. It is
 * unofficial, outside Sony's terms, and may stop working without notice — which is why the
 * user has to opt in, and why every failure here is reported and never breaks the app.
 * Requests and fields follow the community-maintained `psn-api` project (checked November 2026).
 */

const AUTH_URL = 'https://ca.account.sony.com/api/authz/v3/oauth';
const TROPHY_URL = 'https://m.np.playstation.com/api/trophy/v1';
const GAMES_URL = 'https://m.np.playstation.com/api/gamelist/v2/users/me/titles';

/**
 * Public client of the PlayStation mobile app: every unofficial client sends the same values.
 * They identify the app, not the user, and unlock nothing without the user's own NPSSO.
 */
const APP_CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const APP_CLIENT_BASIC =
  'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const APP_REDIRECT = 'com.scee.psxandroid.scecompcall://redirect';
const APP_SCOPE = 'psn:mobile.v2.core psn:clientapp';

const HOUR = 60 * 60 * 1000;
const GAMES_TTL_MS = HOUR;
const TROPHIES_TTL_MS = HOUR;
const CACHE_VERSION = 1;
const PAGE_SIZE = 200;
/** Trophy names in English, so the story heuristics work the same as for Steam. */
const LANGUAGE = 'en-US';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  /** Seconds until the access token expires. */
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
});

const trophyTitlesSchema = z.object({
  trophyTitles: z.array(
    z.object({
      npServiceName: z.string(),
      npCommunicationId: z.string(),
      trophyTitleName: z.string(),
      trophyTitleIconUrl: z.string().optional(),
      trophyTitlePlatform: z.string().optional(),
      progress: z.number().optional(),
      lastUpdatedDateTime: z.string().optional(),
    }),
  ),
  nextOffset: z.number().optional(),
});

const playedGamesSchema = z.object({
  titles: z.array(
    z.object({
      name: z.string(),
      /** ISO 8601 duration, e.g. `PT228H56M33S`. */
      playDuration: z.string().optional(),
    }),
  ),
  nextOffset: z.number().optional(),
});

const titleTrophiesSchema = z.object({
  trophies: z.array(
    z.object({
      trophyId: z.number(),
      trophyHidden: z.boolean().optional(),
      trophyName: z.string().optional(),
      trophyDetail: z.string().optional(),
      trophyIconUrl: z.string().optional(),
    }),
  ),
});

const earnedTrophiesSchema = z.object({
  trophies: z.array(
    z.object({
      trophyId: z.number(),
      earned: z.boolean().optional(),
      earnedDateTime: z.string().optional(),
      /** Share of players who have it, as a string such as `"12.5"`. */
      trophyEarnedRate: z.string().optional(),
    }),
  ),
});

/** "PS5,PS4" → the newest console named, in the catalog's own wording. */
export function psnPlatform(raw: string | undefined): string {
  const value = (raw ?? '').toUpperCase();
  if (value.includes('PS5')) return 'PlayStation 5';
  if (value.includes('PS4')) return 'PlayStation 4';
  if (value.includes('PS3')) return 'PlayStation 3';
  if (value.includes('VITA')) return 'PlayStation Vita';
  return 'PlayStation';
}

/** `PT228H56M33S` → minutes. Null for anything that is not a duration. */
export function isoDurationToMinutes(duration: string | undefined): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration ?? '');
  if (!match) return null;
  return (
    Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) + Math.round(Number(match[3] ?? 0) / 60)
  );
}

const sameName = (text: string) =>
  text
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface PsnSourceOptions {
  secrets: SecretStore;
  cache: SourceCache;
  fetch?: FetchLike;
  now?: () => Date;
}

export function createPsnSource(options: PsnSourceOptions): ConsoleSource {
  const { secrets, cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const rateLimit = { maxRequests: 3, perMs: 1000 };
  const limiter = createRateLimiter(rateLimit);

  // Access tokens last about an hour: memory only. The refresh token goes to the secret store.
  let access: { value: string; expiresAt: number; npsso: string } | null = null;

  const expired = () =>
    new SourceError(
      'psn',
      'invalid_credentials',
      'PlayStation rejected the token. Copy a new NPSSO token and save it again.',
    );

  async function requestTokens(body: Record<string, string>) {
    const result = await requestJson('psn', fetchImpl, `${AUTH_URL}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: APP_CLIENT_BASIC,
      },
      body: new URLSearchParams({ ...body, token_format: 'jwt' }).toString(),
    });
    if (result.status === 400 || result.status === 401 || result.status === 403) throw expired();
    assertOk('psn', result);
    const parsed = tokenSchema.safeParse(result.json);
    if (!parsed.success) {
      throw new SourceError('psn', 'invalid_response', 'Unexpected token answer from PlayStation');
    }
    return parsed.data;
  }

  /** Trades the NPSSO for a one-time code. Sony answers with a redirect that carries it. */
  async function accessCode(npsso: string): Promise<string> {
    const query = new URLSearchParams({
      access_type: 'offline',
      client_id: APP_CLIENT_ID,
      redirect_uri: APP_REDIRECT,
      response_type: 'code',
      scope: APP_SCOPE,
    });
    let location: string | null;
    try {
      const response = await fetchImpl(`${AUTH_URL}/authorize?${query.toString()}`, {
        headers: { Cookie: `npsso=${npsso}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      location = response.headers.get('location');
    } catch {
      throw new SourceError('psn', 'unreachable', 'Could not reach PlayStation');
    }
    const code = location?.includes('?code=')
      ? new URLSearchParams(location.slice(location.indexOf('?') + 1)).get('code')
      : null;
    if (!code) throw expired();
    return code;
  }

  async function accessToken(): Promise<string> {
    const npsso = secrets.get('psn.npsso');
    if (!npsso) throw new SourceError('psn', 'not_configured', 'The PSN token is not set');
    if (access && access.npsso === npsso && access.expiresAt > now().getTime()) return access.value;

    let tokens: z.infer<typeof tokenSchema> | null = null;
    const refreshToken = secrets.get('psn.refresh_token');
    if (refreshToken) {
      // A refresh token outlives the NPSSO's own session; fall back to the NPSSO if it is spent.
      tokens = await requestTokens({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: APP_SCOPE,
      }).catch((error: unknown) => {
        if (error instanceof SourceError && error.code === 'invalid_credentials') return null;
        throw error;
      });
    }
    tokens ??= await requestTokens({
      code: await accessCode(npsso),
      redirect_uri: APP_REDIRECT,
      grant_type: 'authorization_code',
    });

    if (tokens.refresh_token) secrets.set('psn.refresh_token', tokens.refresh_token);
    access = {
      value: tokens.access_token,
      npsso,
      // A minute of slack, so a request never leaves with a token about to expire.
      expiresAt: now().getTime() + (tokens.expires_in - 60) * 1000,
    };
    return access.value;
  }

  async function get<T>(url: string, schema: z.ZodType<T>, what: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken();
      const result = await limiter.schedule(() =>
        requestJson('psn', fetchImpl, url, {
          headers: { Authorization: `Bearer ${token}`, 'Accept-Language': LANGUAGE },
        }),
      );
      if (result.status === 401 && attempt === 0) {
        // The token was revoked early: get a new one and try once more.
        access = null;
        continue;
      }
      assertOk('psn', result);
      const parsed = schema.safeParse(result.json);
      if (!parsed.success) {
        throw new SourceError('psn', 'invalid_response', `Unexpected PlayStation ${what} answer`);
      }
      return parsed.data;
    }
  }

  async function paged<TPage extends { nextOffset?: number }, TItem>(
    baseUrl: string,
    schema: z.ZodType<TPage>,
    what: string,
    itemsOf: (page: TPage) => TItem[],
  ): Promise<TItem[]> {
    const items: TItem[] = [];
    let offset = 0;
    // Twenty-five pages of 200 is far beyond any real account; it only bounds a broken answer.
    for (let page = 0; page < 25; page++) {
      const separator = baseUrl.includes('?') ? '&' : '?';
      const data = await get(
        `${baseUrl}${separator}limit=${PAGE_SIZE}&offset=${offset}`,
        schema,
        what,
      );
      items.push(...itemsOf(data));
      if (!data.nextOffset || data.nextOffset <= offset) break;
      offset = data.nextOffset;
    }
    return items;
  }

  async function loadGames(): Promise<ConsoleGame[]> {
    const titles = await paged(
      `${TROPHY_URL}/users/me/trophyTitles`,
      trophyTitlesSchema,
      'trophy list',
      (page) => page.trophyTitles,
    );
    // Hours live in another list, keyed by another ID; names are the only bridge. Optional.
    const minutesByName = new Map<string, number>();
    try {
      const played = await paged(
        `${GAMES_URL}?categories=ps4_game,ps5_native_game`,
        playedGamesSchema,
        'game list',
        (page) => page.titles,
      );
      for (const title of played) {
        const minutes = isoDurationToMinutes(title.playDuration);
        if (minutes === null) continue;
        const key = sameName(title.name);
        minutesByName.set(key, Math.max(minutes, minutesByName.get(key) ?? 0));
      }
    } catch {
      // Without it the games simply come in with no hours.
    }

    return titles.map((title) => ({
      // The service name is part of the ID: PS5 and PS4 lists answer on different services.
      titleId: `${title.npServiceName}:${title.npCommunicationId}`,
      name: title.trophyTitleName,
      platform: psnPlatform(title.trophyTitlePlatform),
      coverUrl: title.trophyTitleIconUrl ?? null,
      playtimeMinutes: minutesByName.get(sameName(title.trophyTitleName)) ?? null,
      lastPlayedAt: title.lastUpdatedDateTime ?? null,
      progressPercent: title.progress ?? null,
    }));
  }

  return {
    id: 'psn',
    displayName: 'PlayStation Network',
    requiresCredentials: true,
    cacheTtlMs: GAMES_TTL_MS,
    rateLimit,

    isConfigured() {
      return Promise.resolve(Boolean(secrets.get('psn.npsso')));
    },

    async healthCheck(): Promise<SourceHealth> {
      try {
        access = null;
        await accessToken();
        return { status: 'ok', message: 'PlayStation answered' };
      } catch (error) {
        return healthFromError(error);
      }
    },

    async getGames() {
      if (!secrets.get('psn.npsso')) {
        throw new SourceError('psn', 'not_configured', 'The PSN token is not set');
      }
      const entry = await cache.remember(
        'psn',
        'games',
        { ttlMs: GAMES_TTL_MS, version: CACHE_VERSION },
        loadGames,
      );
      return entry.data;
    },

    async getAchievements(titleId) {
      const [service, communicationId] = titleId.split(':');
      if (!service || !communicationId || !/^[\w-]+$/.test(service + communicationId)) {
        throw new SourceError('psn', 'not_found', 'Not a PlayStation trophy list');
      }
      const base = `npCommunicationIds/${communicationId}/trophyGroups/all/trophies?npServiceName=${service}`;
      const entry = await cache.remember(
        'psn',
        `trophies:${titleId}`,
        { ttlMs: TROPHIES_TTL_MS, version: CACHE_VERSION },
        async (): Promise<ConsoleAchievement[]> => {
          const [catalog, earned] = await Promise.all([
            get(`${TROPHY_URL}/${base}`, titleTrophiesSchema, 'trophies'),
            get(`${TROPHY_URL}/users/me/${base}`, earnedTrophiesSchema, 'earned trophies'),
          ]);
          const earnedById = new Map(earned.trophies.map((trophy) => [trophy.trophyId, trophy]));
          return catalog.trophies.map((trophy) => {
            const mine = earnedById.get(trophy.trophyId);
            const rate = Number(mine?.trophyEarnedRate);
            return {
              id: String(trophy.trophyId),
              name: trophy.trophyName ?? `Trophy ${trophy.trophyId}`,
              description: trophy.trophyDetail?.trim() || null,
              iconUrl: trophy.trophyIconUrl ?? null,
              isHidden: trophy.trophyHidden ?? false,
              globalPercent: mine?.trophyEarnedRate && Number.isFinite(rate) ? rate : null,
              isUnlocked: mine?.earned ?? false,
              unlockedAt: mine?.earned && mine.earnedDateTime ? mine.earnedDateTime : null,
            };
          });
        },
      );
      return {
        data: entry.data,
        fromCache: entry.fromCache,
        provenance: { origin: 'psn', fetchedAt: entry.fetchedAt.toISOString() },
      };
    },
  };
}
