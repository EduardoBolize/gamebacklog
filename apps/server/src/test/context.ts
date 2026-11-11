import type { FastifyInstance } from 'fastify';
import { defineProvider, type AiProvider, type AiTextRequest } from '../ai/provider.ts';
import { createAiService } from '../ai/service.ts';
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
import type { WebSearchResult, WebSearchSource } from '../sources/web-search/index.ts';
import type { WikiSection } from '../sources/wiki/html.ts';
import type { WikiImage, WikiSite, WikiSource } from '../sources/wiki/index.ts';
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
  /** When true, every catalog request fails as if IGDB were down. */
  catalogFail: boolean;
  /** IGDB id → ids of the games the catalog lists as similar. */
  similarGames: Record<string, string[]>;
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
  /** Hosts that answer as a wiki, e.g. `zelda.fandom.com`. Any other host is "not a wiki". */
  wikiHosts: string[];
  /** Page title → sections. Search matches titles and text against the query words. */
  wikiPages: Record<string, WikiSection[]>;
  /** Image files of the wiki. A search matches the query words against the file names. */
  wikiImages: WikiImage[];
  /** Page title → names of the image files used on it. */
  wikiPageImages: Record<string, string[]>;
  /** Every wiki request made, as `probe:<host>`, `search:<query>` or `page:<title>`. */
  wikiCalls: string[];
  webSearchConfigured: boolean;
  webResults: WebSearchResult[];
  webSearchCalls: string[];
}

const FETCHED_AT = '2026-11-01T00:00:00.000Z';

function sourced<T>(origin: 'igdb' | 'steam' | 'hltb' | 'wiki', data: T, url?: string): Sourced<T> {
  return { data, fromCache: false, provenance: { origin, url, fetchedAt: FETCHED_AT } };
}

const base = { cacheTtlMs: 0, rateLimit: { maxRequests: 100, perMs: 1 } };

