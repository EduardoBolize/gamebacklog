import { LIBRARY_STATUSES, type LibraryItem, type LibraryStatus } from '@gamebacklog/shared';

/**
 * Filtering, sorting and grouping of the library screen. Pure functions over the list the
 * server sends; the filters live in the URL, so coming back from a game keeps them.
 */

export const SORTS = ['recent', 'added', 'title', 'release', 'score', 'time'] as const;
export type Sort = (typeof SORTS)[number];

/** Platforms are free text; the sidebar groups them into families. */
export const FAMILIES = ['pc', 'playstation', 'xbox', 'nintendo', 'other'] as const;
export type Family = (typeof FAMILIES)[number];

export type StatusFilter = LibraryStatus | 'all';

export interface Filters {
  query: string;
  status: StatusFilter;
  /** Any of these (OR); empty means every family. */
  families: Family[];
  /** Any of these (OR); empty means every genre. */
  genres: string[];
  sort: Sort;
  hideNeverOpened: boolean;
  onlyAchievements: boolean;
  onlyFavorites: boolean;
}

/** Played within this many days counts as "recently played". */
export const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function platformFamily(item: LibraryItem): Family {
  const platform = (item.platform ?? '').toLowerCase();
  if (/playstation|^ps ?\d|\bps vita\b|\bpsp\b/.test(platform)) return 'playstation';
  if (platform.includes('xbox')) return 'xbox';
  if (/nintendo|switch|\bwii\b|\b3ds\b|game ?boy|\bds\b/.test(platform)) return 'nintendo';
  if (/\bpc\b|windows|linux|mac|steam/.test(platform)) return 'pc';
  // No platform chosen yet: a game that came from Steam is a PC game.
  if (!item.platform && item.accounts.includes('steam')) return 'pc';
  return 'other';
}

/** Short platform name for the badge on the cover: "Steam", "PS5", "Switch 2"… */
export function platformBadge(item: LibraryItem): string | null {
  const family = platformFamily(item);
  const platform = item.platform ?? '';
  if (family === 'pc') return item.accounts.includes('steam') ? 'Steam' : 'PC';
  if (family === 'playstation') {
    const number = /playstation (\d)/i.exec(platform)?.[1];
    return number ? `PS${number}` : 'PlayStation';
  }
  if (family === 'xbox') return platform.replace(/^microsoft /i, '') || 'Xbox';
  if (family === 'nintendo') return platform.replace(/^nintendo /i, '') || 'Nintendo';
  return platform || null;
}

/** On Steam but never launched. */
export const neverOpened = (item: LibraryItem) =>
  item.accounts.includes('steam') && item.playedMinutes === 0;

/** Case- and accent-insensitive, so "ragnarok" finds "Ragnarök". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : -Infinity);

/** Missing values go last whatever the direction, so "no score" never tops a ranking. */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

function compare(sort: Sort, locale: string) {
  const byTitle = (a: LibraryItem, b: LibraryItem) =>
    a.game.title.localeCompare(b.game.title, locale, { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id);
  const byAdded = (a: LibraryItem, b: LibraryItem) =>
    b.addedAt.localeCompare(a.addedAt) || byTitle(a, b);
  switch (sort) {
    case 'title':
      return byTitle;
    case 'added':
      return byAdded;
    case 'release':
      return (a: LibraryItem, b: LibraryItem) =>
        compareNullable(a.game.releaseYear, b.game.releaseYear, -1) || byTitle(a, b);
    case 'score':
      return (a: LibraryItem, b: LibraryItem) =>
        compareNullable(a.score, b.score, -1) || byTitle(a, b);
    case 'time':
      return (a: LibraryItem, b: LibraryItem) =>
        compareNullable(a.mainMinutes, b.mainMinutes, 1) || byTitle(a, b);
    case 'recent':
      // Games never played go last, newest additions first.
      return (a: LibraryItem, b: LibraryItem) =>
        time(b.lastPlayedAt) - time(a.lastPlayedAt) || byAdded(a, b);
  }
}

/** Every filter except the status: the pill counts predict what a click shows. */
export function filterWithoutStatus(items: LibraryItem[], filters: Filters): LibraryItem[] {
  const query = normalize(filters.query);
  return items.filter(
    (item) =>
      (!query || normalize(item.game.title).includes(query)) &&
      (filters.families.length === 0 || filters.families.includes(platformFamily(item))) &&
      (filters.genres.length === 0 ||
        item.game.genres.some((genre) => filters.genres.includes(genre))) &&
      !(filters.hideNeverOpened && neverOpened(item)) &&
      (!filters.onlyAchievements || item.achievementCount > 0) &&
      (!filters.onlyFavorites || item.isFavorite),
  );
}

export function applyFilters(
  items: LibraryItem[],
  filters: Filters,
  locale: string,
): LibraryItem[] {
  return filterWithoutStatus(items, filters)
    .filter((item) => filters.status === 'all' || item.status === filters.status)
    .sort(compare(filters.sort, locale));
}

export function countBy<K>(items: LibraryItem[], key: (item: LibraryItem) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

/** Genres in the library, the most common first. */
export function genresByCount(items: LibraryItem[], locale: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const genre of item.game.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale));
}

