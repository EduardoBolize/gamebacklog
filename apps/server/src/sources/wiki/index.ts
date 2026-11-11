import { z } from 'zod';
import { SourceError, type SourceHealth, type Sourced } from '../adapter.ts';
import type { SourceCache } from '../cache.ts';
import { requestJson, type FetchLike } from '../http.ts';
import { createRateLimiter } from '../rate-limiter.ts';
import { htmlToSections, type WikiSection } from './html.ts';

/**
 * Any MediaWiki site through its public `api.php`: Fandom wikis, independent wikis, Wikipedia.
 * This is the main source of raw context for the AI. Pages are fetched one at a time, cached
 * for a week, and always linked back to — the app summarizes and cites, it never republishes.
 */

const DAY = 24 * 60 * 60 * 1000;
const PAGE_TTL_MS = 7 * DAY;
const SEARCH_TTL_MS = DAY;
const SITE_TTL_MS = 30 * DAY;
const CACHE_VERSION = 1;
/** Identifies the client honestly, as MediaWiki API etiquette asks. No personal data. */
const USER_AGENT = 'GameBacklog/0.1 (local-first game tracker; one user)';

export interface WikiSite {
  name: string;
  /** Endpoint of the API, e.g. `https://zelda.fandom.com/api.php`. */
  apiUrl: string;
  /** Prefix of article URLs, e.g. `https://zelda.fandom.com/wiki/`. */
  articleBase: string;
}

export interface WikiPage {
  title: string;
  url: string;
  sections: WikiSection[];
}

/** An image file of a wiki. The app shows the thumbnail and links to the file's own page. */
export interface WikiImage {
  /** File name without the `File:` prefix and the extension. */
  title: string;
  thumbUrl: string;
  /** The file's page on the wiki, with its full size, author and licence. */
  pageUrl: string;
  width: number;
  height: number;
}

export interface WikiSource {
  readonly id: 'wiki';
  /** Checks that `url` belongs to a MediaWiki site and returns how to talk to it. */
  probe(url: string): Promise<WikiSite | null>;
  /** Page titles matching the query, best first. */
  search(site: WikiSite, query: string, limit?: number): Promise<string[]>;
  getPage(site: WikiSite, title: string): Promise<Sourced<WikiPage> | null>;
  /** Image files whose name or page matches the query, best first. */
  searchImages(site: WikiSite, query: string, limit?: number): Promise<WikiImage[]>;
  /** Image files used on a page, in no particular order. */
  getPageImages(site: WikiSite, title: string): Promise<WikiImage[]>;
  healthCheck(): Promise<SourceHealth>;
}

const siteInfoSchema = z.object({
  query: z.object({
    general: z.object({
      sitename: z.string(),
      base: z.string(),
      server: z.string().optional(),
      articlepath: z.string().optional(),
    }),
  }),
});
const searchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })) }).optional(),
});
const parseSchema = z.object({
  parse: z.object({ title: z.string(), text: z.string() }).optional(),
  error: z.object({ code: z.string() }).optional(),
});

const imagePagesSchema = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          title: z.string(),
          /** Rank in the search results, when the pages come from a search. */
          index: z.number().optional(),
          imageinfo: z
            .array(
              z.object({
                url: z.string(),
                thumburl: z.string().optional(),
                descriptionurl: z.string().optional(),
                width: z.number().optional(),
                height: z.number().optional(),
                mime: z.string().optional(),
              }),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
});

const THUMB_WIDTH = 480;
const SHOWABLE_IMAGE = /^image\/(png|jpe?g|webp|gif)$/;
const IMAGE_PROPS = {
  prop: 'imageinfo',
  iiprop: 'url|size|mime',
  iiurlwidth: String(THUMB_WIDTH),
};

function toWikiImages(result: z.infer<typeof imagePagesSchema> | null): WikiImage[] {
  return [...(result?.query?.pages ?? [])]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((page): WikiImage[] => {
      const info = page.imageinfo?.[0];
      // Files that do not exist on this wiki come back without `imageinfo`.
      if (!info?.descriptionurl || !SHOWABLE_IMAGE.test(info.mime ?? '')) return [];
      return [
        {
          title: page.title.replace(/^[^:]+:/, '').replace(/\.\w+$/, ''),
          thumbUrl: info.thumburl ?? info.url,
          pageUrl: info.descriptionurl,
          width: info.width ?? 0,
          height: info.height ?? 0,
        },
      ];
    });
}

function articleBaseOf(general: z.infer<typeof siteInfoSchema>['query']['general']): string {
  if (general.server && general.articlepath?.includes('$1')) {
    const server = general.server.startsWith('//') ? `https:${general.server}` : general.server;
    return server + general.articlepath.replace('$1', '');
  }
  // Fall back to the main page URL minus its last segment.
  return general.base.slice(0, general.base.lastIndexOf('/') + 1);
}

