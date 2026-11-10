import { eq } from 'drizzle-orm';
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
} as const;

/** Settings that describe this machine, so a merge import must not carry them over. */
export const MACHINE_SETTING_PREFIXES = ['backup.', 'steam.playtime', 'steam.last_sync_at'];

type SettingDefinition<T> = { key: string; schema: z.ZodType<T>; fallback: T };

export function getSetting<T>(db: AppDatabase, definition: SettingDefinition<T>): T {
  const row = db.select().from(settings).where(eq(settings.key, definition.key)).get();
  if (!row) return definition.fallback;
  const parsed = definition.schema.safeParse(row.value);
  return parsed.success ? parsed.data : definition.fallback;
}

export function setSetting<T>(db: AppDatabase, definition: SettingDefinition<T>, value: T): void {
  const parsed = definition.schema.parse(value);
  db.insert(settings)
    .values({ key: definition.key, value: parsed })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedAt: new Date() } })
    .run();
}
