import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import type { AppContext } from '../context.ts';
import { MemorySecretStore } from '../secrets/store.ts';
import { SETTINGS, getSetting } from '../settings/store.ts';
import { SourceError, type Sourced } from '../sources/adapter.ts';
import type {
  CatalogGameData,
  CatalogSource,
  GameTimesData,
  GameTimesSource,
  SteamAchievementDefinition,
  SteamOwnedGame,
  SteamPlayerAchievement,
  SteamSource,
} from '../sources/types.ts';
import { createTestDatabase } from './helpers.ts';

/** Catalog entry with sensible defaults, for building fake IGDB data. */
export function catalogGame(
  overrides: Partial<CatalogGameData> & { externalId: string },
): CatalogGameData {
  return {
    title: `Game ${overrides.externalId}`,
    alternativeTitles: [],
    summary: null,
    coverUrl: null,
    releaseDate: null,
    releaseYear: null,
    platforms: [],
    genres: [],
    themes: [],
    tags: [],
    franchise: null,
    url: `https://www.igdb.com/games/${overrides.externalId}`,
    steamAppIds: [],
    ...overrides,
  };
}

/** Mutable state behind the fake sources. Tests edit it to script what the "APIs" answer. */
export interface FakeSources {
  catalog: CatalogGameData[];
  catalogConfigured: boolean;
  times: Record<string, GameTimesData>;
  timesFail: boolean;
  timesCalls: string[];
  steamConfigured: boolean;
  steamProfilePrivate: boolean;
  ownedGames: SteamOwnedGame[];
  achievementSchemas: Record<string, SteamAchievementDefinition[]>;
  globalPercentages: Record<string, Record<string, number>>;
  /** `null` simulates a profile whose achievements are not public. */
  playerAchievements: Record<string, SteamPlayerAchievement[] | null>;
}

const FETCHED_AT = '2026-11-01T00:00:00.000Z';

function sourced<T>(origin: 'igdb' | 'steam' | 'hltb', data: T, url?: string): Sourced<T> {
  return { data, fromCache: false, provenance: { origin, url, fetchedAt: FETCHED_AT } };
}

const base = { cacheTtlMs: 0, rateLimit: { maxRequests: 100, perMs: 1 } };

function fakeCatalog(state: FakeSources): CatalogSource {
  const assertConfigured = () => {
    if (!state.catalogConfigured) throw new SourceError('igdb', 'not_configured', 'not configured');
  };
  return {
    ...base,
    id: 'igdb',
    displayName: 'IGDB',
    requiresCredentials: true,
    isConfigured: () => Promise.resolve(state.catalogConfigured),
    healthCheck: () =>
      Promise.resolve(
        state.catalogConfigured
          ? { status: 'ok' as const, message: 'ok' }
          : { status: 'not_configured' as const, message: 'not configured' },
      ),
    search(query) {
      assertConfigured();
      const text = query.toLowerCase();
      return Promise.resolve(
        sourced(
          'igdb',
          state.catalog.filter((game) => game.title.toLowerCase().includes(text)),
        ),
      );
    },
    getById(externalId) {
      assertConfigured();
      const game = state.catalog.find((candidate) => candidate.externalId === externalId);
      return Promise.resolve(game ? sourced('igdb', game, game.url ?? undefined) : null);
    },
    findBySteamAppIds(appIds) {
      assertConfigured();
      const found = new Map<string, CatalogGameData>();
      for (const appId of appIds) {
        const game = state.catalog.find((candidate) => candidate.steamAppIds.includes(appId));
        if (game) found.set(appId, game);
      }
      return Promise.resolve(found);
    },
  };
}

function fakeTimes(state: FakeSources): GameTimesSource {
  return {
    ...base,
    id: 'hltb',
    displayName: 'HowLongToBeat',
    requiresCredentials: false,
    isConfigured: () => Promise.resolve(true),
    healthCheck: () => Promise.resolve({ status: 'ok' as const, message: 'ok' }),
    findTimes(query) {
      state.timesCalls.push(query.title);
      if (state.timesFail) {
        return Promise.reject(
          new SourceError('hltb', 'unreachable', 'Could not reach HowLongToBeat'),
        );
      }
      const data = state.times[query.title];
      return Promise.resolve(data ? sourced('hltb', data, data.url) : null);
    },
  };
}

function fakeSteam(state: FakeSources, getSteamId: () => string | null): SteamSource {
  const assertConfigured = () => {
    if (!state.steamConfigured) throw new SourceError('steam', 'not_configured', 'not configured');
  };
  return {
    ...base,
    id: 'steam',
    displayName: 'Steam',
    requiresCredentials: true,
    getSteamId,
    isConfigured: () => Promise.resolve(state.steamConfigured),
    healthCheck: () => Promise.resolve({ status: 'ok' as const, message: 'ok' }),
    getOwnedGames() {
      assertConfigured();
      if (state.steamProfilePrivate) {
        return Promise.reject(new SourceError('steam', 'profile_private', 'private'));
      }
      return Promise.resolve(state.ownedGames);
    },
    getAchievementSchema(appId) {
      assertConfigured();
      return Promise.resolve(sourced('steam', state.achievementSchemas[appId] ?? []));
    },
    getGlobalPercentages(appId) {
      return Promise.resolve(state.globalPercentages[appId] ?? {});
    },
    getPlayerAchievements(appId) {
      assertConfigured();
      const value = state.playerAchievements[appId];
      return Promise.resolve(value === undefined ? [] : value);
    },
  };
}

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  sources: FakeSources;
  /** Moves the clock the app sees. */
  setNow: (iso: string) => void;
  close: () => Promise<void>;
}

/** Full app over an in-memory database, with scripted sources and a fixed clock. */
export async function createTestApp(dataDir = 'unused-in-tests'): Promise<TestApp> {
  const handle = createTestDatabase();
  let now = new Date('2026-11-10T12:00:00.000Z');
  const sources: FakeSources = {
    catalog: [],
    catalogConfigured: true,
    times: {},
    timesFail: false,
    timesCalls: [],
    steamConfigured: true,
    steamProfilePrivate: false,
    ownedGames: [],
    achievementSchemas: {},
    globalPercentages: {},
    playerAchievements: {},
  };
  const ctx: AppContext = {
    db: handle.db,
    secrets: new MemorySecretStore(),
    dataDir,
    now: () => now,
    igdb: fakeCatalog(sources),
    hltb: fakeTimes(sources),
    steam: fakeSteam(sources, () => getSetting(handle.db, SETTINGS.steamId)),
  };
  const app = await buildApp({ ctx });
  return {
    app,
    ctx,
    sources,
    setNow: (iso) => {
      now = new Date(iso);
    },
    close: async () => {
      await app.close();
      handle.close();
    },
  };
}

/** Lets background work queued by a request (e.g. the HLTB lookup) finish. */
export const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));
