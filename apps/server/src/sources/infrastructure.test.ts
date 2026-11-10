import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseHandle } from '../db/client.ts';
import { FileSecretStore, MemorySecretStore } from '../secrets/store.ts';
import { createFakeFetch, createTestDatabase, whenUrl } from '../test/helpers.ts';
import { SourceCache } from './cache.ts';
import { requestJson } from './http.ts';
import { createRateLimiter } from './rate-limiter.ts';

describe('requestJson', () => {
  it('retries 5xx and 429 answers, then returns the last one', async () => {
    let calls = 0;
    const fetch = createFakeFetch(() => (++calls < 3 ? { status: 503 } : { json: { ok: true } }));
    const result = await requestJson('igdb', fetch, 'https://example.test/x', { retryDelayMs: 0 });
    expect(result).toEqual({ status: 200, json: { ok: true } });
    expect(calls).toBe(3);
  });

  it('does not retry client errors', async () => {
    const fetch = createFakeFetch(() => ({ status: 404 }));
    const result = await requestJson('igdb', fetch, 'https://example.test/x', { retryDelayMs: 0 });
    expect(result.status).toBe(404);
    expect(fetch.calls).toHaveLength(1);
  });

  it('throws "unreachable" on network failure, without the URL in the message', async () => {
    const failing = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
    const error = await requestJson('steam', failing, 'https://example.test/?key=SECRET', {
      retryDelayMs: 0,
    }).then(
      () => new Error('expected a failure'),
      (caught: unknown) => caught as Error,
    );
    expect(error).toMatchObject({ source: 'steam', code: 'unreachable' });
    expect(error.message).not.toContain('SECRET');
    expect(error.message).not.toContain('example.test');
  });

  it('tolerates empty and non-JSON bodies', async () => {
    const fetch = createFakeFetch(whenUrl('/empty', { status: 200 }));
    expect(await requestJson('igdb', fetch, 'https://example.test/empty')).toEqual({
      status: 200,
      json: undefined,
    });
  });
});

describe('createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spreads a burst so that no window exceeds the limit', async () => {
    const limiter = createRateLimiter({ maxRequests: 2, perMs: 1000 });
    const starts: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, index) =>
      limiter.schedule(() => {
        starts.push(Date.now());
        return Promise.resolve(index);
      }),
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4]);

    const first = starts[0] ?? 0;
    const offsets = starts.map((time) => time - first);
    expect(offsets[1]).toBeLessThan(1000);
    expect(offsets[2]).toBeGreaterThanOrEqual(1000);
    expect(offsets[4]).toBeGreaterThanOrEqual(2000);
  });

  it('keeps going after a task fails', async () => {
    const limiter = createRateLimiter({ maxRequests: 5, perMs: 1000 });
    const failed = limiter.schedule(() => Promise.reject(new Error('boom')));
    const next = limiter.schedule(() => Promise.resolve('ok'));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});

describe('SourceCache', () => {
  let handle: DatabaseHandle;
  let now: Date;

  beforeEach(() => {
    handle = createTestDatabase();
    now = new Date('2026-11-10T12:00:00.000Z');
  });
  afterEach(() => handle.close());

  const cache = () => new SourceCache(handle.db, () => now);

  it('returns a value until it expires', () => {
    cache().set('igdb', 'k', { a: 1 }, { ttlMs: 60_000 });
    expect(cache().get('igdb', 'k')?.data).toEqual({ a: 1 });

    now = new Date(now.getTime() + 60_000);
    expect(cache().get('igdb', 'k')).toBeNull();
  });

  it('keeps sources and versions apart', () => {
    cache().set('igdb', 'k', 'v1', { ttlMs: 60_000, version: 1 });
    expect(cache().get('steam', 'k')).toBeNull();
    expect(cache().get('igdb', 'k', 2)).toBeNull();
    expect(cache().get('igdb', 'k', 1)?.data).toBe('v1');
  });

  it('remember() loads once and then serves from the cache', async () => {
    const load = vi.fn(() => Promise.resolve([1, 2, 3]));
    const first = await cache().remember('igdb', 'k', { ttlMs: 60_000 }, load);
    const second = await cache().remember('igdb', 'k', { ttlMs: 60_000 }, load);
    expect(first.fromCache).toBe(false);
    expect(second).toMatchObject({ data: [1, 2, 3], fromCache: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('caches null, so "not found" is remembered too', async () => {
    const load = vi.fn(() => Promise.resolve(null));
    await cache().remember('hltb', 'missing', { ttlMs: 60_000 }, load);
    const second = await cache().remember('hltb', 'missing', { ttlMs: 60_000 }, load);
    expect(second).toMatchObject({ data: null, fromCache: true });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('secret stores', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('FileSecretStore keeps secrets in the data folder and removes them on delete', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-secrets-'));
    dirs.push(dir);
    const store = new FileSecretStore(dir);

    expect(store.get('steam.api_key')).toBeNull();
    store.set('steam.api_key', 'abc');
    store.set('igdb.client_id', 'id');
    expect(new FileSecretStore(dir).get('steam.api_key')).toBe('abc');

    store.delete('steam.api_key');
    expect(store.get('steam.api_key')).toBeNull();
    expect(readFileSync(path.join(dir, 'secrets.json'), 'utf8')).not.toContain('abc');
    expect(store.get('igdb.client_id')).toBe('id');
  });

  it('MemorySecretStore behaves the same way', () => {
    const store = new MemorySecretStore();
    store.set('rawg.api_key', 'x');
    expect(store.get('rawg.api_key')).toBe('x');
    store.delete('rawg.api_key');
    expect(store.get('rawg.api_key')).toBeNull();
  });
});
