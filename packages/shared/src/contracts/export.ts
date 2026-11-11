import { z } from 'zod';
import { APP_NAME } from '../constants.ts';
import {
  achievementOriginSchema,
  achievementProgressOriginSchema,
  checkpointResolutionSchema,
  classificationOriginSchema,
  contentOriginSchema,
  dataOriginSchema,
  externalIdSourceSchema,
  gameTimeOriginSchema,
  hintKindSchema,
  libraryStatusSchema,
  matchMethodSchema,
  playthroughGoalSchema,
  playthroughStatusSchema,
  playthroughTypeSchema,
  sessionOriginSchema,
  sourceIdSchema,
} from '../enums.ts';
import { provenanceSchema } from '../provenance.ts';
import { isoDateTimeSchema } from './common.ts';

/**
 * Format of the JSON export, version 2 (version 1 plus `checkpoints.bossName`).
 *
 * One array per table, rows exactly as stored, with instants as ISO strings. Objects are strict
 * on purpose: a column added to the database without updating this file fails the round-trip
 * test instead of being silently dropped from exports.
 *
 * Secrets are never part of an export: they live in the OS keychain, not in any table.
 */

const instant = isoDateTimeSchema;
const optionalInstant = isoDateTimeSchema.nullable();
const text = z.string();
const optionalText = z.string().nullable();
const optionalInt = z.number().int().nullable();
const optionalNumber = z.number().nullable();
const strings = z.array(z.string());
const stamps = { createdAt: instant, updatedAt: instant };

export const exportTablesSchema = z.strictObject({
  games: z.array(
    z.strictObject({
      id: text,
      title: text,
      alternativeTitles: strings,
      summary: optionalText,
      coverUrl: optionalText,
      releaseDate: optionalText,
      releaseYear: optionalInt,
      platforms: strings,
      genres: strings,
      themes: strings,
      tags: strings,
      franchise: optionalText,
      origin: dataOriginSchema,
      originUrl: optionalText,
      fetchedAt: optionalInstant,
      ...stamps,
    }),
  ),
  gameExternalIds: z.array(
    z.strictObject({
      gameId: text,
      source: externalIdSourceSchema,
      externalId: text,
      url: optionalText,
      matchedBy: matchMethodSchema,
      createdAt: instant,
    }),
  ),
  gameTimes: z.array(
    z.strictObject({
      id: text,
      gameId: text,
      origin: gameTimeOriginSchema,
      mainMinutes: optionalInt,
      mainExtraMinutes: optionalInt,
      completionistMinutes: optionalInt,
      originUrl: optionalText,
      fetchedAt: optionalInstant,
      ...stamps,
    }),
  ),
  chapterMaps: z.array(
    z.strictObject({
      id: text,
      gameId: text,
      origin: contentOriginSchema,
      sources: z.array(provenanceSchema),
      promptVersion: optionalText,
      isUserEdited: z.boolean(),
      generatedAt: optionalInstant,
      ...stamps,
    }),
  ),
  checkpoints: z.array(
    z.strictObject({
      id: text,
      chapterMapId: text,
      position: z.number().int(),
      name: text,
      aliases: strings,
      isPointOfNoReturn: z.boolean(),
      bossName: optionalText,
      origin: contentOriginSchema,
      ...stamps,
    }),
  ),
  libraryEntries: z.array(
    z.strictObject({
      id: text,
      gameId: text,
      status: libraryStatusSchema,
      platform: optionalText,
      isFavorite: z.boolean(),
      tags: strings,
      ...stamps,
    }),
  ),
  playthroughs: z.array(
    z.strictObject({
      id: text,
      libraryEntryId: text,
      number: z.number().int(),
      type: playthroughTypeSchema,
      label: optionalText,
      goal: playthroughGoalSchema,
      status: playthroughStatusSchema,
      platform: optionalText,
      startedOn: optionalText,
      finishedOn: optionalText,
      playtimeMinutes: optionalInt,
      currentCheckpointId: optionalText,
      ...stamps,
    }),
  ),
  sessions: z.array(
    z.strictObject({
      id: text,
      libraryEntryId: text,
      playthroughId: optionalText,
      startedAt: instant,
      durationMinutes: z.number().int(),
      note: optionalText,
      origin: sessionOriginSchema,
      ...stamps,
    }),
  ),
  reviews: z.array(
    z.strictObject({
      id: text,
      libraryEntryId: text,
      playthroughId: optionalText,
      score: optionalNumber,
      difficultyScore: optionalNumber,
      storyScore: optionalNumber,
      gameplayScore: optionalNumber,
      levelDesignScore: optionalNumber,
      soundtrackScore: optionalNumber,
      visualsScore: optionalNumber,
      perceivedLengthScore: optionalNumber,
      body: optionalText,
      pros: strings,
      cons: strings,
      hasSpoilers: z.boolean(),
      timeToBeatMinutes: optionalInt,
      reviewedAt: instant,
      ...stamps,
    }),
  ),
  progressEvents: z.array(
    z.strictObject({
      id: text,
      playthroughId: text,
      rawText: optionalText,
      checkpointId: optionalText,
      resolvedBy: checkpointResolutionSchema.nullable(),
      occurredAt: instant,
      createdAt: instant,
    }),
  ),
  collectibles: z.array(
    z.strictObject({
      id: text,
      gameId: text,
      checkpointId: optionalText,
      name: text,
      description: optionalText,
      category: optionalText,
      isMissable: z.boolean(),
      sortOrder: z.number().int(),
      origin: contentOriginSchema,
      originUrl: optionalText,
      fetchedAt: optionalInstant,
      ...stamps,
    }),
  ),
  collectibleProgress: z.array(
    z.strictObject({
      playthroughId: text,
      collectibleId: text,
      isCollected: z.boolean(),
      collectedAt: optionalInstant,
      updatedAt: instant,
    }),
  ),
  achievements: z.array(
    z.strictObject({
      id: text,
      gameId: text,
      origin: achievementOriginSchema,
      externalId: optionalText,
      name: text,
      description: optionalText,
      iconUrl: optionalText,
      globalPercent: optionalNumber,
      isHidden: z.boolean(),
      isMissable: z.boolean(),
      isStory: z.boolean(),
      isNgPlus: z.boolean(),
      classifiedBy: classificationOriginSchema.nullable(),
      checkpointId: optionalText,
      sortOrder: z.number().int(),
      originUrl: optionalText,
      fetchedAt: optionalInstant,
      ...stamps,
    }),
  ),
  achievementProgress: z.array(
    z.strictObject({
      playthroughId: text,
      achievementId: text,
      isUnlocked: z.boolean(),
      unlockedAt: optionalInstant,
      origin: achievementProgressOriginSchema,
      updatedAt: instant,
    }),
  ),
  settings: z.array(z.strictObject({ key: text, value: z.unknown(), updatedAt: instant })),
});
export type ExportTables = z.infer<typeof exportTablesSchema>;
export type ExportTableName = keyof ExportTables;

