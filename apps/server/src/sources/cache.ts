import type { SourceId } from '@gamebacklog/shared';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { sourceCache } from '../db/schema/index.ts';

export interface CacheEntry<T> {
  data: T;
  fetchedAt: Date;
}

export interface CacheOptions {
  ttlMs: number;
  /** Adapter normalization version. Entries written by another version are ignored. */
  version?: number;
  url?: string;
}

/** Thin access layer over the `source_cache` table. Never stores secrets. */
export class SourceCache {
  private readonly db: AppDatabase;
  private readonly now: () => Date;

  constructor(db: AppDatabase, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  get<T>(source: SourceId, key: string, version = 1): CacheEntry<T> | null {
    const row = this.db
      .select()
      .from(sourceCache)
      .where(and(eq(sourceCache.source, source), eq(sourceCache.cacheKey, key)))
      .get();
    if (!row || row.version !== version) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= this.now().getTime()) return null;
    // The payload is wrapped so that a cached `null` ("not found") is still a non-null column.
    return { data: (row.payload as { value: T }).value, fetchedAt: row.fetchedAt };
  }

  set(source: SourceId, key: string, payload: unknown, options: CacheOptions): Date {
    const fetchedAt = this.now();
    const values = {
      source,
      cacheKey: key,
      url: options.url ?? null,
      payload: { value: payload },
      version: options.version ?? 1,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + options.ttlMs),
    };
    this.db
      .insert(sourceCache)
      .values(values)
      .onConflictDoUpdate({ target: [sourceCache.source, sourceCache.cacheKey], set: values })
      .run();
    return fetchedAt;
  }

  /** Returns the cached value when fresh; otherwise loads it, stores it and returns it. */
  async remember<T>(
    source: SourceId,
    key: string,
    options: CacheOptions,
    load: () => Promise<T>,
  ): Promise<CacheEntry<T> & { fromCache: boolean }> {
    const cached = this.get<T>(source, key, options.version);
    if (cached) return { ...cached, fromCache: true };
    const data = await load();
    const fetchedAt = this.set(source, key, data, options);
    return { data, fetchedAt, fromCache: false };
  }
}
