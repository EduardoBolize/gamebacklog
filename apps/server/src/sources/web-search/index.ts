import type { WebSearchProvider } from '@gamebacklog/shared';
import { z } from 'zod';
import type { SecretStore } from '../../secrets/store.ts';
import { SourceError } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { assertOk, requestJson, type FetchLike } from '../http.ts';
import { createRateLimiter } from '../rate-limiter.ts';

/**
 * Optional web search, to find the wiki of a game and guides relevant to a hint. The user picks
 * the provider: their own SearXNG instance (free, local), Brave Search API or Tavily.
 * Endpoints and fields checked against each provider's documentation in November 2026.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchSource {
  readonly id: 'web_search';
  isConfigured(): boolean;
  /** Empty when no provider is configured: search is an extra, never a requirement. */
  search(query: string, limit?: number): Promise<WebSearchResult[]>;
}

const DAY = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;

const searxngSchema = z.object({
  results: z.array(
    z.object({ title: z.string(), url: z.string(), content: z.string().optional() }),
  ),
});
const braveSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({ title: z.string(), url: z.string(), description: z.string().optional() }),
      ),
    })
    .optional(),
});
const tavilySchema = z.object({
  results: z.array(
    z.object({ title: z.string(), url: z.string(), content: z.string().optional() }),
  ),
});

const stripTags = (text: string | undefined) => (text ?? '').replace(/<[^>]+>/g, '').trim();

export interface WebSearchOptions {
  secrets: SecretStore;
  cache: SourceCache;
  getProvider: () => WebSearchProvider | null;
  getSearxngUrl: () => string | null;
  fetch?: FetchLike;
}

export function createWebSearchSource(options: WebSearchOptions): WebSearchSource {
  const { secrets, cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  const limiter = createRateLimiter({ maxRequests: 1, perMs: 1100 });

  function isConfigured(): boolean {
    const provider = options.getProvider();
    if (provider === 'searxng') return Boolean(options.getSearxngUrl());
    if (provider === 'brave') return Boolean(secrets.get('search.brave.api_key'));
    if (provider === 'tavily') return Boolean(secrets.get('search.tavily.api_key'));
    return false;
  }

  async function run(
    provider: WebSearchProvider,
    query: string,
    limit: number,
  ): Promise<WebSearchResult[]> {
    const fail = () =>
      new SourceError('web_search', 'invalid_response', 'Unexpected search response');

    if (provider === 'searxng') {
      const base = (options.getSearxngUrl() ?? '').replace(/\/$/, '');
      const result = await requestJson(
        'web_search',
        fetchImpl,
        `${base}/search?${new URLSearchParams({ q: query, format: 'json' }).toString()}`,
      );
      assertOk('web_search', result);
      const parsed = searxngSchema.safeParse(result.json);
      if (!parsed.success) throw fail();
      return parsed.data.results.slice(0, limit).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: stripTags(item.content),
      }));
    }

    if (provider === 'brave') {
      const result = await requestJson(
        'web_search',
        fetchImpl,
        `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(limit) }).toString()}`,
        {
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': secrets.get('search.brave.api_key') ?? '',
          },
        },
      );
      assertOk('web_search', result);
      const parsed = braveSchema.safeParse(result.json);
      if (!parsed.success) throw fail();
      return (parsed.data.web?.results ?? []).slice(0, limit).map((item) => ({
        title: stripTags(item.title),
        url: item.url,
        snippet: stripTags(item.description),
      }));
    }

    const result = await requestJson('web_search', fetchImpl, 'https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secrets.get('search.tavily.api_key') ?? ''}`,
      },
      body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
    });
    assertOk('web_search', result);
    const parsed = tavilySchema.safeParse(result.json);
    if (!parsed.success) throw fail();
    return parsed.data.results.slice(0, limit).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: stripTags(item.content),
    }));
  }

  return {
    id: 'web_search',
    isConfigured,

    async search(query, limit = 5) {
      const provider = options.getProvider();
      if (!provider || !isConfigured()) return [];
      const key = `${provider}:${limit}:${query.trim().toLowerCase()}`;
      const entry = await cache.remember(
        'web_search',
        key,
        { ttlMs: DAY, version: CACHE_VERSION },
        () => limiter.schedule(() => run(provider, query, limit)),
      );
      return entry.data;
    },
  };
}
