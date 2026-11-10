import type { Provenance, SourceId } from '@gamebacklog/shared';

/**
 * Contract shared by every external data source. Each source lives in its own folder,
 * `apps/server/src/sources/<id>/`, with: HTTP client, Zod schema of the raw response,
 * normalization into the internal model, SQLite cache with TTL, rate limiter and tests
 * running against recorded fixtures.
 *
 * Skeleton only — no source is implemented yet. What each source can fetch (catalog search,
 * times to beat, achievements, wiki pages…) is declared by capability interfaces that extend
 * this one, added together with the first adapters in Phase 1.
 */

export interface SourceRateLimit {
  maxRequests: number;
  perMs: number;
}

export type SourceHealthStatus =
  'ok' | 'not_configured' | 'invalid_credentials' | 'unreachable' | 'error';

export interface SourceHealth {
  status: SourceHealthStatus;
  /** Friendly, user-facing explanation. Must never contain keys or tokens. */
  message: string;
}

export interface SourceAdapter {
  readonly id: SourceId;
  readonly displayName: string;
  /** True when the user must supply their own key or account for this source. */
  readonly requiresCredentials: boolean;
  /** How long a cached response stays fresh. */
  readonly cacheTtlMs: number;
  readonly rateLimit: SourceRateLimit;

  /** Whether the credentials this source needs (if any) are present. */
  isConfigured(): Promise<boolean>;

  /** Checks credentials and reachability. Never throws. */
  healthCheck(): Promise<SourceHealth>;
}

/** Anything returned by a source carries where it came from, so the UI can show it. */
export interface Sourced<T> {
  data: T;
  provenance: Provenance;
  fromCache: boolean;
}

export type SourceErrorCode =
  | 'not_configured'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'not_found'
  | 'unreachable'
  | 'invalid_response';

/**
 * Error thrown by adapters. A failing source must never break the app: callers catch this
 * and fall back (cached value, manual field, or the feature shown as unavailable).
 */
export class SourceError extends Error {
  readonly source: SourceId;
  readonly code: SourceErrorCode;

  constructor(source: SourceId, code: SourceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SourceError';
    this.source = source;
    this.code = code;
  }
}
