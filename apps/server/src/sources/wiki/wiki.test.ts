import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../../db/client.ts';
import { MemorySecretStore } from '../../secrets/store.ts';
import {
  createFakeFetch,
  createTestDatabase,
  whenUrl,
  type FakeRoute,
} from '../../test/helpers.ts';
import { SourceCache } from '../cache.ts';
import { httpDefaults } from '../http.ts';
import { createWebSearchSource } from '../web-search/index.ts';
import { htmlToSections, sectionsToText } from './html.ts';
import { createWikiSource } from './index.ts';

// Shaped like what `action=parse&prop=text` returns for a Fandom dungeon page.
const DEKU_TREE_HTML = `
<div class="mw-parser-output">
<aside class="portable-infobox"><h2 class="pi-title">Inside the Deku Tree</h2><div>Boss: Gohma</div></aside>
<p><b>Inside the Deku Tree</b> is the first dungeon in <i>Ocarina of Time</i>.<sup class="reference"><a href="#cite-1">[1]</a></sup> It&#39;s home to Queen&nbsp;Gohma &amp; her brood.</p>
<div class="toc"><ul><li>1 Entrance</li></ul></div>
<h2><span class="mw-headline" id="Entrance">Entrance to the Tree</span><span class="mw-editsection">[edit]</span></h2>
<p>Link enters through the mouth of the tree.</p>
<h3><span class="mw-headline">Gold Skulltulas</span></h3>
<ul><li>On the vines in the main room.</li><li>In the basement, behind a web.<ul><li>Needs the slingshot.</li></ul></li></ul>
<table class="wikitable"><tr><th>Item</th><th>Location</th></tr><tr><td>Fairy Slingshot</td><td>Second floor</td></tr></table>
<script>alert("x")</script><style>.a{color:red}</style>
<div class="navbox"><table><tr><td>Dungeons: <a>Dodongo's Cavern</a></td></tr></table></div>
<figure><img src="x.png"><figcaption>A picture</figcaption></figure>
</div>`;

describe('htmlToSections', () => {
  const sections = htmlToSections(DEKU_TREE_HTML);

  it('splits the page by heading and keeps prose, lists and table rows', () => {
    // The infobox title is the first heading, so the intro paragraph lands under it.
    expect(sections.map((section) => section.heading)).toEqual([
      'Inside the Deku Tree',
      'Entrance to the Tree',
      'Gold Skulltulas',
    ]);
    expect(sections[0]?.text).toContain('Boss: Gohma');
    expect(sections[1]?.text).toBe('Link enters through the mouth of the tree.');
    expect(sections[2]?.text).toContain('- On the vines in the main room.');
    expect(sections[2]?.text).toContain('- Needs the slingshot.');
    expect(sections[2]?.text).toContain('Fairy Slingshot | Second floor');
  });

  it('decodes entities and drops footnotes, edit links, scripts, navigation and images', () => {
    const text = sectionsToText(sections);
    expect(text).toContain("It's home to Queen Gohma & her brood.");
    for (const noise of [
      '[1]',
      '[edit]',
      'alert(',
      'color:red',
      "Dodongo's Cavern",
      'A picture',
      '<',
    ]) {
      expect(text, noise).not.toContain(noise);
    }
  });

  it('handles an empty page', () => {
    expect(htmlToSections('')).toEqual([]);
  });
});

