import { z } from 'zod';
import {
  aiCostHintSchema,
  aiHealthStatusSchema,
  aiProviderIdSchema,
  aiProviderKindSchema,
  contentOriginSchema,
  hintBasisSchema,
  hintKindSchema,
  hintLevelSchema,
  pathWarningKindSchema,
  webSearchProviderSchema,
} from '../enums.ts';
import { provenanceSchema } from '../provenance.ts';
import { isoDateTimeSchema } from './common.ts';

// --- Connecting an AI ----------------------------------------------------------

export const aiProviderStatusSchema = z.object({
  id: aiProviderIdSchema,
  displayName: z.string(),
  kind: aiProviderKindSchema,
  costHint: aiCostHintSchema,
  /** Result of the cheap check: CLI installed and logged in, key stored, local server up. */
  status: aiHealthStatusSchema,
  /** Model chosen for this provider. Empty for CLIs means "the CLI's own default". */
  model: z.string().nullable(),
  /** Base URL, for local servers. */
  baseUrl: z.string().nullable(),
  /** True when an API key is stored (API providers). Never the key itself. */
  hasKey: z.boolean(),
  /**
   * Name of the environment variable that makes this CLI bill the API instead of using the
   * subscription, when one is set. Null otherwise.
   */
  billingWarning: z.string().nullable(),
});
export type AiProviderStatus = z.infer<typeof aiProviderStatusSchema>;

export const aiOverviewResponseSchema = z.object({
  activeProviderId: aiProviderIdSchema.nullable(),
  /** Upper bound of context sent with each request, in estimated tokens. */
  contextBudgetTokens: z.number().int(),
  providers: z.array(aiProviderStatusSchema),
});
export type AiOverviewResponse = z.infer<typeof aiOverviewResponseSchema>;

const modelName = z
  .string()
  .trim()
  .max(120)
  .regex(/^[\w.:/@-]*$/, 'Letters, digits and . : / @ - _ only');

export const saveAiProviderRequestSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(400),
    model: modelName.nullable(),
    baseUrl: z.url().max(300).nullable(),
  })
  .partial();
export type SaveAiProviderRequest = z.infer<typeof saveAiProviderRequestSchema>;

export const saveAiSettingsRequestSchema = z
  .object({
    activeProviderId: aiProviderIdSchema.nullable(),
    contextBudgetTokens: z.number().int().min(500).max(100_000),
  })
  .partial();
export type SaveAiSettingsRequest = z.infer<typeof saveAiSettingsRequestSchema>;

export const aiTestResponseSchema = z.object({ ok: z.boolean(), status: aiHealthStatusSchema });
export type AiTestResponse = z.infer<typeof aiTestResponseSchema>;

export const aiModelsResponseSchema = z.object({ models: z.array(z.string()) });
export type AiModelsResponse = z.infer<typeof aiModelsResponseSchema>;

// --- AI usage --------------------------------------------------------------------

export const aiUsageEntrySchema = z.object({
  id: z.string(),
  createdAt: isoDateTimeSchema,
  feature: z.string(),
  providerId: z.string().nullable(),
  model: z.string().nullable(),
  gameTitle: z.string().nullable(),
  inputTokensEstimated: z.number().int(),
  outputTokensEstimated: z.number().int(),
  durationMs: z.number().int(),
  cacheHit: z.boolean(),
  success: z.boolean(),
  errorCode: z.string().nullable(),
});
export type AiUsageEntry = z.infer<typeof aiUsageEntrySchema>;

export const aiUsageResponseSchema = z.object({
  items: z.array(aiUsageEntrySchema),
  totals: z.object({
    requests: z.number().int(),
    cacheHits: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
  }),
});
export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;

// --- Web search and wiki configuration ---------------------------------------------

export const webSearchSettingsSchema = z.object({
  provider: webSearchProviderSchema.nullable(),
  /** Base URL of the user's SearXNG instance. */
  searxngUrl: z.url().max(300).nullable(),
  hasBraveKey: z.boolean(),
  hasTavilyKey: z.boolean(),
});
export type WebSearchSettings = z.infer<typeof webSearchSettingsSchema>;

export const saveWebSearchRequestSchema = z
  .object({
    provider: webSearchProviderSchema.nullable(),
    searxngUrl: z.url().max(300).nullable(),
    braveKey: z.string().trim().min(1).max(300),
    tavilyKey: z.string().trim().min(1).max(300),
  })
  .partial();
export type SaveWebSearchRequest = z.infer<typeof saveWebSearchRequestSchema>;

// --- Chapter map ---------------------------------------------------------------------

export const checkpointSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  name: z.string(),
  aliases: z.array(z.string()),
  isPointOfNoReturn: z.boolean(),
  bossName: z.string().nullable(),
  /** Checkpoints reachable from this one; empty means the next one by position. */
  leadsTo: z.array(z.string()),
  /** What opens the way here (an item, a key, an event), as the game names it. */
  requirement: z.string().nullable(),
  origin: contentOriginSchema,
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

