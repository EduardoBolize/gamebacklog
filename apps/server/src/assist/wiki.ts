import type { Provenance } from '@gamebacklog/shared';
import { eq } from 'drizzle-orm';
import { estimateTokens } from '../ai/provider.ts';
import type { AppContext } from '../context.ts';
import { games } from '../db/schema/index.ts';
import { badRequest, notFound } from '../errors.ts';
import { SETTINGS, getSetting, setSetting } from '../settings/store.ts';
import type { WikiSection } from '../sources/wiki/html.ts';
import type { WikiSite } from '../sources/wiki/index.ts';

/** Lowercase letters and digits only, accents removed: "The Legend of Zelda" → "thelegendofzelda". */
export const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Lowercase words with accents removed, for matching text typed by the user. */
export const normalizeText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Fandom subdomains worth trying for a game, most specific first. Wikis are usually named after
 * the franchise ("zelda", "darksouls"), sometimes after the game itself.
 */
export function wikiCandidates(game: { title: string; franchise: string | null }): string[] {
  const names = [game.franchise, game.title.split(':')[0], game.title].filter(
    (name): name is string => Boolean(name),
  );
  const slugs = new Set<string>();
  for (const name of names) {
    slugs.add(slug(name));
    slugs.add(slug(name.replace(/^the\s+/i, '')));
    // "The Legend of Zelda" → "zelda"
    const words = name.trim().split(/\s+/);
    if (words.length > 2) slugs.add(slug(words.at(-1) ?? ''));
  }
  return [...slugs].filter((candidate) => candidate.length >= 3).slice(0, 6);
}

function requireGame(ctx: AppContext, gameId: string) {
  const game = ctx.db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) throw notFound('Game');
  return game;
}

function remember(ctx: AppContext, gameId: string, url: string | null): void {
  setSetting(ctx.db, SETTINGS.gameWikis, {
    ...getSetting(ctx.db, SETTINGS.gameWikis),
    [gameId]: url,
  });
}

/** URL of the wiki chosen for a game, without looking for one. */
export function storedWikiUrl(ctx: AppContext, gameId: string): string | null {
  return getSetting(ctx.db, SETTINGS.gameWikis)[gameId] ?? null;
}

/**
 * Finds the wiki to read for a game and remembers the answer, including "none".
 * Order: the user's own choice, Fandom guesses checked against a search for the game, the
 * configured web search, and finally Wikipedia, which always exists but knows less.
 */
export async function findWikiForGame(ctx: AppContext, gameId: string): Promise<WikiSite | null> {
  const stored = getSetting(ctx.db, SETTINGS.gameWikis);
  if (gameId in stored) {
    const url = stored[gameId];
    return url ? ctx.wiki.probe(url) : null;
  }

  const game = requireGame(ctx, gameId);
  try {
    for (const candidate of wikiCandidates(game)) {
      const site = await ctx.wiki.probe(`https://${candidate}.fandom.com`);
      // A wiki with that name exists; make sure it is about this game.
      if (site && (await ctx.wiki.search(site, game.title, 1)).length > 0) {
        remember(ctx, gameId, site.articleBase);
        return site;
      }
    }

    for (const result of await ctx.webSearch.search(`${game.title} wiki`, 5)) {
      if (!/fandom\.com|\/wiki\//i.test(result.url)) continue;
      const site = await ctx.wiki.probe(result.url);
      if (site) {
        remember(ctx, gameId, site.articleBase);
        return site;
      }
    }

    const wikipedia = await ctx.wiki.probe('https://en.wikipedia.org');
    remember(ctx, gameId, wikipedia?.articleBase ?? null);
    return wikipedia;
  } catch {
    // Offline or a source misbehaving: try again next time instead of recording "none".
    return null;
  }
}

/** Lets the user point a game at the wiki they trust, or at none. */
export async function setWikiForGame(
  ctx: AppContext,
  gameId: string,
  url: string | null,
): Promise<string | null> {
  requireGame(ctx, gameId);
  if (!url) {
    remember(ctx, gameId, null);
    return null;
  }
  const site = await ctx.wiki.probe(url).catch(() => null);
  if (!site) throw badRequest('wiki_not_found', 'That address is not a wiki the app can read');
  remember(ctx, gameId, site.articleBase);
  return site.articleBase;
}

// --- Context for prompts -------------------------------------------------------------

export interface ContextDoc {
  title: string;
  url: string;
  sections: WikiSection[];
  provenance: Provenance;
}

/**
 * Deterministic context: searches the game's wiki for each query and returns the best pages.
 * Never throws — with no wiki, or the wiki down, the AI simply gets less to work with.
 */
export async function collectWikiDocs(
  ctx: AppContext,
  gameId: string,
  queries: (string | null | undefined)[],
  maxPages = 3,
): Promise<ContextDoc[]> {
  const site = await findWikiForGame(ctx, gameId);
  if (!site) return [];

  const docs: ContextDoc[] = [];
  const seen = new Set<string>();
  try {
    for (const query of queries) {
      if (!query?.trim() || docs.length >= maxPages) continue;
      for (const title of await ctx.wiki.search(site, query, 3)) {
        if (seen.has(title) || docs.length >= maxPages) continue;
        seen.add(title);
        const page = await ctx.wiki.getPage(site, title);
        if (page && page.data.sections.length > 0) {
          docs.push({ ...page.data, provenance: page.provenance });
        }
      }
    }
  } catch {
    // Keep whatever was gathered before the failure.
  }
  return docs;
}

/**
 * Renders documents as numbered sources within a token budget. Each page gets an equal share;
 * inside a page the intro comes first, then the sections that mention the keywords most.
 */
export function renderSources(
  docs: { title: string; url: string; sections: WikiSection[] }[],
  keywords: (string | null | undefined)[],
  budgetTokens: number,
): string {
  if (docs.length === 0) return '';
  const wanted = keywords
    .flatMap((keyword) => normalizeText(keyword ?? '').split(' '))
    .filter((word) => word.length > 2);
  const perDoc = Math.max(200, Math.floor(budgetTokens / docs.length));

  return docs
    .map((doc, index) => {
      const scored = doc.sections.map((section, order) => {
        const heading = normalizeText(section.heading);
        const body = normalizeText(section.text);
        const score = wanted.reduce(
          (total, word) => total + (heading.includes(word) ? 3 : 0) + (body.includes(word) ? 1 : 0),
          0,
        );
        return { section, order, score: order === 0 ? score + 1 : score };
      });
      scored.sort((a, b) => b.score - a.score || a.order - b.order);

      const chosen: typeof scored = [];
      let used = 0;
      for (const item of scored) {
        const cost = estimateTokens(item.section.heading + item.section.text) + 4;
        if (used + cost > perDoc) {
          if (chosen.length > 0) continue;
          // Even the best section is too long: take the part that fits.
          chosen.push({
            ...item,
            section: { ...item.section, text: item.section.text.slice(0, perDoc * 4) },
          });
          break;
        }
        chosen.push(item);
        used += cost;
      }
      chosen.sort((a, b) => a.order - b.order);

      const body = chosen
        .map(({ section }) =>
          section.heading ? `## ${section.heading}\n${section.text}` : section.text,
        )
        .join('\n\n');
      return `[${index + 1}] ${doc.title} — ${doc.url}\n${body}`;
    })
    .join('\n\n---\n\n');
}
