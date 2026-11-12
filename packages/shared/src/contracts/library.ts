import { z } from 'zod';
import {
  achievementSyncSourceSchema,
  dataOriginSchema,
  externalIdSourceSchema,
  gameTimeOriginSchema,
  libraryStatusSchema,
  playthroughGoalSchema,
  playthroughStatusSchema,
  playthroughTypeSchema,
} from '../enums.ts';
import { isoDateSchema, isoDateTimeSchema, minutesSchema, scoreSchema } from './common.ts';

// --- Catalog search --------------------------------------------------------

export const catalogGameSchema = z.object({
  source: z.literal('igdb'),
  externalId: z.string(),
  title: z.string(),
  releaseYear: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  platforms: z.array(z.string()),
  /** Set when this game is already in the library. */
  libraryEntryId: z.string().nullable(),
});
export type CatalogGame = z.infer<typeof catalogGameSchema>;

export const catalogSearchResponseSchema = z.object({
  /** False when the catalog source has no credentials yet. */
  configured: z.boolean(),
  results: z.array(catalogGameSchema),
});
export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;

// --- Library list ----------------------------------------------------------

export const libraryItemSchema = z.object({
  id: z.string(),
  status: libraryStatusSchema,
  platform: z.string().nullable(),
  isFavorite: z.boolean(),
  tags: z.array(z.string()),
  addedAt: isoDateTimeSchema,
  game: z.object({
    id: z.string(),
    title: z.string(),
    coverUrl: z.string().nullable(),
    releaseYear: z.number().int().nullable(),
    platforms: z.array(z.string()),
    genres: z.array(z.string()),
  }),
  /** Best overall review score, for sorting. */
  score: z.number().nullable(),
  /** Main-story time to beat, for sorting. */
  mainMinutes: z.number().nullable(),
  /** Hours on the runs, or the diary when the runs have none. */
  playedMinutes: z.number().int().nonnegative(),
  /** Latest diary session or "where am I?" report. */
  lastPlayedAt: isoDateTimeSchema.nullable(),
  /**
   * How far along the game is: hours against the time to beat of the current run's goal
   * (never 100 while playing), 100 once finished, null when unknown.
   */
  progressPercent: z.number().int().min(0).max(100).nullable(),
  /** Achievements the app knows for the game (synced or typed). */
  achievementCount: z.number().int().nonnegative(),
  /** Accounts the game is linked to (where it was imported from). */
  accounts: z.array(achievementSyncSourceSchema),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

export const libraryListResponseSchema = z.object({ items: z.array(libraryItemSchema) });
export type LibraryListResponse = z.infer<typeof libraryListResponseSchema>;

// --- Adding and editing ------------------------------------------------------

export const addGameRequestSchema = z.object({
  status: libraryStatusSchema,
  platform: z.string().trim().min(1).max(80).optional(),
  game: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('igdb'), externalId: z.string().regex(/^\d+$/) }),
    z.object({
      kind: z.literal('manual'),
      title: z.string().trim().min(1).max(200),
      releaseYear: z.number().int().min(1950).max(2100).optional(),
    }),
  ]),
});
export type AddGameRequest = z.infer<typeof addGameRequestSchema>;

export const addGameResponseSchema = z.object({
  libraryEntryId: z.string(),
  /** False when the game was already in the library and nothing was created. */
  created: z.boolean(),
});
export type AddGameResponse = z.infer<typeof addGameResponseSchema>;

export const updateLibraryEntryRequestSchema = z
  .object({
    status: libraryStatusSchema,
    platform: z.string().trim().min(1).max(80).nullable(),
    isFavorite: z.boolean(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30),
  })
  .partial();
export type UpdateLibraryEntryRequest = z.infer<typeof updateLibraryEntryRequestSchema>;

// --- Game detail -------------------------------------------------------------

export const playthroughSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  type: playthroughTypeSchema,
  label: z.string().nullable(),
  goal: playthroughGoalSchema,
  status: playthroughStatusSchema,
  platform: z.string().nullable(),
  startedOn: isoDateSchema.nullable(),
  finishedOn: isoDateSchema.nullable(),
  playtimeMinutes: z.number().int().nullable(),
});
export type Playthrough = z.infer<typeof playthroughSchema>;

export const createPlaythroughRequestSchema = z.object({
  type: playthroughTypeSchema,
  label: z.string().trim().min(1).max(80).optional(),
  goal: playthroughGoalSchema,
});
export type CreatePlaythroughRequest = z.infer<typeof createPlaythroughRequestSchema>;

export const updatePlaythroughRequestSchema = z
  .object({
    type: playthroughTypeSchema,
    label: z.string().trim().min(1).max(80).nullable(),
    goal: playthroughGoalSchema,
    status: playthroughStatusSchema,
    platform: z.string().trim().min(1).max(80).nullable(),
    startedOn: isoDateSchema.nullable(),
    finishedOn: isoDateSchema.nullable(),
    playtimeMinutes: minutesSchema.nullable(),
  })
  .partial();
