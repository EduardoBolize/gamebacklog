import type { SourceId } from '@gamebacklog/shared';
import { SourceError } from './adapter.ts';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Extra attempts after a network error, a 5xx or a 429. */
  retries?: number;
  retryDelayMs?: number;
}

export interface HttpResult {
  status: number;
  /** Parsed JSON body, or undefined when the body was empty or not JSON. */
  json: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Defaults shared by every adapter. Tests set `retryDelayMs` to 0 to avoid real waits. */
export const httpDefaults = { retries: 2, retryDelayMs: 400, timeoutMs: 15_000 };

/**
 * JSON request with timeout and retry with exponential backoff.
 *
 * Returns the status and body for any HTTP answer and lets the adapter decide what it means.
 * Only network failures and timeouts throw, as `SourceError('unreachable')`. Error messages
 * never include the URL, because some APIs carry the key in the query string.
 */
export async function requestJson(
  source: SourceId,
  fetchImpl: FetchLike,
  url: string,
  options: RequestOptions = {},
): Promise<HttpResult> {
  const retries = options.retries ?? httpDefaults.retries;
  const retryDelayMs = options.retryDelayMs ?? httpDefaults.retryDelayMs;
  const timeoutMs = options.timeoutMs ?? httpDefaults.timeoutMs;

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt >= retries;
    try {
      const response = await fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && !isLastAttempt) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      const text = await response.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { status: response.status, json };
    } catch {
      if (isLastAttempt) {
        throw new SourceError(source, 'unreachable', `Could not reach ${source}`);
      }
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
}

/** Throws the right `SourceError` for the status codes every API uses the same way. */
export function assertOk(source: SourceId, result: HttpResult): void {
  if (result.status >= 200 && result.status < 300) return;
  if (result.status === 401 || result.status === 403) {
    throw new SourceError(source, 'invalid_credentials', `${source} rejected the credentials`);
  }
  if (result.status === 429) {
    throw new SourceError(source, 'rate_limited', `${source} rate limit reached`);
  }
  if (result.status === 404) {
    throw new SourceError(source, 'not_found', `${source} has no such resource`);
  }
  throw new SourceError(source, 'unreachable', `${source} answered with status ${result.status}`);
}
