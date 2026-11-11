import { createAiService, type AiService } from './ai/service.ts';
import type { AppDatabase } from './db/client.ts';
import type { SecretStore } from './secrets/store.ts';
import { SETTINGS, getSetting } from './settings/store.ts';
import { SourceCache } from './sources/cache.ts';
import { createHltbSource } from './sources/hltb/index.ts';
import { createIgdbSource } from './sources/igdb/index.ts';
import { createPsnSource } from './sources/psn/index.ts';
import { createSteamSource } from './sources/steam/index.ts';
import type {
  CatalogSource,
  ConsoleSource,
  GameTimesSource,
  SteamSource,
} from './sources/types.ts';
import { createWebSearchSource, type WebSearchSource } from './sources/web-search/index.ts';
import { createWikiSource, type WikiSource } from './sources/wiki/index.ts';
import { createXboxSource } from './sources/xbox/index.ts';

/** Everything a route or service needs. Tests build one with fake sources. */
export interface AppContext {
  db: AppDatabase;
  secrets: SecretStore;
  igdb: CatalogSource;
  steam: SteamSource;
  psn: ConsoleSource;
  xbox: ConsoleSource;
  hltb: GameTimesSource;
  wiki: WikiSource;
  webSearch: WebSearchSource;
  ai: AiService;
  /** Token budget for the context sent with each AI request. */
  aiContextBudget: () => number;
  dataDir: string;
  now: () => Date;
}

export function createContext(options: {
  db: AppDatabase;
  secrets: SecretStore;
  dataDir: string;
}): AppContext {
  const { db, secrets, dataDir } = options;
  const cache = new SourceCache(db);
  return {
    db,
    secrets,
    dataDir,
    now: () => new Date(),
    ai: createAiService({ db, secrets }),
    aiContextBudget: () => getSetting(db, SETTINGS.aiContextBudget),
    igdb: createIgdbSource({ secrets, cache }),
    steam: createSteamSource({
      secrets,
      cache,
      getSteamId: () => getSetting(db, SETTINGS.steamId),
    }),
    psn: createPsnSource({ secrets, cache }),
    xbox: createXboxSource({ secrets, cache }),
    hltb: createHltbSource({ cache, isEnabled: () => getSetting(db, SETTINGS.hltbEnabled) }),
    wiki: createWikiSource({ cache }),
    webSearch: createWebSearchSource({
      secrets,
      cache,
      getProvider: () => getSetting(db, SETTINGS.webSearchProvider),
      getSearxngUrl: () => getSetting(db, SETTINGS.searxngUrl),
    }),
  };
}

/** Calendar date in the machine's time zone, `YYYY-MM-DD`. */
export function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