function fakeCatalog(state: FakeSources): CatalogSource {
  const assertConfigured = () => {
    if (!state.catalogConfigured) throw new SourceError('igdb', 'not_configured', 'not configured');
    if (state.catalogFail) throw new SourceError('igdb', 'unreachable', 'Could not reach IGDB');
  };
  const byId = (externalId: string) =>
    state.catalog.find((candidate) => candidate.externalId === externalId);
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
    async getSimilar(externalId) {
      await Promise.resolve();
      assertConfigured();
      const games = (state.similarGames[externalId] ?? [])
        .map(byId)
        .filter((game) => game !== undefined);
      return sourced('igdb', games);
    },
    async getTopByGenre(genre) {
      await Promise.resolve();
      assertConfigured();
      const wanted = genre.toLowerCase();
      // Catalog order stands in for "best rated first".
      return sourced(
        'igdb',
        state.catalog.filter((game) => game.genres.some((name) => name.toLowerCase() === wanted)),
      );
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

function fakeWiki(state: FakeSources): WikiSource {
  const words = (text: string): string[] => [
    ...(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
  ];
  return {
    id: 'wiki',
    probe(url) {
      const host = new URL(url).host;
      state.wikiCalls.push(`probe:${host}`);
      const site: WikiSite = {
        name: host,
        apiUrl: `https://${host}/api.php`,
        articleBase: `https://${host}/wiki/`,
      };
      return Promise.resolve(state.wikiHosts.includes(host) ? site : null);
    },
    search(_site, query, limit = 5) {
      state.wikiCalls.push(`search:${query}`);
      const wanted = words(query);
      const scored = Object.entries(state.wikiPages)
        .map(([title, sections]) => {
          const haystack =
            `${title} ${sections.map((section) => section.text).join(' ')}`.toLowerCase();
          const titleWords = words(title);
          const score =
            wanted.filter((word) => titleWords.includes(word)).length * 3 +
            wanted.filter((word) => haystack.includes(word)).length;
          return { title, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      return Promise.resolve(scored.slice(0, limit).map((item) => item.title));
    },
    getPage(site, title) {
      state.wikiCalls.push(`page:${title}`);
      const sections = state.wikiPages[title];
      if (!sections) return Promise.resolve(null);
      const url = site.articleBase + encodeURIComponent(title.replace(/ /g, '_'));
      return Promise.resolve(sourced('wiki', { title, url, sections }, url));
    },
    searchImages(_site, query, limit = 8) {
      state.wikiCalls.push(`images:${query}`);
      const wanted = words(query);
      const scored = state.wikiImages
        .map((image) => {
          const name = words(image.title);
          return { image, score: wanted.filter((word) => name.includes(word)).length };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      return Promise.resolve(scored.slice(0, limit).map((item) => item.image));
    },
    getPageImages(_site, title) {
      state.wikiCalls.push(`page-images:${title}`);
      const names = state.wikiPageImages[title] ?? [];
      return Promise.resolve(state.wikiImages.filter((image) => names.includes(image.title)));
    },
    healthCheck: () => Promise.resolve({ status: 'ok' as const, message: 'ok' }),
  };
}

function fakeWebSearch(state: FakeSources): WebSearchSource {
  return {
    id: 'web_search',
    isConfigured: () => state.webSearchConfigured,
    search(query, limit = 5) {
      if (!state.webSearchConfigured) return Promise.resolve([]);
      state.webSearchCalls.push(query);
      return Promise.resolve(state.webResults.slice(0, limit));
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

/** Scripted AI: tests push the answers it should give and read back what it was asked. */
export interface FakeAi {
  /** When false, the app behaves as if no AI was connected. */
  connected: boolean;
  /** Answers handed out in order; objects are sent as JSON. The last one repeats. */
  answers: unknown[];
  /** Every request the provider received. */
  requests: AiTextRequest[];
  provider: AiProvider;
}

function createFakeAi(): FakeAi {
  const fake: FakeAi = {
    connected: false,
    answers: [],
    requests: [],
    provider: defineProvider({
      id: 'ollama',
      displayName: 'Fake AI',
      kind: 'local',
      capabilities: { structuredOutput: false, maxContextTokens: 8000, costHint: 'free' },
      detect: () => Promise.resolve({ status: 'ok', message: 'ok' }),
      generate(request) {
        fake.requests.push(request);
        const answer = fake.answers.length > 1 ? fake.answers.shift() : fake.answers[0];
        if (answer === undefined) return Promise.reject(new Error('FakeAi has no answer queued'));
        return Promise.resolve({
          text: typeof answer === 'string' ? answer : JSON.stringify(answer),
          model: 'fake-model',
        });
      },
    }),
  };
  return fake;
}

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  sources: FakeSources;
  ai: FakeAi;
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
    catalogFail: false,
    similarGames: {},
    times: {},
    timesFail: false,
    timesCalls: [],
    steamConfigured: true,
    steamProfilePrivate: false,
    ownedGames: [],
    achievementSchemas: {},
    globalPercentages: {},
    playerAchievements: {},
    wikiHosts: [],
    wikiPages: {},
    wikiImages: [],
    wikiPageImages: {},
    wikiCalls: [],
    webSearchConfigured: false,
    webResults: [],
    webSearchCalls: [],
  };
  const secrets = new MemorySecretStore();
  const ai = createFakeAi();
  const ctx: AppContext = {
    db: handle.db,
    secrets,
    dataDir,
    now: () => now,
    igdb: fakeCatalog(sources),
    hltb: fakeTimes(sources),
    steam: fakeSteam(sources, () => getSetting(handle.db, SETTINGS.steamId)),
    wiki: fakeWiki(sources),
    webSearch: fakeWebSearch(sources),
    ai: {
      ...createAiService({
        db: handle.db,
        secrets,
        env: {},
        resolve: () => null,
        fetch: () => Promise.resolve(new Response('', { status: 599 })),
      }),
      getActive: () => (ai.connected ? ai.provider : null),
    },
    aiContextBudget: () => getSetting(handle.db, SETTINGS.aiContextBudget),
  };
  const app = await buildApp({ ctx });
  return {
    app,
    ctx,
    sources,
    ai,
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
