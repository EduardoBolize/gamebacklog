import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_SCHEMA_VERSION, healthResponseSchema } from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { createTestApp, type TestApp } from './test/context.ts';

const testApps: TestApp[] = [];
const extraApps: FastifyInstance[] = [];
const tempDirs: string[] = [];

async function createApp(webDistDir?: string): Promise<FastifyInstance> {
  const test = await createTestApp();
  testApps.push(test);
  if (!webDistDir) return test.app;
  const app = await buildApp({ ctx: test.ctx, webDistDir });
  extraApps.push(app);
  return app;
}

function createWebDist(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-web-'));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Hello</title>');
  return dir;
}

afterEach(async () => {
  for (const app of extraApps.splice(0)) await app.close();
  for (const test of testApps.splice(0)) await test.close();
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

describe('error handling', () => {
  it('answers 400 with the invalid fields for a bad request body', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/library',
      payload: { status: 'nope' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('answers 400 for malformed JSON instead of 500', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(response.statusCode).toBe(400);
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
    const test = await createTestApp();
    testApps.push(test);
    const missing = path.join(os.tmpdir(), 'gamebacklog-web-missing');
    await expect(buildApp({ ctx: test.ctx, webDistDir: missing })).rejects.toThrow(/pnpm build/);
  });
});
