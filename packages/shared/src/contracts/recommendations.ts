import { z } from 'zod';
import { libraryStatusSchema } from '../enums.ts';
import { provenanceSchema } from '../provenance.ts';

/** What the taste profile is made of. `tag` is a mechanic or keyword of the game. */
export const TASTE_DIMENSIONS = ['genre', 'theme', 'franchise', 'platform', 'tag'] as const;
export const tasteDimensionSchema = z.enum(TASTE_DIMENSIONS);
export type TasteDimension = z.infer<typeof tasteDimensionSchema>;

export const RECOMMENDATION_LISTS = ['play_next', 'similar', 'completion', 'genre'] as const;
export const recommendationListSchema = z.enum(RECOMMENDATION_LISTS);
export type RecommendationList = z.infer<typeof recommendationListSchema>;

export const recommendationLocaleSchema = z.enum(['pt-BR', 'en']);

// --- Taste profile -----------------------------------------------------------

export const tasteFeatureSchema = z.object({
  value: z.string(),
  /** Roughly -1.5 (avoided) to 1.5 (loved); 0 is neutral. */
  weight: z.number(),
  /** How many games with a signal carry this feature. */
  games: z.number().int(),
  /** Titles that pushed the weight the hardest, strongest first. */
  because: z.array(z.string()),
});
export type TasteFeature = z.infer<typeof tasteFeatureSchema>;

export const tasteProfileResponseSchema = z.object({
  /** Games with a review score. */
  ratedGames: z.number().int(),
  /** Games that say anything about taste: rated, finished, being played, paused or dropped. */
  signalGames: z.number().int(),
  dimensions: z.array(
    z.object({
      dimension: tasteDimensionSchema,
      liked: z.array(tasteFeatureSchema),
      disliked: z.array(tasteFeatureSchema),
    }),
  ),
});
export type TasteProfileResponse = z.infer<typeof tasteProfileResponseSchema>;

// --- Recommended games -------------------------------------------------------

/** One reason a game fits (or does not fit) the profile, computed locally. */
export const recommendationReasonSchema = z.object({
  dimension: tasteDimensionSchema,
  value: z.string(),
  weight: z.number(),
  because: z.array(z.string()),
});
export type RecommendationReason = z.infer<typeof recommendationReasonSchema>;

/** Shape of a game's achievement list: how big it is and how hard the tail gets. */
export const achievementShapeSchema = z.object({
  count: z.number().int(),
  /** Share of players holding the median achievement, 0–100. Null without global data. */
  medianPercent: z.number().nullable(),
  rarestPercent: z.number().nullable(),
  /** Share of the list unlocked by fewer than 10% of players, 0–1. */
  rareShare: z.number().nullable(),
  /** Completionist time divided by main-story time, when both are known. */
  completionRatio: z.number().nullable(),
});
export type AchievementShape = z.infer<typeof achievementShapeSchema>;

export const recommendedGameSchema = z.object({
  /** Stable identity: `entry:<library entry>` or `igdb:<IGDB id>`. */
  key: z.string(),
  libraryEntryId: z.string().nullable(),
  status: libraryStatusSchema.nullable(),
  /** IGDB id, to add the game to the library with one click. */
  igdbId: z.string().nullable(),
  title: z.string(),
  coverUrl: z.string().nullable(),
  releaseYear: z.number().int().nullable(),
  genres: z.array(z.string()),
  /** Fit with the taste profile, 0–100; 50 is neutral. Null while there is no profile. */
  affinity: z.number().int().nullable(),
  reasons: z.array(recommendationReasonSchema),
  /** How close it is to the reference game, 0–100. Only in the "similar" lists. */
  similarity: z.number().int().nullable(),
  /** Genres, themes, mechanics and franchise shared with the reference game. */
  shared: z.array(z.string()),
  /** True when IGDB itself lists the game as similar to the reference game. */
  listedBySource: z.boolean(),
  shape: achievementShapeSchema.nullable(),
  /** For paused and dropped games: share of the main story already played, 0–100. */
  playedPercent: z.number().int().nullable(),
  /** One line written by the AI, when one was asked for and is cached. */
  line: z.string().nullable(),
  /** Where the data came from, for games that are not in the library. */
  source: provenanceSchema.nullable(),
});
export type RecommendedGame = z.infer<typeof recommendedGameSchema>;

/** What the catalog source could contribute to a list. */
export const catalogReachSchema = z.enum(['ok', 'not_configured', 'no_catalog_id', 'failed']);
export type CatalogReach = z.infer<typeof catalogReachSchema>;

export const playNextResponseSchema = z.object({
  /** False while no game says anything about taste; the lists are then unranked. */
  profileReady: z.boolean(),
  backlog: z.array(recommendedGameSchema),
  /** Paused and dropped games worth going back to. */
  resume: z.array(recommendedGameSchema),
});
export type PlayNextResponse = z.infer<typeof playNextResponseSchema>;

const referenceGameSchema = z.object({ libraryEntryId: z.string(), title: z.string() });

export const similarGamesResponseSchema = z.object({
  game: referenceGameSchema,
  catalog: catalogReachSchema,
  items: z.array(recommendedGameSchema),
});
export type SimilarGamesResponse = z.infer<typeof similarGamesResponseSchema>;

export const similarCompletionResponseSchema = z.object({
  game: referenceGameSchema,
  /** Null when the reference game has no achievements stored yet. */
  shape: achievementShapeSchema.nullable(),
  catalog: catalogReachSchema,
  items: z.array(recommendedGameSchema),
});
export type SimilarCompletionResponse = z.infer<typeof similarCompletionResponseSchema>;

export const favoriteGenreResponseSchema = z.object({
  /** The genre shown; null when the library has no genre at all. */
  genre: z.string().nullable(),
  /** Genres to choose from, favourite first. */
  genres: z.array(z.string()),
  catalog: catalogReachSchema,
  inLibrary: z.array(recommendedGameSchema),
  discover: z.array(recommendedGameSchema),
});
export type FavoriteGenreResponse = z.infer<typeof favoriteGenreResponseSchema>;

// --- AI one-liners -----------------------------------------------------------

export const explainRecommendationsRequestSchema = z.object({
  list: recommendationListSchema,
  /** Reference game, for the two "similar" lists. */
  libraryEntryId: z.string().min(1).optional(),
  genre: z.string().trim().min(1).max(80).optional(),
  locale: recommendationLocaleSchema,
});
export type ExplainRecommendationsRequest = z.infer<typeof explainRecommendationsRequestSchema>;

export const explainRecommendationsResponseSchema = z.object({
  /** Recommendation key → the line written for it. */
  lines: z.record(z.string(), z.string()),
  cached: z.boolean(),
});
export type ExplainRecommendationsResponse = z.infer<typeof explainRecommendationsResponseSchema>;
