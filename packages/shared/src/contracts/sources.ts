import { z } from 'zod';
import { libraryStatusSchema } from '../enums.ts';
import { isoDateTimeSchema } from './common.ts';

// --- Source configuration ------------------------------------------------------

/** Sources the user can configure in Phase 1. RAWG and RetroAchievements are stored but unused. */
export const CONFIGURABLE_SOURCES = ['igdb', 'steam', 'hltb', 'rawg', 'retroachievements'] as const;
export const configurableSourceSchema = z.enum(CONFIGURABLE_SOURCES);
export type ConfigurableSource = z.infer<typeof configurableSourceSchema>;

export const sourceStatusSchema = z.object({
  id: configurableSourceSchema,
  /** Whether the credentials this source needs are stored. Always true for HLTB. */
  configured: z.boolean(),
  /** Whether the app may call this source at all. */
  enabled: z.boolean(),
  /** Non-secret detail, e.g. the SteamID. Never a key. */
  detail: z.string().nullable(),
});
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const sourceListResponseSchema = z.object({
  items: z.array(sourceStatusSchema),
  /** Where secrets are kept: the OS keychain, or a restricted file when no keychain exists. */
  secretStore: z.enum(['keychain', 'file']),
});
export type SourceListResponse = z.infer<typeof sourceListResponseSchema>;

const credential = z.string().trim().min(1).max(200);

export const saveSourceRequestSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('igdb'), clientId: credential, clientSecret: credential }),
  z.object({
    id: z.literal('steam'),
    apiKey: credential,
    steamId: z.string().regex(/^\d{17}$/, 'SteamID64 has 17 digits'),
  }),
  z.object({ id: z.literal('hltb'), enabled: z.boolean() }),
  z.object({ id: z.literal('rawg'), apiKey: credential }),
  z.object({ id: z.literal('retroachievements'), username: credential, apiKey: credential }),
]);
export type SaveSourceRequest = z.infer<typeof saveSourceRequestSchema>;

export const SOURCE_TEST_CODES = [
  'ok',
  'not_configured',
  'invalid_credentials',
  /** Steam answered, but the profile's game details are not public. */
  'profile_private',
  'rate_limited',
  'unreachable',
  'error',
] as const;

export const sourceTestResponseSchema = z.object({
  ok: z.boolean(),
  code: z.enum(SOURCE_TEST_CODES),
});
export type SourceTestResponse = z.infer<typeof sourceTestResponseSchema>;

// --- Steam import ----------------------------------------------------------------

export const steamImportItemSchema = z.object({
  appId: z.string(),
  name: z.string(),
  playtimeMinutes: z.number().int(),
  playedRecently: z.boolean(),
  /** Catalog game matched through the Steam ID that IGDB knows. Null when not identified. */
  match: z
    .object({
      externalId: z.string(),
      title: z.string(),
      releaseYear: z.number().int().nullable(),
      coverUrl: z.string().nullable(),
    })
    .nullable(),
  /** Set when the game is already in the library; importing only refreshes its hours. */
  libraryEntryId: z.string().nullable(),
  suggestedStatus: libraryStatusSchema,
});
export type SteamImportItem = z.infer<typeof steamImportItemSchema>;

export const steamImportPreviewResponseSchema = z.object({
  items: z.array(steamImportItemSchema),
  /** False when IGDB is not configured, so no game could be matched to the catalog. */
  catalogAvailable: z.boolean(),
});
export type SteamImportPreviewResponse = z.infer<typeof steamImportPreviewResponseSchema>;

export const steamImportRequestSchema = z.object({
  items: z
    .array(z.object({ appId: z.string().regex(/^\d+$/), status: libraryStatusSchema }))
    .min(1)
    .max(5000),
});
export type SteamImportRequest = z.infer<typeof steamImportRequestSchema>;

export const steamImportResponseSchema = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});
export type SteamImportResponse = z.infer<typeof steamImportResponseSchema>;

export const steamSyncResponseSchema = z.object({
  /** Games whose playtime grew since the last sync; each got an automatic session. */
  sessionsCreated: z.number().int(),
  syncedAt: isoDateTimeSchema,
});
export type SteamSyncResponse = z.infer<typeof steamSyncResponseSchema>;

// --- App state -------------------------------------------------------------------

export const appStateResponseSchema = z.object({
  /** True once the first-run setup was finished or skipped. */
  setupCompleted: z.boolean(),
  dataDir: z.string(),
  steamLastSyncAt: isoDateTimeSchema.nullable(),
});
export type AppStateResponse = z.infer<typeof appStateResponseSchema>;
