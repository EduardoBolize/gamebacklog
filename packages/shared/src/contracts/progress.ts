import { z } from 'zod';
import {
  achievementOriginSchema,
  achievementSyncSourceSchema,
  classificationOriginSchema,
} from '../enums.ts';
import { isoDateTimeSchema } from './common.ts';

// --- "Where am I?" -----------------------------------------------------------

export const progressEventSchema = z.object({
  id: z.string(),
  rawText: z.string().nullable(),
  /** Checkpoint the text was resolved to, when it was. */
  checkpointName: z.string().nullable(),
  occurredAt: isoDateTimeSchema,
});
export type ProgressEvent = z.infer<typeof progressEventSchema>;

export const progressListResponseSchema = z.object({ items: z.array(progressEventSchema) });
export type ProgressListResponse = z.infer<typeof progressListResponseSchema>;

export const createProgressRequestSchema = z.object({
  rawText: z.string().trim().min(1).max(500),
});
export type CreateProgressRequest = z.infer<typeof createProgressRequestSchema>;

// --- Achievements ------------------------------------------------------------

export const achievementSchema = z.object({
  id: z.string(),
  origin: achievementOriginSchema,
  name: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
  globalPercent: z.number().nullable(),
  isHidden: z.boolean(),
  isMissable: z.boolean(),
  isStory: z.boolean(),
  isNgPlus: z.boolean(),
  classifiedBy: classificationOriginSchema.nullable(),
  /** Unlock state in the playthrough the list was requested for. */
  isUnlocked: z.boolean(),
  unlockedAt: isoDateTimeSchema.nullable(),
});
export type Achievement = z.infer<typeof achievementSchema>;

export const achievementListResponseSchema = z.object({
  items: z.array(achievementSchema),
  /** Steam app linked to this game, when there is one. */
  steamAppId: z.string().nullable(),
  /** The account the list can be synced from (Steam, PSN, Xbox…), when the game has one. */
  syncSource: achievementSyncSourceSchema.nullable(),
  /** When the list was last fetched from that account. */
  syncedAt: isoDateTimeSchema.nullable(),
});
export type AchievementListResponse = z.infer<typeof achievementListResponseSchema>;

export const classifyAchievementRequestSchema = z
  .object({ isStory: z.boolean(), isMissable: z.boolean(), isNgPlus: z.boolean() })
  .partial();
export type ClassifyAchievementRequest = z.infer<typeof classifyAchievementRequestSchema>;

export const setAchievementUnlockedRequestSchema = z.object({ isUnlocked: z.boolean() });
export type SetAchievementUnlockedRequest = z.infer<typeof setAchievementUnlockedRequestSchema>;

/** The game's ID on RetroAchievements, or the address of its page there. */
export const linkRetroGameRequestSchema = z.object({ game: z.string().trim().min(1).max(200) });

export const linkRetroGameResponseSchema = z.object({
  gameId: z.string(),
  title: z.string(),
  consoleName: z.string().nullable(),
});
export type LinkRetroGameResponse = z.infer<typeof linkRetroGameResponseSchema>;

export const achievementSyncResponseSchema = z.object({
  total: z.number().int(),
  unlocked: z.number().int(),
  /** False when the catalog was fetched but the player's unlocks were not visible. */
  playerDataAvailable: z.boolean(),
});
export type AchievementSyncResponse = z.infer<typeof achievementSyncResponseSchema>;

// --- Abandonment funnel --------------------------------------------------------

export const FUNNEL_UNAVAILABLE_REASONS = [
  /** The game has no achievements with global percentages. */
  'no_achievements',
  /** No achievement is classified as story progress. */
  'no_story_achievements',
  /** The player has not unlocked any story milestone yet. */
  'no_position',
] as const;

export const funnelResponseSchema = z.object({
  available: z.boolean(),
  reason: z.enum(FUNNEL_UNAVAILABLE_REASONS).nullable(),
  /** Of the players who reached the current milestone, the share that finished. 0–100. */
  percentFinished: z.number().nullable(),
  /** Time left to reach the playthrough goal, from the time-to-beat figures. */
  remainingMinutes: z.number().int().nullable(),
  remainingBasis: z.enum(['main', 'completionist']).nullable(),
  currentMilestoneId: z.string().nullable(),
  finalMilestoneId: z.string().nullable(),
  /** Story achievements, most common first. */
  milestones: z.array(
    z.object({
      achievementId: z.string(),
      name: z.string(),
      globalPercent: z.number(),
      isUnlocked: z.boolean(),
    }),
  ),
});
export type FunnelResponse = z.infer<typeof funnelResponseSchema>;
