import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT, assertOutsideRepo, resolveDataDir } from './paths.ts';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3777;

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const envSchema = z.object({
  GAMEBACKLOG_HOST: z.preprocess(emptyToUndefined, z.string().default(DEFAULT_HOST)),
  GAMEBACKLOG_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  ),
});

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  /** Production serves the built web app from `webDistDir`; dev leaves that to Vite. */
  production: boolean;
  webDistDir: string;
}

/** Loads the optional `.env` at the repo root. Variables already set in the environment win. */
export function loadEnvFile(repoRoot: string = REPO_ROOT): void {
  const envFile = path.join(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv,
): AppConfig {
  const parsed = envSchema.parse(env);
  const dataDir = resolveDataDir({ env });
  assertOutsideRepo(dataDir);

  return {
    host: parsed.GAMEBACKLOG_HOST,
    port: parsed.GAMEBACKLOG_PORT,
    dataDir,
    production: argv.includes('--production') || env.NODE_ENV === 'production',
    webDistDir: path.join(REPO_ROOT, 'apps', 'web', 'dist'),
  };
}
