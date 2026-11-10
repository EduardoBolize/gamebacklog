import os from 'node:os';
import path from 'node:path';
import { APP_NAME } from '@gamebacklog/shared';

/** Repository root when running from source (`apps/server/src` → three levels up). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export const DATABASE_FILE_NAME = 'gamebacklog.sqlite';

export interface DataDirOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homedir?: string;
}

/**
 * Folder that holds the user's database, backups and config.
 *
 * `GAMEBACKLOG_DATA_DIR` overrides it. Otherwise it is the OS data folder:
 * - Windows: `%APPDATA%/GameBacklog`
 * - macOS:   `~/Library/Application Support/GameBacklog`
 * - Linux:   `$XDG_DATA_HOME/GameBacklog`, falling back to `~/.local/share/GameBacklog`
 */
export function resolveDataDir(options: DataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homedir ?? os.homedir();

  const override = env.GAMEBACKLOG_DATA_DIR?.trim();
  if (override) return path.resolve(override);

  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(appData, APP_NAME);
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', APP_NAME);
  }
  const xdgDataHome = env.XDG_DATA_HOME?.trim() || path.posix.join(home, '.local', 'share');
  return path.posix.join(xdgDataHome, APP_NAME);
}

/** True when `target` is `parent` itself or lives somewhere below it. */
export function isInside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** User data must never live in the repository, where it could end up committed. */
export function assertOutsideRepo(dataDir: string, repoRoot: string = REPO_ROOT): void {
  if (isInside(repoRoot, dataDir)) {
    throw new Error(
      `The data folder (${dataDir}) is inside the repository. ` +
        'Point GAMEBACKLOG_DATA_DIR to a folder outside of it.',
    );
  }
}
