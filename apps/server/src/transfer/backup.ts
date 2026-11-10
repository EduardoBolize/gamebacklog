import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BackupRunResponse, BackupSettings, BackupStatusResponse } from '@gamebacklog/shared';
import type { AppContext } from '../context.ts';
import { badRequest } from '../errors.ts';
import { SETTINGS, getSetting, setSetting } from '../settings/store.ts';
import { buildExport } from './export.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_PREFIX = 'gamebacklog-backup';
/** Only files with exactly this shape are ever pruned, so nothing else in the folder is touched. */
const BACKUP_FILE = /^gamebacklog-backup-\d{8}-\d{6}\.json$/;

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Writes a full export (without caches) into `folder` and returns the file path. */
export function writeExportFile(ctx: AppContext, folder: string, prefix: string): string {
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${prefix}-${timestamp(ctx.now())}.json`);
  const content = buildExport(ctx.db, { includeCaches: false, now: ctx.now() });
  writeFileSync(file, JSON.stringify(content));
  return file;
}

/** Safety copy taken before a "replace" import, kept inside the data folder. */
export function writeSafetyBackup(ctx: AppContext): string {
  return writeExportFile(ctx, path.join(ctx.dataDir, 'backups'), 'gamebacklog-before-import');
}

export function getBackupStatus(ctx: AppContext): BackupStatusResponse {
  return {
    enabled: getSetting(ctx.db, SETTINGS.backupEnabled),
    folder: getSetting(ctx.db, SETTINGS.backupFolder),
    keep: getSetting(ctx.db, SETTINGS.backupKeep),
    lastRunAt: getSetting(ctx.db, SETTINGS.backupLastRunAt),
    lastError: getSetting(ctx.db, SETTINGS.backupLastError),
  };
}

export function saveBackupSettings(ctx: AppContext, request: BackupSettings): BackupStatusResponse {
  const folder = request.folder?.trim() || null;
  if (request.enabled && !folder) {
    throw badRequest('backup_folder_required', 'Choose a folder for the backups');
  }
  if (folder) {
    if (!path.isAbsolute(folder)) {
      throw badRequest('backup_folder_not_absolute', 'Use the full path of the folder');
    }
    try {
      // Proves the folder can be created and written to before the setting is accepted.
      mkdirSync(folder, { recursive: true });
      const probe = path.join(folder, '.gamebacklog-write-test');
      writeFileSync(probe, '');
      unlinkSync(probe);
    } catch {
      throw badRequest('backup_folder_unusable', 'The folder cannot be created or written to');
    }
  }
  setSetting(ctx.db, SETTINGS.backupEnabled, request.enabled);
  setSetting(ctx.db, SETTINGS.backupFolder, folder);
  setSetting(ctx.db, SETTINGS.backupKeep, request.keep);
  return getBackupStatus(ctx);
}

/** Writes a backup now and deletes the oldest ones beyond the configured number to keep. */
export function runBackup(ctx: AppContext): BackupRunResponse {
  const folder = getSetting(ctx.db, SETTINGS.backupFolder);
  if (!folder) throw badRequest('backup_folder_required', 'Choose a folder for the backups');

  const file = writeExportFile(ctx, folder, BACKUP_PREFIX);
  const keep = getSetting(ctx.db, SETTINGS.backupKeep);
  // The timestamp in the name sorts chronologically.
  const old = readdirSync(folder)
    .filter((name) => BACKUP_FILE.test(name))
    .sort()
    .reverse()
    .slice(keep);
  for (const name of old) unlinkSync(path.join(folder, name));

  setSetting(ctx.db, SETTINGS.backupLastRunAt, ctx.now().toISOString());
  setSetting(ctx.db, SETTINGS.backupLastError, null);
  return { file, removed: old.length };
}

/** Runs the daily backup when it is enabled and a day has passed. Never throws. */
export function runBackupIfDue(ctx: AppContext): boolean {
  try {
    if (!getSetting(ctx.db, SETTINGS.backupEnabled)) return false;
    const lastRunAt = getSetting(ctx.db, SETTINGS.backupLastRunAt);
    if (lastRunAt && ctx.now().getTime() - new Date(lastRunAt).getTime() < DAY_MS) return false;
    runBackup(ctx);
    return true;
  } catch (error) {
    try {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'backup_failed';
      setSetting(ctx.db, SETTINGS.backupLastError, code);
    } catch {
      // The database itself is unavailable; there is nowhere to record the failure.
    }
    return false;
  }
}

/** Checks once at start-up and then every hour. The timer does not keep the process alive. */
export function startBackupSchedule(ctx: AppContext): () => void {
  runBackupIfDue(ctx);
  const timer = setInterval(() => runBackupIfDue(ctx), 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
