import type { SourceAdapter, Sourced } from './adapter.ts';

/** A game as described by a catalog source, already normalized to the internal model. */
export interface CatalogGameData {
  externalId: string;
  title: string;
  alternativeTitles: string[];
  summary: string | null;
  coverUrl: string | null;
  /** ISO `YYYY-MM-DD`. */
  releaseDate: string | null;
  releaseYear: number | null;
  platforms: string[];
  genres: string[];
  themes: string[];
  tags: string[];
  franchise: string | null;
  url: string | null;
  /** Steam app IDs the catalog links to this game. */
  steamAppIds: string[];
}

export interface CatalogSource extends SourceAdapter {
  search(query: string): Promise<Sourced<CatalogGameData[]>>;
  getById(externalId: string): Promise<Sourced<CatalogGameData> | null>;
  /** Looks games up by Steam app ID. Apps the catalog does not know are absent from the map. */
  findBySteamAppIds(appIds: string[]): Promise<Map<string, CatalogGameData>>;
}

export interface GameTimesData {
  externalId: string;
  title: string;
  mainMinutes: number | null;
  mainExtraMinutes: number | null;
  completionistMinutes: number | null;
  url: string;
}

export interface GameTimesQuery {
  title: string;
  alternativeTitles?: string[];
  releaseYear?: number | null;
}

export interface GameTimesSource extends SourceAdapter {
  /** Best match for the game, or null when nothing similar enough exists. */
  findTimes(query: GameTimesQuery): Promise<Sourced<GameTimesData> | null>;
}

export interface SteamOwnedGame {
  appId: string;
  name: string;
  playtimeMinutes: number;
  playtimeTwoWeeksMinutes: number;
}

export interface SteamAchievementDefinition {
  apiName: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  isHidden: boolean;
}

export interface SteamPlayerAchievement {
  apiName: string;
  isUnlocked: boolean;
  unlockedAt: Date | null;
}

export interface SteamSource extends SourceAdapter {
  /** The configured SteamID, or null. Not a secret. */
  getSteamId(): string | null;
  /** Throws `SourceError('profile_private')` when the game details are not public. */
  getOwnedGames(): Promise<SteamOwnedGame[]>;
  getAchievementSchema(appId: string): Promise<Sourced<SteamAchievementDefinition[]>>;
  /** API name → share of players who unlocked it (0–100). */
  getGlobalPercentages(appId: string): Promise<Record<string, number>>;
  /** `null` when the player's achievements are not visible (private profile). */
  getPlayerAchievements(appId: string): Promise<SteamPlayerAchievement[] | null>;
}
