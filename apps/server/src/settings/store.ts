import { eq } from 'drizzle-orm';
import { aiProviderIdSchema, webSearchProviderSchema } from '@gamebacklog/shared';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.ts';
import { settings } from '../db/schema/index.ts';

/**
 * Typed registry of everything kept in the `settings` table.
 * Secrets never go here — see `secrets/store.ts`.
 */
export const SETTINGS = {
  setupCompleted: { key: 'setup.completed', schema: z.boolean(), fallback: false },
  steamId: { key: 'steam.steam_id', schema: z.string().nullable(), fallback: null },
  steamLastSyncAt: { key: 'steam.last_sync_at', schema: z.string().nullable(), fallback: null },
  /** Steam app ID → minutes on record at the last sync. Deltas become automatic sessions. */
  steamPlaytime: {
    key: 'steam.playtime',
    schema: z.record(z.string(), z.number()),
    fallback: {} as Record<string, number>,
  },
  hltbEnabled: { key: 'hltb.enabled', schema: z.boolean(), fallback: true },
  backupEnabled: { key: 'backup.enabled', schema: z.boolean(), fallback: false },
  backupFolder: { key: 'backup.folder', schema: z.string().nullable(), fallback: null },
  backupKeep: { key: 'backup.keep', schema: z.number().int().min(1).max(365), fallback: 7 },
  backupLastRunAt: { key: 'backup.last_run_at', schema: z.string().nullable(), fallback: null },
  backupLastError: { key: 'backup.last_error', schema: z.string().nullable(), fallback: null },
  aiProvider: { key: 'ai.provider', schema: aiProviderIdSchema.nullable(), fallback: null },
  /** Provider ID → model chosen by the user. */
  aiModels: {
    key: 'ai.models',
    schema: z.record(z.string(), z.string()),
    fallback: {} as Record<string, string>,
  },
  /** Provider ID → base URL, for local servers. */
  aiBaseUrls: {
    key: 'ai.base_urls',
    schema: z.record(z.string(), z.string()),
    fallback: {} as Record<string, string>,
  },
  /** Upper bound of context sent with each request, in estimated tokens. */
  aiContextBudget: {
    key: 'ai.context_budget_tokens',
    schema: z.number().int().min(500).max(100_000),
    fallback: 6000,
  },
  aiTimeoutMs: {
    key: 'ai.timeout_ms',
    schema: z.number().int().min(5000).max(900_000),
    fallback: 180_000,
  },
  webSearchProvider: {
    key: 'search.provider',
    schema: webSearchProviderSchema.nullable(),
    fallback: null,
  },
  searxngUrl: { key: 'search.searxng_url', schema: z.string().nullable(), fallback: null },
  /** Game ID → base URL of the wiki to read for that game. `null` records "none found". */
  gameWikis: {
    key: 'wiki.by_game',
    schema: z.record(z.string(), z.string().nullable()),
    fallback: {} as Record<string, string | null>,
  },
  /** Days without activity before a run shows the "where I left off" recap. */
  recapAfterDays: {
    key: 'recap.after_days',
    schema: z.number().int().min(1).max(365),
    fallback: 14,
  },
} as const;

/** Settings that describe this machine, so a merge import must not carry them over. */
export const MACHINE_SETTING_PREFIXES = [
  'backup.',
  'steam.playtime',
  'steam.last_sync_at',
  // Which AI is connected, and where the local servers are, belongs to each machine.
  'ai.',
  'search.',
];

type SettingDefinition<T> = { key: string; schema: z.ZodType<T>; fallback: T };

export function getSetting<T>(db: AppDatabase, definition: SettingDefinition<T>): T {
  const row = db.select().from(settings).where(eq(settings.key, definition.key)).get();
  if (!row) return definition.fallback;
  const parsed = definition.schema.safeParse(row.value);
  return parsed.success ? parsed.data : definition.fallback;
}

export function setSetting<T>(db: AppDatabase, definition: SettingDefinition<T>, value: T): void {
  const parsed = definition.schema.parse(value);
  if (parsed === null) {
    // "No value" is the absence of the row, so reads fall back to the default.
    db.delete(settings).where(eq(settings.key, definition.key)).run();
    return;
  }
  db.insert(settings)
    .values({ key: definition.key, value: parsed })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedAt: new Date() } })
    .run();
}
