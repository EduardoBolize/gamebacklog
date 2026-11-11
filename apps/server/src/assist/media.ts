import type { AreaMediaResponse } from '@gamebacklog/shared';
import type { AppContext } from '../context.ts';
import type { WikiImage } from '../sources/wiki/index.ts';
import { gameOfPlaythrough, loadMap } from './chapter-map.ts';
import { findWikiForGame, normalizeText } from './wiki.ts';

/**
 * Maps and videos for the area the player is in. No AI: maps are image files the game's wiki
 * already has, shown as thumbnails that link back to the wiki; videos are links.
 */

const MAX_MAPS = 4;
const MAX_VIDEOS = 3;
/** Anything narrower is an icon or a sprite, not something to find your way with. */
const MIN_MAP_WIDTH = 300;
const MAP_WORDS = /\b(maps?|mapa|floor|layout|world|overworld)\b/;
/** File names that share a place's name but are not maps. */
const NOT_A_MAP = /\b(icon|sprite|model|render|artwork|logo|banner|portrait|screenshot)\b/;

const VIDEO_WORD: Record<string, string> = { 'pt-BR': 'detonado', en: 'walkthrough' };
const VIDEO_HOST = /^(www\.|m\.)?(youtube\.com|youtu\.be)$/;

/** Words too common to tell one place from another. */
const FILLER = new Set(['the', 'of', 'and', 'inside', 'outside', 'area', 'chapter', 'act', 'part']);

/**
 * Picks the files that look like maps, most likely first. For an area, the file has to be named
 * after it (a map of somewhere else is worse than no map); for the whole game, it has to be
 * called a map.
 */
export function pickMaps(
  images: WikiImage[],
  place: string,
  scope: 'area' | 'game' = 'area',
): WikiImage[] {
  const wanted = normalizeText(place);
  const placeWords = wanted.split(' ').filter((word) => word.length > 2 && !FILLER.has(word));
  const seen = new Set<string>();
  return images
    .map((image, order) => {
      const name = normalizeText(image.title);
      const words = new Set(name.split(' '));
      const present = placeWords.filter((word) => words.has(word)).length;
      const namedAfterPlace = placeWords.length > 0 && present / placeWords.length >= 0.5;
      const isMap = MAP_WORDS.test(name);
      const score =
        (isMap ? 3 : 0) +
        (namedAfterPlace ? 2 : 0) +
        (wanted && name.includes(wanted) ? 1 : 0) -
        (NOT_A_MAP.test(name) ? 6 : 0);
      return { image, order, score, eligible: scope === 'area' ? namedAfterPlace : isMap };
    })
    .filter(({ image, score, eligible }) => {
      if (!eligible || score < 2 || image.width < MIN_MAP_WIDTH || seen.has(image.pageUrl)) {
        return false;
      }
      seen.add(image.pageUrl);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_MAPS)
    .map(({ image }) => image);
}

export async function getAreaMedia(
  ctx: AppContext,
  playthroughId: string,
  options: { checkpointId?: string; locale: 'pt-BR' | 'en' },
): Promise<AreaMediaResponse> {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const checkpoint =
    loadMap(ctx.db, game.id)?.checkpoints.find(
      (row) => row.id === (options.checkpointId ?? playthrough.currentCheckpointId),
    ) ?? null;

  let maps: WikiImage[] = [];
  let mapsScope: AreaMediaResponse['mapsScope'] = null;
  let wiki: AreaMediaResponse['wiki'] = null;
  try {
    const site = await findWikiForGame(ctx, game.id);
    if (site) {
      wiki = { origin: 'wiki', url: site.articleBase, fetchedAt: ctx.now().toISOString() };
      if (checkpoint) {
        const found = [
          ...(await ctx.wiki.searchImages(site, `${checkpoint.name} map`)),
          ...(await ctx.wiki.getPageImages(site, checkpoint.name)),
        ];
        maps = pickMaps(found, checkpoint.name);
        if (maps.length > 0) mapsScope = 'area';
      }
      if (maps.length === 0) {
        // Nothing for the area: a map of the whole game still helps to get around.
        maps = pickMaps(await ctx.wiki.searchImages(site, `${game.title} map`), game.title, 'game');
        if (maps.length > 0) mapsScope = 'game';
      }
    }
  } catch {
    // The wiki is down or answered oddly: there are simply no maps to show right now.
    maps = [];
    mapsScope = null;
  }

  const subject = [game.title, checkpoint?.name].filter(Boolean).join(' ');
  const query = `${subject} ${VIDEO_WORD[options.locale] ?? 'walkthrough'}`;
  const found = await ctx.webSearch.search(`${query} youtube`, 8).catch(() => []);
  const videos = found
    .filter((item) => {
      try {
        const url = new URL(item.url);
        return VIDEO_HOST.test(url.host) && (url.pathname === '/watch' || url.host === 'youtu.be');
      } catch {
        return false;
      }
    })
    .slice(0, MAX_VIDEOS)
    .map((item) => ({ title: item.title, url: item.url }));

  return {
    checkpoint: checkpoint?.name ?? null,
    mapsScope,
    maps,
    wiki: maps.length > 0 ? wiki : null,
    videos,
    videoSearchUrl: `https://www.youtube.com/results?${new URLSearchParams({ search_query: query }).toString()}`,
  };
}