export function createWikiSource(options: { cache: SourceCache; fetch?: FetchLike }): WikiSource {
  const { cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  const limiter = createRateLimiter({ maxRequests: 2, perMs: 1000 });

  async function api<T>(apiUrl: string, params: Record<string, string>, schema: z.ZodType<T>) {
    const url = `${apiUrl}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' }).toString()}`;
    const result = await limiter.schedule(() =>
      requestJson('wiki', fetchImpl, url, { headers: { 'User-Agent': USER_AGENT }, retries: 1 }),
    );
    if (result.status === 404) return null;
    if (result.status < 200 || result.status >= 300) {
      throw new SourceError(
        'wiki',
        'unreachable',
        `The wiki answered with status ${result.status}`,
      );
    }
    const parsed = schema.safeParse(result.json);
    if (!parsed.success) {
      throw new SourceError('wiki', 'invalid_response', 'Unexpected answer from the wiki');
    }
    return parsed.data;
  }

  return {
    id: 'wiki',

    async probe(url) {
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return null;
      }
      const cached = cache.get<WikiSite | null>('wiki', `site:${origin}`, CACHE_VERSION);
      if (cached) return cached.data;

      let site: WikiSite | null = null;
      // Fandom serves the API at the root; a stock MediaWiki install serves it under /w/.
      for (const apiUrl of [`${origin}/api.php`, `${origin}/w/api.php`]) {
        try {
          const info = await api(
            apiUrl,
            { action: 'query', meta: 'siteinfo', siprop: 'general' },
            siteInfoSchema,
          );
          if (info) {
            site = {
              name: info.query.general.sitename,
              apiUrl,
              articleBase: articleBaseOf(info.query.general),
            };
            break;
          }
        } catch {
          // Not an API endpoint; try the next location.
        }
      }
      cache.set('wiki', `site:${origin}`, site, {
        ttlMs: site ? SITE_TTL_MS : DAY,
        version: CACHE_VERSION,
      });
      return site;
    },

    async search(site, query, limit = 5) {
      const key = `search:${site.apiUrl}:${limit}:${query.trim().toLowerCase()}`;
      const entry = await cache.remember(
        'wiki',
        key,
        { ttlMs: SEARCH_TTL_MS, version: CACHE_VERSION },
        async () => {
          const result = await api(
            site.apiUrl,
            {
              action: 'query',
              list: 'search',
              srsearch: query,
              srlimit: String(limit),
              srprop: '',
            },
            searchSchema,
          );
          return (result?.query?.search ?? []).map((item) => item.title);
        },
      );
      return entry.data;
    },

    async getPage(site, title) {
      const key = `page:${site.apiUrl}:${title}`;
      const entry = await cache.remember<WikiPage | null>(
        'wiki',
        key,
        { ttlMs: PAGE_TTL_MS, version: CACHE_VERSION },
        async () => {
          const result = await api(
            site.apiUrl,
            {
              action: 'parse',
              page: title,
              prop: 'text',
              redirects: '1',
              disableeditsection: '1',
              disabletoc: '1',
            },
            parseSchema,
          );
          if (!result?.parse) return null;
          return {
            title: result.parse.title,
            url: site.articleBase + encodeURIComponent(result.parse.title.replace(/ /g, '_')),
            sections: htmlToSections(result.parse.text),
          };
        },
      );
      if (!entry.data) return null;
      return {
        data: entry.data,
        fromCache: entry.fromCache,
        provenance: {
          origin: 'wiki',
          url: entry.data.url,
          fetchedAt: entry.fetchedAt.toISOString(),
        },
      };
    },

    async searchImages(site, query, limit = 8) {
      const key = `images:${site.apiUrl}:${limit}:${query.trim().toLowerCase()}`;
      const entry = await cache.remember(
        'wiki',
        key,
        { ttlMs: PAGE_TTL_MS, version: CACHE_VERSION },
        async () =>
          toWikiImages(
            await api(
              site.apiUrl,
              {
                action: 'query',
                generator: 'search',
                gsrsearch: query,
                // Namespace 6 is "File" on every MediaWiki site.
                gsrnamespace: '6',
                gsrlimit: String(limit),
                ...IMAGE_PROPS,
              },
              imagePagesSchema,
            ),
          ),
      );
      return entry.data;
    },

    async getPageImages(site, title) {
      const entry = await cache.remember(
        'wiki',
        `page-images:${site.apiUrl}:${title}`,
        { ttlMs: PAGE_TTL_MS, version: CACHE_VERSION },
        async () =>
          toWikiImages(
            await api(
              site.apiUrl,
              {
                action: 'query',
                titles: title,
                redirects: '1',
                generator: 'images',
                gimlimit: '50',
                ...IMAGE_PROPS,
              },
              imagePagesSchema,
            ),
          ),
      );
      return entry.data;
    },

    async healthCheck() {
      try {
        const site = await this.probe('https://en.wikipedia.org');
        return site
          ? { status: 'ok', message: 'Wikis are reachable' }
          : { status: 'unreachable', message: 'Could not reach a wiki' };
      } catch {
        return { status: 'unreachable', message: 'Could not reach a wiki' };
      }
    },
  };
}
