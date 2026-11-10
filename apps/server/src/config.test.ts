import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOST, DEFAULT_PORT, loadConfig } from './config.ts';
import { REPO_ROOT } from './paths.ts';

const outsideRepo = path.join(os.tmpdir(), 'gamebacklog-config-test');

describe('loadConfig', () => {
  it('uses local-only defaults', () => {
    const config = loadConfig({ GAMEBACKLOG_DATA_DIR: outsideRepo }, []);
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.dataDir).toBe(outsideRepo);
    expect(config.production).toBe(false);
  });

  it('treats blank variables as unset', () => {
    const config = loadConfig(
      { GAMEBACKLOG_DATA_DIR: outsideRepo, GAMEBACKLOG_HOST: '', GAMEBACKLOG_PORT: ' ' },
      [],
    );
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_PORT);
  });

  it('reads host and port from the environment', () => {
    const config = loadConfig(
      {
        GAMEBACKLOG_DATA_DIR: outsideRepo,
        GAMEBACKLOG_HOST: 'localhost',
        GAMEBACKLOG_PORT: '4000',
      },
      [],
    );
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(4000);
  });

  it('rejects an invalid port', () => {
    expect(() =>
      loadConfig({ GAMEBACKLOG_DATA_DIR: outsideRepo, GAMEBACKLOG_PORT: 'abc' }, []),
    ).toThrow();
    expect(() =>
      loadConfig({ GAMEBACKLOG_DATA_DIR: outsideRepo, GAMEBACKLOG_PORT: '70000' }, []),
    ).toThrow();
  });

  it('enables production with the --production flag or NODE_ENV', () => {
    expect(loadConfig({ GAMEBACKLOG_DATA_DIR: outsideRepo }, ['--production']).production).toBe(
      true,
    );
    expect(
      loadConfig({ GAMEBACKLOG_DATA_DIR: outsideRepo, NODE_ENV: 'production' }, []).production,
    ).toBe(true);
  });

  it('refuses a data folder inside the repository', () => {
    expect(() => loadConfig({ GAMEBACKLOG_DATA_DIR: path.join(REPO_ROOT, 'data') }, [])).toThrow(
      /inside the repository/,
    );
  });
});
