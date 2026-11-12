import type { GameMapsResponse, InteractiveMap } from '@gamebacklog/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import { games } from '../db/schema/index.ts';
import { badRequest, notFound } from '../errors.ts';
import type { WikiImage, WikiSite } from '../sources/wiki/index.ts';
import { gameOfPlaythrough, loadMap, nextCheckpoints } from './chapter-map.ts';
import { pickMaps } from './media.ts';
import { findWikiForGame, normalizeText, wikiCandidates } from './wiki.ts';

/**
 * The game's maps, straight from its wikis: interactive maps with their markers, and map
 * images. Several wikis are read, because one often has what another lacks (wiki.gg hosts
 * many of the newer interactive maps, Fandom the older ones). No AI involved.
 */

/** Most wikis read for one game, the chosen one included. */
const MAX_WIKIS = 3;
/** Wiki name guesses tried per host; each guess costs a request the first time only. */
const MAX_GUESSES = 3;
const MAX_IMAGES = 8;
/** Wikipedia is a fine source of text but has no game maps. */
const NO_MAPS = /(^|\.)wikipedia\.org$/;

const hostOf = (url: string) => new URL(url).host;

/**
 * The wikis of a game: the one chosen for it first, then Fandom and wiki.gg wikis named like
 * it whose search knows the game. Never throws; a wiki that is down is just left out.
 */
export async function findGameWikis(ctx: AppContext, gameId: string): Promise<WikiSite[]> {
  const game = ctx.db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) throw notFound('Game');

  const found: WikiSite[] = [];
  const add = (site: WikiSite) => {
    if (NO_MAPS.test(hostOf(site.articleBase))) return;
    // Wikis answer under several names ("darksouls2.fandom.com" is "darksouls.fandom.com"),
    // so the address of their articles is what tells two apart.
    if (found.some((other) => hostOf(other.articleBase) === hostOf(site.articleBase))) return;
    found.push(site);
  };

  const chosen = await findWikiForGame(ctx, gameId).catch(() => null);
  if (chosen) add(chosen);

  const guesses = wikiCandidates(game).slice(0, MAX_GUESSES);
  for (const host of ['wiki.gg', 'fandom.com']) {
    for (const guess of guesses) {
      if (found.length >= MAX_WIKIS) return found;
      const url = `https://${guess}.${host}`;
      if (found.some((site) => hostOf(site.articleBase) === hostOf(url))) continue;
      try {
        const site = await ctx.wiki.probe(url);
        // A wiki with that name exists; make sure it knows this game.
        if (site && (await ctx.wiki.search(site, game.title, 1)).length > 0) add(site);
      } catch {
        // Not reachable now; try again another time.
      }
    }
  }
  return found;
}

/**
 * How well a map title fits the game: a map named exactly after the game is the main one,
 * then maps sharing its words; test and documentation pages go last.
 */
function mapScore(title: string, gameTitle: string): number {
  const name = normalizeText(title.replace(/^[^:]+:/, ''));
  const game = normalizeText(gameTitle);
  const words = game.split(' ').filter((word) => word.length > 2);
  const shared = words.filter((word) => ` ${name} `.includes(` ${word} `)).length;
  return (name === game ? 10 : 0) + shared - (/\b(test|doc|sandbox)\b/.test(name) ? 20 : 0);
}

export async function getGameMaps(
  ctx: AppContext,
  playthroughId: string,
): Promise<GameMapsResponse> {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const current =
    loadMap(ctx.db, game.id)?.checkpoints.find(
      (row) => row.id === playthrough.currentCheckpointId,
    ) ?? null;
  const wikis = await findGameWikis(ctx, game.id);

  const interactive: GameMapsResponse['interactive'] = [];
  const images: GameMapsResponse['images'] = [];
  for (const site of wikis) {
    const refs = await ctx.wiki.listInteractiveMaps(site).catch(() => []);
    for (const ref of refs) {
      interactive.push({
        title: ref.title.replace(/^[^:]+:/, ''),
        page: ref.title,
        pageUrl: ref.pageUrl,
        wikiName: site.name,
        wikiUrl: site.articleBase,
        kind: ref.kind,
      });
    }

    try {
      const found: WikiImage[] = [];
      if (current) {
        found.push(
          ...pickMaps(await ctx.wiki.searchImages(site, `${current.name} map`), current.name),
        );
      }
      found.push(
        ...pickMaps(await ctx.wiki.searchImages(site, `${game.title} map`, 12), game.title, 'game'),
      );
      for (const image of found) {
        if (images.length >= MAX_IMAGES) break;
        if (images.some((other) => other.pageUrl === image.pageUrl)) continue;
        images.push({ ...image, wikiName: site.name });
      }
    } catch {
      // No images from this wiki right now.
    }
  }

  return {
    wikis: wikis.map((site) => ({ name: site.name, url: site.articleBase })),
    // Best fit first across all wikis; ties keep the wiki order (the chosen wiki first).
    interactive: interactive
      .map((ref, order) => ({ ref, order, score: mapScore(ref.title, game.title) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map(({ ref }) => ref),
    images,
    currentCheckpoint: current?.name ?? null,
  };
}

/** Whether a marker is named after a place: the same words, or the place's name inside it. */
function namedAfter(markerTitle: string, names: string[]): boolean {
  const marker = ` ${normalizeText(markerTitle)} `;
  return names.some((name) => {
    const wanted = normalizeText(name);
    return wanted.length > 2 && marker.includes(` ${wanted} `);
  });
}

export async function getInteractiveMap(
  ctx: AppContext,
  playthroughId: string,
  query: { wiki: string; title: string },
): Promise<InteractiveMap> {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  // Only the wikis found for this game: the address comes from the page, not from anywhere.
  const site = (await findGameWikis(ctx, game.id)).find(
    (candidate) => candidate.articleBase === query.wiki,
  );
  if (!site) throw badRequest('wiki_not_found', 'That wiki is not one of this game');

  const map = await ctx.wiki.getInteractiveMap(site, query.title);
  if (!map) throw notFound('Map');

  const rows = loadMap(ctx.db, game.id)?.checkpoints ?? [];
  const current = rows.find((row) => row.id === playthrough.currentCheckpointId) ?? null;
  const next = current
    ? nextCheckpoints(rows, current, new Set(playthrough.completedCheckpointIds))
    : [];
  const markerIds = (names: string[]) =>
    names.length === 0
      ? []
      : map.markers.filter((marker) => namedAfter(marker.title, names)).map((marker) => marker.id);

  return {
    ...map,
    wikiName: site.name,
    highlights: {
      here: current ? markerIds([current.name, ...current.aliases]) : [],
      next: markerIds(next.flatMap((row) => [row.name, ...row.aliases])),
    },
    provenance: { origin: 'wiki', url: map.pageUrl, fetchedAt: ctx.now().toISOString() },
  };
}
