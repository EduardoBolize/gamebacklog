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
  /** Games the catalog itself lists as similar, in the catalog's order. */
  getSimilar(externalId: string): Promise<Sourced<CatalogGameData[]>>;
  /** Best-rated games of a genre, best first. Empty when the catalog has no such genre. */
  getTopByGenre(genre: string): Promise<Sourced<CatalogGameData[]>>;
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

/** A game on a console account. Dates are ISO strings, as they travel through the cache. */
export interface ConsoleGame {
  /** ID of the game's trophy or achievement list on that network. */
  titleId: string;
  name: string;
  /** Console it was played on, in the catalog's wording, e.g. `PlayStation 5`. */
  platform: string;
  coverUrl: string | null;
  /** Null when the network does not report hours. */
  playtimeMinutes: number | null;
  lastPlayedAt: string | null;
  /** Share of the trophies or achievements earned, 0–100. */
  progressPercent: number | null;
}

export interface ConsoleAchievement {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  isHidden: boolean;
  /** Share of players who have it, 0–100. */
  globalPercent: number | null;
  isUnlocked: boolean;
  unlockedAt: string | null;
}

/** A console network the user signed in to: PlayStation Network or Xbox. */
export interface ConsoleSource extends SourceAdapter {
  getGames(): Promise<ConsoleGame[]>;
  /** The trophies or achievements of one game, with the account's own unlocks. */
  getAchievements(titleId: string): Promise<Sourced<ConsoleAchievement[]>>;
}