export interface SideGroup {
  id: 'playing' | 'recent' | 'steam' | 'other';
  items: LibraryItem[];
}

/**
 * The game list of the sidebar: playing now, recently played, then the rest of Steam and the
 * rest of everything else, so every game is one click away.
 */
export function sideGroups(items: LibraryItem[], locale: string, now: number): SideGroup[] {
  const recentFirst = [...items].sort(compare('recent', locale));
  const playing = recentFirst.filter((item) => item.status === 'playing');
  const recent = recentFirst.filter(
    (item) => item.status !== 'playing' && now - time(item.lastPlayedAt) <= RECENT_DAYS * DAY_MS,
  );
  const listed = new Set([...playing, ...recent].map((item) => item.id));
  const rest = [...items]
    .filter((item) => !listed.has(item.id) && item.status !== 'wishlist')
    .sort(compare('title', locale));
  return [
    { id: 'playing', items: playing },
    { id: 'recent', items: recent },
    { id: 'steam', items: rest.filter((item) => item.accounts.includes('steam')) },
    { id: 'other', items: rest.filter((item) => !item.accounts.includes('steam')) },
  ];
}

/** The cards of "Continue playing": the three playing games touched most recently. */
export function continuePlaying(items: LibraryItem[], locale: string): LibraryItem[] {
  return items
    .filter((item) => item.status === 'playing')
    .sort(compare('recent', locale))
    .slice(0, 3);
}

// --- URL -------------------------------------------------------------------------------------

const isStatus = (value: string | null): value is LibraryStatus =>
  LIBRARY_STATUSES.some((status) => status === value);

export function readFilters(params: URLSearchParams): Filters {
  const status = params.get('status');
  return {
    query: params.get('q') ?? '',
    status: isStatus(status) ? status : 'all',
    families: params
      .getAll('platform')
      .filter((value): value is Family => FAMILIES.some((family) => family === value)),
    genres: params.getAll('genre'),
    sort: SORTS.find((sort) => sort === params.get('sort')) ?? 'recent',
    hideNeverOpened: params.get('hide') === '1',
    onlyAchievements: params.get('ach') === '1',
    onlyFavorites: params.get('fav') === '1',
  };
}

/** Writes the filters back over `params`, leaving anything else (the view) as it was. */
export function writeFilters(params: URLSearchParams, filters: Filters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of ['q', 'status', 'platform', 'genre', 'sort', 'hide', 'ach', 'fav']) {
    next.delete(name);
  }
  if (filters.query) next.set('q', filters.query);
  if (filters.status !== 'all') next.set('status', filters.status);
  for (const family of filters.families) next.append('platform', family);
  for (const genre of filters.genres) next.append('genre', genre);
  if (filters.sort !== 'recent') next.set('sort', filters.sort);
  if (filters.hideNeverOpened) next.set('hide', '1');
  if (filters.onlyAchievements) next.set('ach', '1');
  if (filters.onlyFavorites) next.set('fav', '1');
  return next;
}
