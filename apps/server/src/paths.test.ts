import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, assertOutsideRepo, isInside, resolveDataDir } from './paths.ts';

describe('resolveDataDir', () => {
  it('uses %APPDATA%/GameBacklog on Windows', () => {
    const dir = resolveDataDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' },
      homedir: 'C:\\Users\\ana',
    });
    expect(dir).toBe('C:\\Users\\ana\\AppData\\Roaming\\GameBacklog');
  });

  it('falls back to the home folder on Windows when APPDATA is missing', () => {
    const dir = resolveDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\ana' });
    expect(dir).toBe('C:\\Users\\ana\\AppData\\Roaming\\GameBacklog');
  });

  it('uses ~/Library/Application Support/GameBacklog on macOS', () => {
    const dir = resolveDataDir({ platform: 'darwin', env: {}, homedir: '/Users/ana' });
    expect(dir).toBe('/Users/ana/Library/Application Support/GameBacklog');
  });

  it('uses ~/.local/share/GameBacklog on Linux', () => {
    const dir = resolveDataDir({ platform: 'linux', env: {}, homedir: '/home/ana' });
    expect(dir).toBe('/home/ana/.local/share/GameBacklog');
  });

  it('honors XDG_DATA_HOME on Linux', () => {
    const dir = resolveDataDir({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/data/xdg' },
      homedir: '/home/ana',
    });
    expect(dir).toBe('/data/xdg/GameBacklog');
  });

  it('lets GAMEBACKLOG_DATA_DIR override the default', () => {
    const custom = path.resolve('some', 'custom', 'folder');
    const dir = resolveDataDir({
      platform: 'linux',
      env: { GAMEBACKLOG_DATA_DIR: custom },
      homedir: '/home/ana',
    });
    expect(dir).toBe(custom);
  });

  it('ignores a blank GAMEBACKLOG_DATA_DIR', () => {
    const dir = resolveDataDir({
      platform: 'linux',
      env: { GAMEBACKLOG_DATA_DIR: '   ' },
      homedir: '/home/ana',
    });
    expect(dir).toBe('/home/ana/.local/share/GameBacklog');
  });
});

describe('repository guard', () => {
  it('detects folders inside a parent', () => {
    const parent = path.resolve('parent');
    expect(isInside(parent, parent)).toBe(true);
    expect(isInside(parent, path.join(parent, 'child', 'data'))).toBe(true);
    expect(isInside(parent, path.resolve('parent-sibling'))).toBe(false);
    expect(isInside(parent, path.resolve('elsewhere'))).toBe(false);
  });

  it('refuses a data folder inside the repository', () => {
    expect(() => assertOutsideRepo(path.join(REPO_ROOT, 'data'))).toThrow(/inside the repository/);
  });

  it('accepts a data folder outside the repository', () => {
    expect(() =>
      assertOutsideRepo(path.resolve(REPO_ROOT, '..', 'gamebacklog-data')),
    ).not.toThrow();
  });
});