/** Regenerable data. Only present when the user ticks "include caches". */
export const exportCachesSchema = z.strictObject({
  sourceCache: z.array(
    z.strictObject({
      source: sourceIdSchema,
      cacheKey: text,
      url: optionalText,
      payload: z.unknown(),
      version: z.number().int(),
      fetchedAt: instant,
      expiresAt: optionalInstant,
    }),
  ),
  aiCache: z.array(
    z.strictObject({
      cacheKey: text,
      feature: text,
      gameId: optionalText,
      promptVersion: text,
      providerId: optionalText,
      model: optionalText,
      response: z.unknown(),
      createdAt: instant,
      expiresAt: optionalInstant,
    }),
  ),
  hintsCache: z.array(
    z.strictObject({
      id: text,
      cacheKey: text,
      gameId: text,
      checkpointId: optionalText,
      kind: hintKindSchema,
      level: z.number().int(),
      stuckOn: optionalText,
      content: z.unknown(),
      sources: z.array(provenanceSchema),
      promptVersion: text,
      providerId: optionalText,
      model: optionalText,
      createdAt: instant,
      expiresAt: optionalInstant,
    }),
  ),
  aiUsageLog: z.array(
    z.strictObject({
      id: text,
      feature: text,
      providerId: optionalText,
      model: optionalText,
      gameId: optionalText,
      inputTokensEstimated: z.number().int(),
      outputTokensEstimated: z.number().int(),
      durationMs: z.number().int(),
      cacheHit: z.boolean(),
      success: z.boolean(),
      errorCode: optionalText,
      createdAt: instant,
    }),
  ),
});
export type ExportCaches = z.infer<typeof exportCachesSchema>;
export type ExportCacheName = keyof ExportCaches;

export const exportFileSchema = z.strictObject({
  app: z.literal(APP_NAME),
  schemaVersion: z.literal(3),
  appVersion: z.string(),
  exportedAt: instant,
  data: exportTablesSchema,
  caches: exportCachesSchema.optional(),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

/** The minimum needed to recognise a file and decide how to migrate it. */
export const exportEnvelopeSchema = z.looseObject({
  app: z.literal(APP_NAME),
  schemaVersion: z.number().int().positive(),
});

// --- Import ----------------------------------------------------------------------

export const IMPORT_MODES = ['merge', 'replace'] as const;
export const importModeSchema = z.enum(IMPORT_MODES);
export type ImportMode = z.infer<typeof importModeSchema>;

export const importRequestSchema = z.object({
  mode: importModeSchema,
  /** The export file, already parsed from JSON. Validated and migrated by the server. */
  file: z.unknown(),
});

const changeCountsSchema = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  removed: z.number().int(),
});
export type ImportChangeCounts = z.infer<typeof changeCountsSchema>;

export const importPreviewResponseSchema = z.object({
  mode: importModeSchema,
  fileSchemaVersion: z.number().int(),
  exportedAt: instant,
  includesCaches: z.boolean(),
  /** Change counts for the games in the library, the number users care about. */
  library: changeCountsSchema,
  /** Change counts per table, for the detailed view. */
  tables: z.record(z.string(), changeCountsSchema),
  /** Titles of the games that would be added or updated, capped. */
  addedTitles: z.array(z.string()),
  updatedTitles: z.array(z.string()),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const importResultResponseSchema = importPreviewResponseSchema.extend({
  /** Safety copy written before a replace. Null for merges. */
  backupFile: z.string().nullable(),
});
export type ImportResultResponse = z.infer<typeof importResultResponseSchema>;

// --- Automatic backup ----------------------------------------------------------------

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  folder: z.string().trim().max(500).nullable(),
  keep: z.number().int().min(1).max(365),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export const backupStatusResponseSchema = backupSettingsSchema.extend({
  lastRunAt: isoDateTimeSchema.nullable(),
  /** Machine-readable reason the last automatic run failed, if it did. */
  lastError: z.string().nullable(),
});
export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>;

export const backupRunResponseSchema = z.object({ file: z.string(), removed: z.number().int() });
export type BackupRunResponse = z.infer<typeof backupRunResponseSchema>;
