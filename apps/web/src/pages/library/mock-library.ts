import type { LibraryStatus } from '@gamebacklog/shared';

/**
 * Mock data for the library screen. Everything the screen shows comes from this file, so
 * swapping it for the local API later touches nothing else.
 */

/** The statuses this screen shows; "Platinado" is the app's `completed_100`. */
export const MOCK_STATUSES = ['playing', 'backlog', 'completed', 'completed_100'] as const;
export type GameStatus = Extract<LibraryStatus, (typeof MOCK_STATUSES)[number]>;

export const PLATFORMS = ['steam', 'ps5', 'switch', 'xbox', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const GENRES = [
  'rpg',
  'action',
  'metroidvania',
  'roguelike',
  'jrpg',
  'adventure',
  'simulation',
  'platformer',
] as const;
export type Genre = (typeof GENRES)[number];

export interface Game {
  id: string;
  name: string;
  platform: Platform;
  genres: Genre[];
  status: GameStatus;
  hoursPlayed: number;
  /** Main + extras time on HowLongToBeat, in hours. */
  hltbHours: number;
  /** 0–100. */
  progress: number;
  /** ISO instant; null when the game was never opened. */
  lastPlayedAt: string | null;
  /** Cover image; while there is none, the cover is a block of `coverColor` with the name. */
  coverUrl?: string;
  coverColor: string;
  /** Owned on Steam but never launched. */
  neverOpened: boolean;
  hasAchievements: boolean;
}

export interface SyncState {
  platform: 'steam';
  syncedAt: string;
}

export interface Profile {
  name: string;
  initials: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const daysAgo = (days: number) => ago(days * DAY_MS);

type Seed = Omit<Game, 'id' | 'neverOpened' | 'hasAchievements'> &
  Partial<Pick<Game, 'neverOpened' | 'hasAchievements'>>;

const seeds: Seed[] = [
  {
    name: "Baldur's Gate 3",
    platform: 'steam',
    genres: ['rpg', 'adventure'],
    status: 'playing',
    hoursPlayed: 74,
    hltbHours: 118,
    progress: 62,
    lastPlayedAt: ago(2 * 60 * 60 * 1000),
    coverColor: '#4a2a1f',
  },
  {
    name: 'Hades II',
    platform: 'steam',
    genres: ['action', 'roguelike'],
    status: 'playing',
    hoursPlayed: 31,
    hltbHours: 45,
    progress: 48,
    lastPlayedAt: daysAgo(1),
    coverColor: '#3d1f4f',
  },
  {
    name: 'Stardew Valley',
    platform: 'steam',
    genres: ['simulation', 'rpg'],
    status: 'playing',
    hoursPlayed: 112,
    hltbHours: 95,
    progress: 81,
    lastPlayedAt: daysAgo(1.5),
    coverColor: '#2b4a2a',
  },
  {
    name: 'Balatro',
    platform: 'steam',
    genres: ['roguelike'],
    status: 'playing',
    hoursPlayed: 22,
    hltbHours: 30,
    progress: 35,
    lastPlayedAt: daysAgo(2),
    coverColor: '#5a1f2c',
  },
  {
    name: 'Elden Ring',
    platform: 'steam',
    genres: ['rpg', 'action'],
    status: 'completed',
    hoursPlayed: 96,
    hltbHours: 100,
    progress: 100,
    lastPlayedAt: daysAgo(5),
    coverColor: '#3b3420',
  },
  {
    name: 'Hollow Knight',
    platform: 'steam',
    genres: ['metroidvania', 'action', 'platformer'],
    status: 'completed_100',
    hoursPlayed: 64,
    hltbHours: 63,
    progress: 100,
    lastPlayedAt: daysAgo(40),
    coverColor: '#2a2050',
  },
  {
    name: 'The Witcher 3',
    platform: 'steam',
    genres: ['rpg', 'adventure'],
    status: 'completed_100',
    hoursPlayed: 140,
    hltbHours: 173,
    progress: 100,
    lastPlayedAt: daysAgo(60),
    coverColor: '#2d3a2a',
  },
  {
    name: 'Red Dead Redemption 2',
    platform: 'steam',
    genres: ['action', 'adventure'],
    status: 'completed',
    hoursPlayed: 81,
    hltbHours: 83,
    progress: 100,
    lastPlayedAt: daysAgo(90),
    coverColor: '#5a2a1a',
  },
  {
    name: 'Outer Wilds',
    platform: 'steam',
    genres: ['adventure'],
    status: 'completed',
    hoursPlayed: 24,
    hltbHours: 22,
    progress: 100,
    lastPlayedAt: daysAgo(120),
    coverColor: '#4a3a12',
  },
  {
    name: 'Cyberpunk 2077',
    platform: 'steam',
    genres: ['rpg', 'action'],
    status: 'backlog',
    hoursPlayed: 3,
    hltbHours: 60,
    progress: 0,
    lastPlayedAt: daysAgo(150),
    coverColor: '#4a4413',
  },
  {
    name: 'Sekiro',
    platform: 'steam',
    genres: ['action', 'adventure'],
    status: 'backlog',
    hoursPlayed: 0,
    hltbHours: 40,
    progress: 0,
    lastPlayedAt: null,
    coverColor: '#4f1d1d',
    neverOpened: true,
  },
  {
    name: 'Disco Elysium',
    platform: 'steam',
    genres: ['rpg'],
    status: 'backlog',
    hoursPlayed: 0,
    hltbHours: 33,
    progress: 0,
    lastPlayedAt: null,
    coverColor: '#2f2a45',
    neverOpened: true,
  },
  {
    name: 'Metaphor: ReFantazio',
    platform: 'steam',
    genres: ['jrpg', 'rpg'],
    status: 'backlog',
    hoursPlayed: 0,
    hltbHours: 80,
    progress: 0,
    lastPlayedAt: null,
    coverColor: '#1d3b3a',
    neverOpened: true,
  },
  {
    name: 'God of War Ragnarök',
    platform: 'ps5',
    genres: ['action', 'adventure'],
    status: 'completed',
    hoursPlayed: 38,
    hltbHours: 40,
    progress: 100,
    lastPlayedAt: daysAgo(200),
    coverColor: '#3a1f4a',
  },
  {
    name: 'Persona 5 Royal',
    platform: 'ps5',
    genres: ['jrpg', 'rpg'],
    status: 'backlog',
    hoursPlayed: 0,
    hltbHours: 103,
    progress: 0,
    lastPlayedAt: null,
    coverColor: '#5c1414',
  },
  {
    name: 'Celeste',
    platform: 'switch',
    genres: ['platformer'],
    status: 'completed_100',
    hoursPlayed: 19,
    hltbHours: 38,
    progress: 100,
    lastPlayedAt: daysAgo(300),
    coverColor: '#3a2350',
    // Nintendo has no achievement system.
    hasAchievements: false,
  },
  {
    name: 'Zelda: Tears of the Kingdom',
    platform: 'switch',
    genres: ['adventure', 'action'],
    status: 'completed',
    hoursPlayed: 88,
    hltbHours: 98,
    progress: 100,
    lastPlayedAt: daysAgo(400),
    coverColor: '#21413a',
    hasAchievements: false,
  },
  {
    name: 'Death Stranding',
    platform: 'steam',
    genres: ['action', 'adventure'],
    status: 'backlog',
    hoursPlayed: 6,
    hltbHours: 55,
    progress: 0,
    lastPlayedAt: daysAgo(500),
    coverColor: '#33283f',
  },
];

export const mockGames: Game[] = seeds.map((seed, index) => ({
  neverOpened: false,
  hasAchievements: true,
  ...seed,
  id: `mock-${String(index + 1).padStart(2, '0')}`,
}));

export const mockSync: SyncState = { platform: 'steam', syncedAt: ago(12 * 60 * 1000) };

export const mockProfile: Profile = { name: 'Eduardo', initials: 'EB' };
