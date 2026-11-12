import type { Game, GameStatus, Genre, Platform } from './mock-library.ts';

export const SORTS = ['recent', 'name', 'hltb'] as const;
export type Sort = (typeof SORTS)[number];

export type StatusFilter = GameStatus | 'all';

/** Everything the sidebar can narrow the grid by. Each group combines with the others (AND). */
export interface Filters {
  query: string;
  status: StatusFilter;
  /** Any of these (OR); empty means every platform. */
  platforms: Platform[];
  /** Any of these (OR); empty means every genre. */
  genres: Genre[];
  sort: Sort;
  hideNeverOpened: boolean;
  onlyAchievements: boolean;
}

export const DEFAULT_FILTERS: Omit<Filters, 'status'> = {
  query: '',
  platforms: [],
  genres: [],
  sort: 'recent',
  hideNeverOpened: false,
  onlyAchievements: false,
};

/** Played within this many days counts as "recently played". */
export const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Case- and accent-insensitive, so "ragnarok" finds "Ragnarök". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : -Infinity);

function compare(sort: Sort, locale: string) {
  const byName = (a: Game, b: Game) =>
    a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id);
  switch (sort) {
    case 'name':
      return byName;
    case 'hltb':
      return (a: Game, b: Game) => a.hltbHours - b.hltbHours || byName(a, b);
    case 'recent':
      // Never-opened games go last.
      return (a: Game, b: Game) => time(b.lastPlayedAt) - time(a.lastPlayedAt) || byName(a, b);
  }
}

export function applyFilters(games: Game[], filters: Filters, locale: string): Game[] {
  const query = normalize(filters.query);
  return games
    .filter(
      (game) =>
        (!query || normalize(game.name).includes(query)) &&
        (filters.status === 'all' || game.status === filters.status) &&
        (filters.platforms.length === 0 || filters.platforms.includes(game.platform)) &&
        (filters.genres.length === 0 || game.genres.some((g) => filters.genres.includes(g))) &&
        !(filters.hideNeverOpened && game.platform === 'steam' && game.neverOpened) &&
        (!filters.onlyAchievements || game.hasAchievements),
    )
    .sort(compare(filters.sort, locale));
}

export function countBy<K extends string>(games: Game[], key: (game: Game) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const game of games) counts.set(key(game), (counts.get(key(game)) ?? 0) + 1);
  return counts;
}

export interface SideGroup {
  id: 'playing' | 'recent' | 'steam';
  games: Game[];
}

/** The game list of the sidebar: playing now, then recently played, then the rest of Steam. */
export function sideGroups(games: Game[], now = Date.now()): SideGroup[] {
  const sorted = [...games].sort(compare('recent', 'en'));
  const playing = sorted.filter((game) => game.status === 'playing');
  const recent = sorted.filter(
    (game) => game.status !== 'playing' && now - time(game.lastPlayedAt) <= RECENT_DAYS * DAY_MS,
  );
  const listed = new Set([...playing, ...recent].map((game) => game.id));
  const steam = sorted.filter((game) => game.platform === 'steam' && !listed.has(game.id));
  return [
    { id: 'playing', games: playing },
    { id: 'recent', games: recent },
    { id: 'steam', games: steam },
  ];
}

/** The cards of "Continue playing": the three playing games touched most recently. */
export function continuePlaying(games: Game[]): Game[] {
  return games
    .filter((game) => game.status === 'playing')
    .sort(compare('recent', 'en'))
    .slice(0, 3);
}
