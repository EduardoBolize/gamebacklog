import { z } from 'zod';

/**
 * Single source of truth for every enumerated value in the app.
 * The Drizzle schema, the HTTP contracts and the export/import format all read from here.
 * Adding a value is safe; removing or renaming one needs a data migration.
 */

// --- Library ---------------------------------------------------------------

export const LIBRARY_STATUSES = [
  'playing',
  'backlog',
  'wishlist',
  'completed',
  'completed_100',
  'paused',
  'dropped',
] as const;
export const libraryStatusSchema = z.enum(LIBRARY_STATUSES);
export type LibraryStatus = z.infer<typeof libraryStatusSchema>;

export const PLAYTHROUGH_TYPES = ['normal', 'ng_plus', 'ng_plus_plus', 'custom'] as const;
export const playthroughTypeSchema = z.enum(PLAYTHROUGH_TYPES);
export type PlaythroughType = z.infer<typeof playthroughTypeSchema>;

export const PLAYTHROUGH_GOALS = ['finish', 'full_100', 'all_achievements'] as const;
export const playthroughGoalSchema = z.enum(PLAYTHROUGH_GOALS);
export type PlaythroughGoal = z.infer<typeof playthroughGoalSchema>;

export const PLAYTHROUGH_STATUSES = [
  'not_started',
  'playing',
  'paused',
  'completed',
  'dropped',
] as const;
export const playthroughStatusSchema = z.enum(PLAYTHROUGH_STATUSES);
export type PlaythroughStatus = z.infer<typeof playthroughStatusSchema>;

// --- Sources and data origin -----------------------------------------------

/** External data sources, one adapter each under `apps/server/src/sources/<id>/`. */
export const SOURCE_IDS = [
  'igdb',
  'hltb',
  'steam',
  'steam_store',
  'retroachievements',
  'rawg',
  'pcgamingwiki',
  'wiki',
  'reddit',
  'web_search',
] as const;
export const sourceIdSchema = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof sourceIdSchema>;

/** Where any stored piece of data came from: a source, the AI, or the user. */
export const DATA_ORIGINS = [...SOURCE_IDS, 'ai', 'manual'] as const;
export const dataOriginSchema = z.enum(DATA_ORIGINS);
export type DataOrigin = z.infer<typeof dataOriginSchema>;

/** Sources that give a game a stable ID we can cross-reference. */
export const EXTERNAL_ID_SOURCES = [
  'igdb',
  'steam',
  'hltb',
  'retroachievements',
  'rawg',
  'pcgamingwiki',
] as const;
export const externalIdSourceSchema = z.enum(EXTERNAL_ID_SOURCES);
export type ExternalIdSource = z.infer<typeof externalIdSourceSchema>;

export const MATCH_METHODS = ['auto', 'user'] as const;
export const matchMethodSchema = z.enum(MATCH_METHODS);
export type MatchMethod = z.infer<typeof matchMethodSchema>;

export const GAME_TIME_ORIGINS = ['hltb', 'manual'] as const;
export const gameTimeOriginSchema = z.enum(GAME_TIME_ORIGINS);
export type GameTimeOrigin = z.infer<typeof gameTimeOriginSchema>;

export const SESSION_ORIGINS = ['manual', 'steam'] as const;
export const sessionOriginSchema = z.enum(SESSION_ORIGINS);
export type SessionOrigin = z.infer<typeof sessionOriginSchema>;

/** Origin of chapter maps, checkpoints and collectibles. */
export const CONTENT_ORIGINS = ['wiki', 'ai', 'manual'] as const;
export const contentOriginSchema = z.enum(CONTENT_ORIGINS);
export type ContentOrigin = z.infer<typeof contentOriginSchema>;

// --- Progress ----------------------------------------------------------------

/** How a free-text "where am I?" was turned into a checkpoint. */
export const CHECKPOINT_RESOLUTIONS = ['manual', 'local_match', 'ai'] as const;
export const checkpointResolutionSchema = z.enum(CHECKPOINT_RESOLUTIONS);
export type CheckpointResolution = z.infer<typeof checkpointResolutionSchema>;

// --- Achievements ------------------------------------------------------------

export const ACHIEVEMENT_ORIGINS = ['steam', 'retroachievements', 'wiki', 'ai', 'manual'] as const;
export const achievementOriginSchema = z.enum(ACHIEVEMENT_ORIGINS);
export type AchievementOrigin = z.infer<typeof achievementOriginSchema>;

export const ACHIEVEMENT_PROGRESS_ORIGINS = ['steam', 'retroachievements', 'manual'] as const;
export const achievementProgressOriginSchema = z.enum(ACHIEVEMENT_PROGRESS_ORIGINS);
export type AchievementProgressOrigin = z.infer<typeof achievementProgressOriginSchema>;

/** Who set the missable / story / NG+ flags of an achievement. A `user` value is never overwritten. */
export const CLASSIFICATION_ORIGINS = ['heuristic', 'ai', 'user'] as const;
export const classificationOriginSchema = z.enum(CLASSIFICATION_ORIGINS);
export type ClassificationOrigin = z.infer<typeof classificationOriginSchema>;

// --- Hints -------------------------------------------------------------------

export const HINT_KINDS = ['general', 'puzzle', 'boss'] as const;
export const hintKindSchema = z.enum(HINT_KINDS);
export type HintKind = z.infer<typeof hintKindSchema>;

/** 1 = nudge, 2 = direction, 3 = specific hint, 4 = full solution (behind the spoiler shield). */
export const HINT_LEVELS = [1, 2, 3, 4] as const;
export const hintLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type HintLevel = z.infer<typeof hintLevelSchema>;

// --- AI ----------------------------------------------------------------------

export const AI_PROVIDER_KINDS = ['cli', 'api', 'local'] as const;
export const aiProviderKindSchema = z.enum(AI_PROVIDER_KINDS);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

export const AI_COST_HINTS = ['subscription', 'pay-per-use', 'free'] as const;
export const aiCostHintSchema = z.enum(AI_COST_HINTS);
export type AiCostHint = z.infer<typeof aiCostHintSchema>;

/** Every way to connect an AI. CLIs use the user's subscription; APIs are pay-per-use; local is free. */
export const AI_PROVIDER_IDS = [
  'claude_cli',
  'codex_cli',
  'gemini_cli',
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
  'lmstudio',
] as const;
export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

/** What a provider check can report. The web app translates each one. */
export const AI_HEALTH_STATUSES = [
  'ok',
  'not_installed',
  'not_authenticated',
  'not_configured',
  'unreachable',
  'error',
] as const;
export const aiHealthStatusSchema = z.enum(AI_HEALTH_STATUSES);
export type AiHealthStatus = z.infer<typeof aiHealthStatusSchema>;

export const WEB_SEARCH_PROVIDERS = ['searxng', 'brave', 'tavily'] as const;
export const webSearchProviderSchema = z.enum(WEB_SEARCH_PROVIDERS);
export type WebSearchProvider = z.infer<typeof webSearchProviderSchema>;
