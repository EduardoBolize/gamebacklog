import { z } from 'zod';

/**
 * Raw IGDB responses, limited to the fields we request.
 * Field names follow https://api-docs.igdb.com (checked November 2026); note that
 * `external_games.category` is deprecated in favour of `external_game_source`.
 */

const named = z.object({ name: z.string() });

export const igdbTokenSchema = z.object({
  access_token: z.string().min(1),
  /** Seconds until the token expires. */
  expires_in: z.number().positive(),
});

export const igdbGameSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  alternative_names: z.array(named).optional(),
  summary: z.string().optional(),
  cover: z.object({ image_id: z.string() }).optional(),
  /** Unix timestamp in seconds. */
  first_release_date: z.number().optional(),
  platforms: z.array(named).optional(),
  genres: z.array(named).optional(),
  themes: z.array(named).optional(),
  keywords: z.array(named).optional(),
  franchise: named.optional(),
  franchises: z.array(named).optional(),
  collections: z.array(named).optional(),
  external_games: z
    .array(z.object({ uid: z.string().optional(), external_game_source: z.number().optional() }))
    .optional(),
  url: z.string().optional(),
});
export type IgdbGame = z.infer<typeof igdbGameSchema>;

export const igdbGameListSchema = z.array(igdbGameSchema);

export const igdbExternalGameListSchema = z.array(
  z.object({ uid: z.string(), game: z.number().int() }),
);

/** `similar_games` is a plain list of game IDs. */
export const igdbSimilarListSchema = z.array(
  z.object({ id: z.number().int(), similar_games: z.array(z.number().int()).optional() }),
);

export const igdbGenreListSchema = z.array(z.object({ id: z.number().int(), name: z.string() }));

/** `external_game_sources` ID for Steam (same value as the old `category` enum). */
export const IGDB_STEAM_SOURCE_ID = 1;

export const IGDB_GAME_FIELDS = [
  'name',
  'alternative_names.name',
  'summary',
  'cover.image_id',
  'first_release_date',
  'platforms.name',
  'genres.name',
  'themes.name',
  'keywords.name',
  'franchise.name',
  'franchises.name',
  'collections.name',
  'external_games.uid',
  'external_games.external_game_source',
  'url',
].join(',');