export const chapterMapResponseSchema = z.object({
  /** Null when the game has no map yet. */
  map: z
    .object({
      id: z.string(),
      origin: contentOriginSchema,
      isUserEdited: z.boolean(),
      sources: z.array(provenanceSchema),
      checkpoints: z.array(checkpointSchema),
    })
    .nullable(),
  currentCheckpointId: z.string().nullable(),
  /** Checkpoints this run finished, in any order. */
  completedCheckpointIds: z.array(z.string()),
  /** Wiki the map and the hints read from, when one was found or set by the user. */
  wikiUrl: z.string().nullable(),
  /** True when an AI is connected, so a map can be generated. */
  aiConnected: z.boolean(),
});
export type ChapterMapResponse = z.infer<typeof chapterMapResponseSchema>;

export const saveCheckpointsRequestSchema = z.object({
  checkpoints: z
    .array(
      z.object({
        /** Omitted for a checkpoint the user is adding. */
        id: z.string().optional(),
        name: z.string().trim().min(1).max(120),
        aliases: z.array(z.string().trim().min(1).max(120)).max(20),
        isPointOfNoReturn: z.boolean(),
        bossName: z.string().trim().min(1).max(120).nullable(),
      }),
    )
    .max(200),
});
export type SaveCheckpointsRequest = z.infer<typeof saveCheckpointsRequestSchema>;

export const generateMapRequestSchema = z
  .object({
    force: z.boolean().optional(),
    /** Language of the aliases added to each place, so the player's own words match. */
    locale: z.enum(['pt-BR', 'en']).default('pt-BR'),
  })
  .default({ locale: 'pt-BR' });

/** Marks a checkpoint as finished or not, without moving the current position. */
export const setCheckpointDoneRequestSchema = z.object({ done: z.boolean() });

export const setWikiRequestSchema = z.object({ wikiUrl: z.url().max(300).nullable() });
export type SetWikiRequest = z.infer<typeof setWikiRequestSchema>;

// --- Smart "where am I?" ---------------------------------------------------------------

export const reportProgressRequestSchema = z.object({
  rawText: z.string().trim().min(1).max(500).optional(),
  /** Picked directly from the map instead of typed. */
  checkpointId: z.string().optional(),
  /** Set after the user read the point-of-no-return warning and chose to go on. */
  confirmPointOfNoReturn: z.boolean().optional(),
  /** Language of the interface, used if the chapter map has to be built first. */
  locale: z.enum(['pt-BR', 'en']).optional(),
});
export type ReportProgressRequest = z.infer<typeof reportProgressRequestSchema>;

const pendingItemSchema = z.object({ id: z.string(), name: z.string() });

export const reportProgressResponseSchema = z.object({
  /** False when the move was held back by a point-of-no-return warning. */
  saved: z.boolean(),
  checkpoint: checkpointSchema.nullable(),
  resolvedBy: z.enum(['manual', 'local_match', 'ai']).nullable(),
  /** Checkpoints the text said were finished ("I beat X and Y, now I'm at Z"). */
  completed: z.array(checkpointSchema),
  /**
   * Why the text could not be placed on the map, when it was not: there is no map (and none
   * could be built), or no place on it matched. The text is stored either way.
   */
  notPlaced: z.enum(['no_map', 'no_match']).nullable(),
  /** Error code of the AI when building the map or reading the text failed, e.g. `ai_usage_limit`. */
  aiError: z.string().nullable(),
  /** Present when `saved` is false: what would be left behind for good. */
  warning: z
    .object({
      pointOfNoReturn: checkpointSchema,
      missableAchievements: z.array(pendingItemSchema),
      missableCollectibles: z.array(pendingItemSchema),
    })
    .nullable(),
});
export type ReportProgressResponse = z.infer<typeof reportProgressResponseSchema>;

// --- Paths ahead --------------------------------------------------------------------------

export const pathWarningSchema = z.object({
  kind: pathWarningKindSchema,
  /** Achievement, item or character, as the game names it. */
  name: z.string(),
  detail: z.string(),
  /** The achievement in this app the warning is about, when it is one. */
  achievementId: z.string().nullable(),
});
export type PathWarning = z.infer<typeof pathWarningSchema>;

export const pathsResponseSchema = z.object({
  /** Where the run is; null until the player says where they are. */
  current: checkpointSchema.nullable(),
  /** Places reachable from there that are not finished yet. Costs no AI. */
  options: z.array(checkpointSchema),
  /** The AI's reading of those options, when it was asked for (or is in the cache). */
  analysis: z
    .object({
      beforeLeaving: z.array(pathWarningSchema),
      paths: z.array(
        z.object({
          checkpointId: z.string(),
          howToGetThere: z.string().nullable(),
          warnings: z.array(pathWarningSchema),
        }),
      ),
      sources: z.array(provenanceSchema),
      cached: z.boolean(),
    })
    .nullable(),
  aiConnected: z.boolean(),
});
export type PathsResponse = z.infer<typeof pathsResponseSchema>;

// --- Hints ----------------------------------------------------------------------------