describe('wiki and web search sources', () => {
  let handle: DatabaseHandle;
  beforeAll(() => {
    httpDefaults.retryDelayMs = 0;
  });
  beforeEach(() => {
    handle = createTestDatabase();
  });
  afterEach(() => handle.close());

  const siteInfo = whenUrl('meta=siteinfo', (call) =>
    call.url.startsWith('https://zelda.fandom.com/api.php')
      ? {
          json: {
            query: {
              general: {
                sitename: 'Zelda Wiki',
                base: 'https://zelda.fandom.com/wiki/Zelda_Wiki',
                server: 'https://zelda.fandom.com',
                articlepath: '/wiki/$1',
              },
            },
          },
        }
      : { status: 404 },
  );

  function wiki(...routes: FakeRoute[]) {
    const fetch = createFakeFetch(...routes);
    return { source: createWikiSource({ cache: new SourceCache(handle.db), fetch }), fetch };
  }

  it('recognises a MediaWiki site from any of its URLs and caches the answer', async () => {
    const { source, fetch } = wiki(siteInfo);
    const site = await source.probe('https://zelda.fandom.com/wiki/Inside_the_Deku_Tree');
    expect(site).toEqual({
      name: 'Zelda Wiki',
      apiUrl: 'https://zelda.fandom.com/api.php',
      articleBase: 'https://zelda.fandom.com/wiki/',
    });
    expect(fetch.calls[0]?.headers['User-Agent']).toMatch(/^GameBacklog\//);

    const calls = fetch.calls.length;
    await source.probe('https://zelda.fandom.com/');
    expect(fetch.calls).toHaveLength(calls);
  });

  it('answers null for a site that is not a wiki, or not a URL', async () => {
    const { source } = wiki(siteInfo);
    expect(await source.probe('https://not-a-wiki.example.com/')).toBeNull();
    expect(await source.probe('not a url')).toBeNull();
  });

  it('searches and fetches a page as sections, with its public URL as the source', async () => {
    const { source, fetch } = wiki(
      siteInfo,
      whenUrl('list=search', {
        json: {
          query: { search: [{ title: 'Inside the Deku Tree' }, { title: 'Great Deku Tree' }] },
        },
      }),
      whenUrl('action=parse', {
        json: { parse: { title: 'Inside the Deku Tree', text: DEKU_TREE_HTML } },
      }),
    );
    const site = await source.probe('https://zelda.fandom.com');
    if (!site) throw new Error('site not found');

    expect(await source.search(site, 'Deku Tree', 2)).toEqual([
      'Inside the Deku Tree',
      'Great Deku Tree',
    ]);
    const searchUrl = new URL(fetch.calls.at(-1)?.url ?? '');
    expect(Object.fromEntries(searchUrl.searchParams)).toMatchObject({
      action: 'query',
      list: 'search',
      srsearch: 'Deku Tree',
      srlimit: '2',
      format: 'json',
    });

    const page = await source.getPage(site, 'Inside the Deku Tree');
    expect(page?.data.url).toBe('https://zelda.fandom.com/wiki/Inside_the_Deku_Tree');
    expect(page?.data.sections.length).toBeGreaterThan(2);
    expect(page?.provenance).toMatchObject({
      origin: 'wiki',
      url: 'https://zelda.fandom.com/wiki/Inside_the_Deku_Tree',
    });

    const calls = fetch.calls.length;
    expect((await source.getPage(site, 'Inside the Deku Tree'))?.fromCache).toBe(true);
    expect(fetch.calls).toHaveLength(calls);
  });

  it('finds image files by search and by page, as thumbnails that link to the wiki', async () => {
    // Shaped like `generator=search` / `generator=images` with `prop=imageinfo` on Fandom.
    const file = (title: string, index: number, mime = 'image/png') => ({
      title: `File:${title}`,
      index,
      imageinfo: [
        {
          url: `https://static.example/${title}`,
          thumburl: `https://static.example/${title}/480`,
          descriptionurl: `https://zelda.fandom.com/wiki/File:${title}`,
          width: 1792,
          height: 657,
          mime,
        },
      ],
    });
    const { source, fetch } = wiki(
      siteInfo,
      whenUrl('generator=search', {
        json: {
          query: {
            pages: [
              file('Second.png', 2),
              file('Inside_the_Deku_Tree_Map.png', 1),
              file('Theme.ogg', 3, 'application/ogg'),
              // A file used on the wiki but hosted elsewhere has no image info.
              { title: 'File:Missing.png', index: 4 },
            ],
          },
        },
      }),
      whenUrl('generator=images', {
        json: { query: { pages: [file('Boss.jpg', 0, 'image/jpeg')] } },
      }),
    );
    const site = await source.probe('https://zelda.fandom.com');
    if (!site) throw new Error('site not found');

    const found = await source.searchImages(site, 'Inside the Deku Tree map', 6);
    // In search-rank order, without sounds or files that do not exist here.
    expect(found).toEqual([
      {
        title: 'Inside_the_Deku_Tree_Map',
        thumbUrl: 'https://static.example/Inside_the_Deku_Tree_Map.png/480',
        pageUrl: 'https://zelda.fandom.com/wiki/File:Inside_the_Deku_Tree_Map.png',
        width: 1792,
        height: 657,
      },
      expect.objectContaining({ title: 'Second' }),
    ]);
    const query = Object.fromEntries(new URL(fetch.calls.at(-1)?.url ?? '').searchParams);
    expect(query).toMatchObject({
      generator: 'search',
      gsrsearch: 'Inside the Deku Tree map',
      gsrnamespace: '6',
      gsrlimit: '6',
      prop: 'imageinfo',
      iiurlwidth: '480',
    });

    const onPage = await source.getPageImages(site, 'Inside the Deku Tree');
    expect(onPage.map((image) => image.title)).toEqual(['Boss']);

    const calls = fetch.calls.length;
    await source.searchImages(site, 'inside the deku tree MAP', 6);
    await source.getPageImages(site, 'Inside the Deku Tree');
    expect(fetch.calls).toHaveLength(calls);
  });

  it('returns null for a page that does not exist and fails softly when the wiki is down', async () => {
    const missing = wiki(
      siteInfo,
      whenUrl('action=parse', { json: { error: { code: 'missingtitle' } } }),
    );
    const site = await missing.source.probe('https://zelda.fandom.com');
    if (!site) throw new Error('site not found');
    expect(await missing.source.getPage(site, 'Nope')).toBeNull();

    const down = wiki(whenUrl('list=search', { status: 503 }));
    await expect(down.source.search(site, 'anything')).rejects.toMatchObject({
      source: 'wiki',
      code: 'unreachable',
    });
  });

  describe('web search', () => {
    function search(provider: 'searxng' | 'brave' | 'tavily' | null, ...routes: FakeRoute[]) {
      const secrets = new MemorySecretStore();
      secrets.set('search.brave.api_key', 'BRAVEKEY');
      secrets.set('search.tavily.api_key', 'TAVILYKEY');
      const fetch = createFakeFetch(...routes);
      const source = createWebSearchSource({
        secrets,
        cache: new SourceCache(handle.db),
        getProvider: () => provider,
        getSearxngUrl: () => 'http://127.0.0.1:8888/',
        fetch,
      });
      return { source, fetch };
    }

    it('is optional: with no provider it returns nothing and makes no request', async () => {
      const { source, fetch } = search(null);
      expect(source.isConfigured()).toBe(false);
      expect(await source.search('zelda wiki')).toEqual([]);
      expect(fetch.calls).toHaveLength(0);
    });

    it('queries a SearXNG instance', async () => {
      const { source, fetch } = search(
        'searxng',
        whenUrl('/search', {
          json: {
            results: [
              {
                title: 'Zelda Wiki',
                url: 'https://zelda.fandom.com/',
                content: 'The <b>Zelda</b> encyclopedia',
              },
            ],
          },
        }),
      );
      expect(await source.search('zelda wiki', 3)).toEqual([
        {
          title: 'Zelda Wiki',
          url: 'https://zelda.fandom.com/',
          snippet: 'The Zelda encyclopedia',
        },
      ]);
      expect(fetch.calls[0]?.url).toBe('http://127.0.0.1:8888/search?q=zelda+wiki&format=json');
    });

    it('queries Brave with the key in a header, never in the URL', async () => {
      const { source, fetch } = search(
        'brave',
        whenUrl('api.search.brave.com', {
          json: {
            web: { results: [{ title: 'A', url: 'https://a.test', description: 'about a' }] },
          },
        }),
      );
      expect(await source.search('q')).toEqual([
        { title: 'A', url: 'https://a.test', snippet: 'about a' },
      ]);
      expect(fetch.calls[0]?.url).toBe(
        'https://api.search.brave.com/res/v1/web/search?q=q&count=5',
      );
      expect(fetch.calls[0]?.headers['X-Subscription-Token']).toBe('BRAVEKEY');
    });

    it('queries Tavily with a bearer token and caches the results', async () => {
      const { source, fetch } = search(
        'tavily',
        whenUrl('api.tavily.com', {
          json: {
            results: [{ title: 'B', url: 'https://b.test', content: 'about b', score: 0.9 }],
          },
        }),
      );
      expect(await source.search('q', 2)).toEqual([
        { title: 'B', url: 'https://b.test', snippet: 'about b' },
      ]);
      expect(fetch.calls[0]).toMatchObject({
        method: 'POST',
        url: 'https://api.tavily.com/search',
      });
      expect(fetch.calls[0]?.headers.Authorization).toBe('Bearer TAVILYKEY');
      expect(JSON.parse(fetch.calls[0]?.body ?? '{}')).toEqual({
        query: 'q',
        max_results: 2,
        search_depth: 'basic',
      });

      await source.search('Q ', 2);
      expect(fetch.calls).toHaveLength(1);
    });

    it('reports a rejected key', async () => {
      const { source } = search('brave', whenUrl('brave', { status: 401 }));
      await expect(source.search('q')).rejects.toMatchObject({ code: 'invalid_credentials' });
    });
  });
});