export type UpdatePlaythroughRequest = z.infer<typeof updatePlaythroughRequestSchema>;

export const gameTimesSchema = z.object({
  origin: gameTimeOriginSchema,
  mainMinutes: z.number().int().nullable(),
  mainExtraMinutes: z.number().int().nullable(),
  completionistMinutes: z.number().int().nullable(),
  originUrl: z.string().nullable(),
  fetchedAt: isoDateTimeSchema.nullable(),
});
export type GameTimes = z.infer<typeof gameTimesSchema>;

export const setManualTimesRequestSchema = z.object({
  mainMinutes: minutesSchema.nullable(),
  mainExtraMinutes: minutesSchema.nullable(),
  completionistMinutes: minutesSchema.nullable(),
});
export type SetManualTimesRequest = z.infer<typeof setManualTimesRequestSchema>;

export const gameDetailResponseSchema = z.object({
  entry: z.object({
    id: z.string(),
    status: libraryStatusSchema,
    platform: z.string().nullable(),
    isFavorite: z.boolean(),
    tags: z.array(z.string()),
  }),
  game: z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    coverUrl: z.string().nullable(),
    releaseDate: isoDateSchema.nullable(),
    releaseYear: z.number().int().nullable(),
    platforms: z.array(z.string()),
    genres: z.array(z.string()),
    themes: z.array(z.string()),
    franchise: z.string().nullable(),
    origin: dataOriginSchema,
    originUrl: z.string().nullable(),
    fetchedAt: isoDateTimeSchema.nullable(),
  }),
  externalIds: z.array(
    z.object({
      source: externalIdSourceSchema,
      externalId: z.string(),
      url: z.string().nullable(),
    }),
  ),
  /** The manual row wins over the HLTB row when both exist. */
  times: gameTimesSchema.nullable(),
  playthroughs: z.array(playthroughSchema),
});
export type GameDetailResponse = z.infer<typeof gameDetailResponseSchema>;

// --- Sessions ----------------------------------------------------------------

export const sessionSchema = z.object({
  id: z.string(),
  playthroughId: z.string().nullable(),
  startedAt: isoDateTimeSchema,
  durationMinutes: z.number().int(),
  note: z.string().nullable(),
  origin: z.enum(['manual', 'steam']),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionListResponseSchema = z.object({ items: z.array(sessionSchema) });
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const createSessionRequestSchema = z.object({
  playthroughId: z.string().nullable(),
  startedAt: isoDateTimeSchema,
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  note: z.string().trim().max(2000).optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const updateSessionRequestSchema = z
  .object({
    startedAt: isoDateTimeSchema,
    durationMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    note: z.string().trim().max(2000).nullable(),
  })
  .partial();
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

// --- Reviews -----------------------------------------------------------------

const reviewScoresShape = {
  score: scoreSchema.nullable(),
  difficultyScore: scoreSchema.nullable(),
  storyScore: scoreSchema.nullable(),
  gameplayScore: scoreSchema.nullable(),
  levelDesignScore: scoreSchema.nullable(),
  soundtrackScore: scoreSchema.nullable(),
  visualsScore: scoreSchema.nullable(),
  perceivedLengthScore: scoreSchema.nullable(),
};

export const REVIEW_SUBSCORE_KEYS = [
  'difficultyScore',
  'storyScore',
  'gameplayScore',
  'levelDesignScore',
  'soundtrackScore',
  'visualsScore',
  'perceivedLengthScore',
] as const;
export type ReviewSubscoreKey = (typeof REVIEW_SUBSCORE_KEYS)[number];

export const reviewSchema = z.object({
  id: z.string(),
  /** Null for the review of the game as a whole. */
  playthroughId: z.string().nullable(),
  ...reviewScoresShape,
  body: z.string().nullable(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  hasSpoilers: z.boolean(),
  timeToBeatMinutes: z.number().int().nullable(),
  reviewedAt: isoDateTimeSchema,
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewListResponseSchema = z.object({ items: z.array(reviewSchema) });
export type ReviewListResponse = z.infer<typeof reviewListResponseSchema>;

export const saveReviewRequestSchema = z.object({
  playthroughId: z.string().nullable(),
  ...reviewScoresShape,
  body: z.string().trim().max(20000).nullable(),
  pros: z.array(z.string().trim().min(1).max(120)).max(20),
  cons: z.array(z.string().trim().min(1).max(120)).max(20),
  hasSpoilers: z.boolean(),
  timeToBeatMinutes: minutesSchema.nullable(),
});
export type SaveReviewRequest = z.infer<typeof saveReviewRequestSchema>;
