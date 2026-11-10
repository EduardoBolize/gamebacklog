import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3877;

// The config is loaded again in every worker process. Keeping the folder in an environment
// variable (inherited by the workers) guarantees a single throwaway data folder per run.
process.env.GAMEBACKLOG_E2E_DATA_DIR ??= mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-e2e-'));

/**
 * End-to-end tests run against the production build, with its own data folder and the file
 * secret store, so they never touch the real library or the OS keychain.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      GAMEBACKLOG_DATA_DIR: process.env.GAMEBACKLOG_E2E_DATA_DIR,
      GAMEBACKLOG_PORT: String(PORT),
      GAMEBACKLOG_SECRET_STORE: 'file',
    },
  },
});
