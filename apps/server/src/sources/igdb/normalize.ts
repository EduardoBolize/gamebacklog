import type { CatalogGameData } from '../types.ts';
import { IGDB_STEAM_SOURCE_ID, type IgdbGame } from './schema.ts';

const MAX_TAGS = 30;

const names = (items: { name: string }[] | undefined) => (items ?? []).map((item) => item.name);

/** `t_cover_big` is 264x374, close to the 3:4 the library grid uses. `_2x` is the retina variant. */
export function igdbCoverUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${imageId}.jpg`;
}

export function normalizeIgdbGame(raw: IgdbGame): CatalogGameData {
  const released = raw.first_release_date ? new Date(raw.first_release_date * 1000) : null;
  const steamAppIds = (raw.external_games ?? [])
    .filter((external) => external.external_game_source === IGDB_STEAM_SOURCE_ID && external.uid)
    .map((external) => external.uid as string);

  return {
    externalId: String(raw.id),
    title: raw.name,
    alternativeTitles: names(raw.alternative_names),
    summary: raw.summary ?? null,
    coverUrl: raw.cover ? igdbCoverUrl(raw.cover.image_id) : null,
    releaseDate: released ? released.toISOString().slice(0, 10) : null,
    releaseYear: released ? released.getUTCFullYear() : null,
    platforms: names(raw.platforms),
    genres: names(raw.genres),
    themes: names(raw.themes),
    tags: names(raw.keywords).slice(0, MAX_TAGS),
    franchise:
      raw.franchise?.name ?? raw.franchises?.[0]?.name ?? raw.collections?.[0]?.name ?? null,
    url: raw.url ?? null,
    steamAppIds: [...new Set(steamAppIds)],
  };
}
