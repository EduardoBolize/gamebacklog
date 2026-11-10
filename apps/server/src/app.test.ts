import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_SCHEMA_VERSION, healthResponseSchema } from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { openDatabase, type DatabaseHandle } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';

const apps: FastifyInstance[] = [];
const handles: DatabaseHandle[] = [];
const tempDirs: string[] = [];

async function createApp(webDistDir?: string) {
  const handle = openDatabase(':memory:');
  handles.push(handle);
  runMigrations(handle.db);
  const app = await buildApp({ db: handle.db, webDistDir });
  apps.push(app);
  return app;
}

function createWebDist(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-web-'));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Hello</title>');
  return dir;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const handle of handles.splice(0)) handle.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports the app and the data schema version read from the database', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      status: 'ok',
      app: 'GameBacklog',
      schemaVersion: DATA_SCHEMA_VERSION,
    });
  });
});

describe('unknown routes', () => {
  it('answers 404 JSON for unknown API routes', async () => {
    const app = await createApp(createWebDist());
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('answers 404 for pages when no web build is being served (dev)', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
  });
});

describe('serving the web build (production)', () => {
  it('serves index.html at the root', async () => {
    const app = await createApp(createWebDist());
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<title>Hello</title>');
  });

  it('falls back to index.html for client-side routes', async () => {
    const app = await createApp(createWebDist());
    const response = await app.inject({ method: 'GET', url: '/games/123' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Hello</title>');
  });

  it('fails fast with a clear message when the web build is missing', async () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    const missing = path.join(os.tmpdir(), 'gamebacklog-web-missing');
    await expect(buildApp({ db: handle.db, webDistDir: missing })).rejects.toThrow(/pnpm build/);
  });
});
