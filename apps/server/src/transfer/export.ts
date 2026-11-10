import {
  APP_NAME,
  DATA_SCHEMA_VERSION,
  exportEnvelopeSchema,
  exportFileSchema,
  type ExportFile,
} from '@gamebacklog/shared';
import packageJson from '../../package.json' with { type: 'json' };
import type { AppDatabase } from '../db/client.ts';
import { badRequest } from '../errors.ts';
import {
  CACHE_TABLES,
  DATA_TABLES,
  pkOf,
  serializeRow,
  type ExportRow,
  type TableSpec,
} from './tables.ts';

export const APP_VERSION = packageJson.version;

/**
 * Secrets are never written to the settings table, so this never matches anything real.
 * It is a last line of defence: a key that looks like a credential is left out of every export.
 */
const SECRET_LIKE_KEY = /secret|token|password|api[_.-]?key/i;

/** All rows of a table as export rows, in a stable order so two exports of the same data match. */
export function readTable(db: AppDatabase, spec: TableSpec): ExportRow[] {
  const rows = db.select().from(spec.table).all() as Record<string, unknown>[];
  return rows
    .map(serializeRow)
    .filter((row) => spec.name !== 'settings' || !SECRET_LIKE_KEY.test(String(row.key)))
    .sort((a, b) => pkOf(spec, a).localeCompare(pkOf(spec, b)));
}

export function buildExport(
  db: AppDatabase,
  options: { includeCaches: boolean; now: Date },
): ExportFile {
  const data = Object.fromEntries(DATA_TABLES.map((spec) => [spec.name, readTable(db, spec)]));
  const caches = options.includeCaches
    ? Object.fromEntries(CACHE_TABLES.map((spec) => [spec.name, readTable(db, spec)]))
    : undefined;

  // Parsing our own output guarantees the file can be imported back: if the database gains a
  // column the export format does not know, this fails here instead of at restore time.
  return exportFileSchema.parse({
    app: APP_NAME,
    schemaVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: options.now.toISOString(),
    data,
    ...(caches ? { caches } : {}),
  });
}

/**
 * Upgrades from each older format to the next one. Version 1 is the first format, so the list
 * is empty; when version 2 arrives, add `1: (file) => ...` returning the version-2 shape.
 */
export type ExportMigration = (file: Record<string, unknown>) => Record<string, unknown>;
export const EXPORT_MIGRATIONS: Record<number, ExportMigration> = {};

/** Brings a file of any known version up to the current format. */
export function migrateExport(
  raw: unknown,
  migrations: Record<number, ExportMigration> = EXPORT_MIGRATIONS,
  currentVersion: number = DATA_SCHEMA_VERSION,
): Record<string, unknown> {
  const envelope = exportEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw badRequest('not_an_export', 'This file is not a GameBacklog export');
  }
  let file: Record<string, unknown> = envelope.data;
  let version = envelope.data.schemaVersion;
  if (version > currentVersion) {
    throw badRequest(
      'export_too_new',
      'This file was created by a newer version of GameBacklog. Update the app to import it.',
    );
  }
  while (version < currentVersion) {
    const migrate = migrations[version];
    if (!migrate)
      throw badRequest('export_unsupported', `Cannot upgrade a version ${version} file`);
    file = { ...migrate(file), schemaVersion: version + 1 };
    version++;
  }
  return file;
}

/** Validates an uploaded file, upgrading older formats first. */
export function parseExportFile(raw: unknown): { file: ExportFile; originalVersion: number } {
  const originalVersion = exportEnvelopeSchema.safeParse(raw).data?.schemaVersion ?? 0;
  const parsed = exportFileSchema.safeParse(migrateExport(raw));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(
      'invalid_export',
      `The export file is damaged or was edited: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    );
  }
  return { file: parsed.data, originalVersion };
}
