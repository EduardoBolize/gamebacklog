import { z } from 'zod';

/**
 * Raw Steam Web API responses (https://partner.steamgames.com/doc/webapi and
 * https://developer.valvesoftware.com/wiki/Steam_Web_API, checked November 2026).
 *
 * The official pages document the arguments and the result fields but not the JSON envelope,
 * so these schemas are deliberately tolerant: everything that may be absent is optional.
 */

export const steamOwnedGamesSchema = z.object({
  response: z.object({
    game_count: z.number().optional(),
    /** Absent when the profile's game details are not public. */
    games: z
      .array(
        z.object({
          appid: z.number().int(),
          name: z.string().optional(),
          /** Minutes on record. */
          playtime_forever: z.number().optional(),
          /** Minutes in the last two weeks. Absent when zero. */
          playtime_2weeks: z.number().optional(),
        }),
      )
      .optional(),
  }),
});

export const steamSchemaForGameSchema = z.object({
  game: z.object({
    availableGameStats: z
      .object({
        achievements: z
          .array(
            z.object({
              name: z.string(),
              displayName: z.string().optional(),
              description: z.string().optional(),
              hidden: z.coerce.number().optional(),
              icon: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
});

export const steamGlobalPercentagesSchema = z.object({
  achievementpercentages: z.object({
    achievements: z.array(
      // `percent` has been observed both as a number and as a numeric string.
      z.object({ name: z.string(), percent: z.coerce.number() }),
    ),
  }),
});

export const steamPlayerAchievementsSchema = z.object({
  playerstats: z.object({
    success: z.boolean().optional(),
    error: z.string().optional(),
    achievements: z
      .array(
        z.object({
          apiname: z.string(),
          achieved: z.coerce.number(),
          /** Unix timestamp in seconds; 0 when locked. */
          unlocktime: z.number().optional(),
        }),
      )
      .optional(),
  }),
});