export const hintRequestSchema = z.object({
  kind: hintKindSchema,
  level: hintLevelSchema,
  /** Optional "where I'm stuck". */
  stuckOn: z.string().trim().max(300).optional(),
  /** Language the hint is written in. */
  locale: z.enum(['pt-BR', 'en']).default('pt-BR'),
});
export type HintRequest = z.infer<typeof hintRequestSchema>;

/** Hints already revealed for the current checkpoint, so reopening the tab costs nothing. */
export const revealedHintsResponseSchema = z.object({
  checkpoint: z.string().nullable(),
  items: z.array(
    z.object({
      kind: hintKindSchema,
      level: hintLevelSchema,
      stuckOn: z.string().nullable(),
      text: z.string(),
      basis: hintBasisSchema,
      sources: z.array(provenanceSchema),
    }),
  ),
  aiConnected: z.boolean(),
});
export type RevealedHintsResponse = z.infer<typeof revealedHintsResponseSchema>;

export const hintResponseSchema = z.object({
  kind: hintKindSchema,
  level: hintLevelSchema,
  text: z.string(),
  basis: hintBasisSchema,
  sources: z.array(provenanceSchema),
  /** True when it came from the cache, so no tokens were spent. */
  cached: z.boolean(),
});
export type HintResponse = z.infer<typeof hintResponseSchema>;

// --- 100% mode ---------------------------------------------------------------------------

export const areaChecklistResponseSchema = z.object({
  checkpoint: checkpointSchema,
  collectibles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      category: z.string().nullable(),
      isMissable: z.boolean(),
      /** Achievement or trophy the item counts towards; null for "only for the 100%". */
      achievementName: z.string().nullable(),
      /** The app's own achievement row, when the game has achievement data. */
      achievementId: z.string().nullable(),
      isCollected: z.boolean(),
      origin: contentOriginSchema,
    }),
  ),
  /** Missable achievements tied to this checkpoint and not unlocked yet. */
  missableAchievements: z.array(pendingItemSchema.extend({ description: z.string().nullable() })),
  /** The next point of no return at or after this checkpoint, if any. */
  nextPointOfNoReturn: checkpointSchema.nullable(),
  sources: z.array(provenanceSchema),
  /**
   * False until the list for this area was generated in the language asked for. A list written
   * in another language can be rewritten; from the cache when it was asked for before.
   */
  generated: z.boolean(),
  cached: z.boolean(),
});
export type AreaChecklistResponse = z.infer<typeof areaChecklistResponseSchema>;

export const setCollectedRequestSchema = z.object({ isCollected: z.boolean() });

// --- Proactive questions and "where I left off" ------------------------------------------------

export const PROACTIVE_QUESTION_KINDS = ['boss_hint', 'collectibles', 'missables'] as const;

export const gameAssistResponseSchema = z.object({
  /** Suggestions derived from data already stored; none of them costs an AI call. */
  questions: z.array(
    z.object({
      kind: z.enum(PROACTIVE_QUESTION_KINDS),
      /** Boss name, or how many items are waiting. */
      subject: z.string().nullable(),
      count: z.number().int().nullable(),
    }),
  ),
  /** Shown when the run has been idle for a while. Null otherwise. */
  recap: z
    .object({
      daysIdle: z.number().int(),
      lastProgress: z
        .object({ rawText: z.string().nullable(), occurredAt: isoDateTimeSchema })
        .nullable(),
      currentCheckpoint: z.string().nullable(),
      /** May be a spoiler, so the interface keeps it blurred until asked. */
      nextCheckpoint: z.string().nullable(),
      lastNotes: z.array(z.object({ note: z.string(), startedAt: isoDateTimeSchema })),
    })
    .nullable(),
});
export type GameAssistResponse = z.infer<typeof gameAssistResponseSchema>;

// --- Maps and videos of an area -----------------------------------------------------------

export const areaMediaResponseSchema = z.object({
  /** Name of the area the media is about; null when the game has no chapter map. */
  checkpoint: z.string().nullable(),
  /** Whether the maps are of that area or, failing that, of the game as a whole. */
  mapsScope: z.enum(['area', 'game']).nullable(),
  maps: z.array(
    z.object({
      title: z.string(),
      /** Small version served by the wiki itself. */
      thumbUrl: z.string(),
      /** The file's page on the wiki, where the full map, its author and licence are. */
      pageUrl: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  ),
  /** The wiki the maps come from. */
  wiki: provenanceSchema.nullable(),
  /** Videos found by the web search, when one is configured. */
  videos: z.array(z.object({ title: z.string(), url: z.string() })),
  /** A ready-made video search for this area. Always there; costs no request. */
  videoSearchUrl: z.string(),
});
export type AreaMediaResponse = z.infer<typeof areaMediaResponseSchema>;

export const funnelEstimateRequestSchema = z.object({
  locale: z.enum(['pt-BR', 'en']).default('pt-BR'),
});

export const funnelEstimateResponseSchema = z.object({
  /** Always an estimate: there is no achievement data behind it. */
  percentFinished: z.number().min(0).max(100),
  rationale: z.string(),
  sources: z.array(provenanceSchema),
  cached: z.boolean(),
});
export type FunnelEstimateResponse = z.infer<typeof funnelEstimateResponseSchema>;
