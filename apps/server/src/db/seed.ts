import type { AppDatabase } from './client.ts';
import {
  achievementProgress,
  achievements,
  chapterMaps,
  checkpoints,
  collectibleProgress,
  collectibles,
  gameExternalIds,
  gameTimes,
  games,
  libraryEntries,
  playthroughs,
  progressEvents,
  reviews,
  sessions,
} from './schema/index.ts';

/**
 * Example data for development and demos.
 *
 * Every row has a fixed ID and is inserted with "on conflict do nothing", so running the seed
 * twice changes nothing and never overwrites edits. Times, percentages and scores are
 * illustrative, not fetched from any source — hence `origin: 'manual'`.
 */

const hours = (value: number) => Math.round(value * 60);
const at = (iso: string) => new Date(iso);

const GAME = {
  ocarina: 'seed-game-ocarina-of-time',
  hollowKnight: 'seed-game-hollow-knight',
  darkSouls: 'seed-game-dark-souls-remastered',
  celeste: 'seed-game-celeste',
  hades: 'seed-game-hades',
  metroidPrime: 'seed-game-metroid-prime-remastered',
} as const;

const ENTRY = {
  ocarina: 'seed-entry-ocarina-of-time',
  hollowKnight: 'seed-entry-hollow-knight',
  darkSouls: 'seed-entry-dark-souls-remastered',
  celeste: 'seed-entry-celeste',
  hades: 'seed-entry-hades',
  metroidPrime: 'seed-entry-metroid-prime-remastered',
} as const;

const RUN = {
  ocarina: 'seed-run-ocarina-1',
  hollowKnight: 'seed-run-hollow-knight-1',
  darkSoulsFirst: 'seed-run-dark-souls-1',
  darkSoulsNgPlus: 'seed-run-dark-souls-2',
  celeste: 'seed-run-celeste-1',
} as const;

const OCARINA_MAP = 'seed-map-ocarina-of-time';
const CHECKPOINT = {
  kokiriForest: 'seed-checkpoint-ocarina-1',
  dekuTree: 'seed-checkpoint-ocarina-2',
  hyruleField: 'seed-checkpoint-ocarina-3',
  dodongosCavern: 'seed-checkpoint-ocarina-4',
} as const;

const ACHIEVEMENT = {
  ringTheBell: 'seed-achievement-dark-souls-ring-the-bell',
  toLinkTheFire: 'seed-achievement-dark-souls-to-link-the-fire',
  knightsHonor: 'seed-achievement-dark-souls-knights-honor',
} as const;

const COLLECTIBLE = {
  dekuSkulltula1: 'seed-collectible-ocarina-deku-skulltula-1',
  dekuSkulltula2: 'seed-collectible-ocarina-deku-skulltula-2',
} as const;

/**
 * The rest of the example library: enough finished, rated and dropped games for the taste
 * profile to mean something, and a backlog for the recommendations to rank.
 */
interface ExtraGame {
  slug: string;
  title: string;
  year: number;
  platforms: string[];
  genres: string[];
  themes: string[];
  tags: string[];
  franchise?: string;
  status: 'completed' | 'completed_100' | 'dropped' | 'backlog';
  /** Platform the example user plays it on. */
  platform: string;
  score?: number;
  favorite?: boolean;
  /** Main story and completionist times, in hours. */
  times?: [main: number, completionist: number];
  playedHours?: number;
}

const PC = 'PC';
const PS4 = 'PlayStation 4';
const SWITCH = 'Nintendo Switch';
const RPG = 'Role-playing (RPG)';

const EXTRA_GAMES: ExtraGame[] = [
  {
    slug: 'bloodborne',
    title: 'Bloodborne',
    year: 2015,
    platforms: [PS4],
    genres: [RPG],
    themes: ['Action', 'Horror'],
    tags: ['soulslike', 'boss fights', 'gothic'],
    status: 'completed',
    platform: PS4,
    score: 9.5,
    times: [33, 76],
    playedHours: 41,
  },
  {
    slug: 'elden-ring',
    title: 'Elden Ring',
    year: 2022,
    platforms: [PC, 'PlayStation 5', 'Xbox Series X|S'],
    genres: [RPG, 'Adventure'],
    themes: ['Fantasy', 'Action', 'Open world'],
    tags: ['soulslike', 'open world', 'boss fights'],
    franchise: 'Elden Ring',
    status: 'completed_100',
    platform: PC,
    score: 10,
    favorite: true,
    times: [60, 133],
    playedHours: 142,
  },
  {
    slug: 'sekiro',
    title: 'Sekiro: Shadows Die Twice',
    year: 2019,
    platforms: [PC, PS4, 'Xbox One'],
    genres: ['Adventure'],
    themes: ['Action', 'Historical'],
    tags: ['soulslike', 'stealth', 'boss fights'],
    status: 'completed',
    platform: PC,
    score: 8.5,
    times: [30, 70],
    playedHours: 38,
  },
  {
    slug: 'super-metroid',
    title: 'Super Metroid',
    year: 1994,
    platforms: ['Super Nintendo Entertainment System'],
    genres: ['Platform', 'Adventure', 'Shooter'],
    themes: ['Science fiction'],
    tags: ['metroidvania', 'exploration'],
    franchise: 'Metroid',
    status: 'completed',
    platform: 'Super Nintendo Entertainment System',
    score: 9,
    times: [8, 10],
    playedHours: 9,
  },
  {
    slug: 'ori-and-the-blind-forest',
    title: 'Ori and the Blind Forest',
    year: 2015,
    platforms: [PC, 'Xbox One', SWITCH],
    genres: ['Platform', 'Adventure'],
    themes: ['Fantasy'],
    tags: ['metroidvania', 'precision platformer'],
    franchise: 'Ori',
    status: 'completed',
    platform: PC,
    score: 8.5,
    times: [8, 12],
    playedHours: 10,
  },
  {
    slug: 'the-witcher-3',
    title: 'The Witcher 3: Wild Hunt',
    year: 2015,
    platforms: [PC, PS4, 'Xbox One', SWITCH],
    genres: [RPG, 'Adventure'],
    themes: ['Fantasy', 'Open world'],
    tags: ['open world', 'story rich', 'choices matter'],
    franchise: 'The Witcher',
    status: 'completed',
    platform: PC,
    score: 9,
    times: [52, 174],
    playedHours: 88,
  },
  {
    slug: 'persona-5-royal',
    title: 'Persona 5 Royal',
    year: 2020,
    platforms: [PS4, PC, SWITCH],
    genres: [RPG],
    themes: ['Fantasy'],
    tags: ['jrpg', 'turn-based', 'social simulation'],
    franchise: 'Persona',
    status: 'dropped',
    platform: PS4,
    score: 5.5,
    times: [101, 143],
    playedHours: 20,
  },
  {
    slug: 'final-fantasy-vii-remake',
    title: 'Final Fantasy VII Remake',
    year: 2020,
    platforms: [PS4, PC],
    genres: [RPG],
    themes: ['Fantasy', 'Science fiction'],
    tags: ['jrpg', 'story rich'],
    franchise: 'Final Fantasy',
    status: 'completed',
    platform: PS4,
    score: 7,
    times: [33, 87],
    playedHours: 36,
  },
  {
    slug: 'stardew-valley',
    title: 'Stardew Valley',
    year: 2016,
    platforms: [PC, SWITCH, PS4, 'Xbox One'],
    genres: ['Simulator', RPG, 'Indie'],
    themes: ['Sandbox'],
    tags: ['farming', 'life simulation'],
    status: 'dropped',
    platform: SWITCH,
    score: 4,
    times: [53, 170],
    playedHours: 6,
  },
  {
    slug: 'civilization-vi',
    title: "Sid Meier's Civilization VI",
    year: 2016,
    platforms: [PC],
    genres: ['Strategy', 'Turn-based strategy (TBS)'],
    themes: ['Historical'],
    tags: ['turn-based', '4x'],
    franchise: 'Civilization',
    status: 'dropped',
    platform: PC,
    score: 3.5,
    playedHours: 5,
  },
  {
    slug: 'portal-2',
    title: 'Portal 2',
    year: 2011,
    platforms: [PC],
    genres: ['Puzzle', 'Platform', 'Shooter'],
    themes: ['Science fiction', 'Comedy'],
    tags: ['puzzles', 'first person'],
    franchise: 'Portal',
    status: 'completed',
    platform: PC,
    score: 9,
    times: [8.5, 21],
    playedHours: 10,
  },
  {
    slug: 'disco-elysium',
    title: 'Disco Elysium',
    year: 2019,
    platforms: [PC],
    genres: [RPG],
    themes: ['Mystery'],
    tags: ['story rich', 'choices matter', 'isometric'],
    status: 'completed',
    platform: PC,
    score: 8,
    times: [23, 47],
    playedHours: 27,
  },
  {
    slug: 'forza-horizon-5',
    title: 'Forza Horizon 5',
    year: 2021,
    platforms: [PC, 'Xbox Series X|S'],
    genres: ['Racing'],
    themes: ['Open world'],
    tags: ['open world', 'driving'],
    franchise: 'Forza',
    status: 'dropped',
    platform: PC,
    score: 5,
    playedHours: 7,
  },
  {
    slug: 'dead-cells',
    title: 'Dead Cells',
    year: 2018,
    platforms: [PC, SWITCH, PS4, 'Xbox One'],
    genres: ['Platform', 'Indie'],
    themes: ['Action', 'Fantasy'],
    tags: ['roguelike', 'metroidvania'],
    status: 'completed',
    platform: SWITCH,
    score: 8,
    times: [14, 90],
    playedHours: 31,
  },
  {
    slug: 'god-of-war',
    title: 'God of War',
    year: 2018,
    platforms: [PS4, PC],
    genres: ['Adventure', RPG],
    themes: ['Action', 'Fantasy'],
    tags: ['story rich', 'boss fights'],
    franchise: 'God of War',
    status: 'completed',
    platform: PS4,
    score: 8.5,
    times: [21, 51],
    playedHours: 26,
  },
  {
    slug: 'lies-of-p',
    title: 'Lies of P',
    year: 2023,
    platforms: [PC, 'PlayStation 5', 'Xbox Series X|S'],
    genres: [RPG],
    themes: ['Action', 'Fantasy'],
    tags: ['soulslike', 'boss fights'],
    status: 'backlog',
    platform: PC,
    times: [29, 61],
  },
  {
    slug: 'blasphemous',
    title: 'Blasphemous',
    year: 2019,
    platforms: [PC, SWITCH, PS4, 'Xbox One'],
    genres: ['Platform', 'Adventure', 'Indie'],
    themes: ['Action', 'Horror'],
    tags: ['metroidvania', 'soulslike'],
    franchise: 'Blasphemous',
    status: 'backlog',
    platform: SWITCH,
    times: [13, 22],
  },
  {
    slug: 'hollow-knight-silksong',
    title: 'Hollow Knight: Silksong',
    year: 2025,
    platforms: [PC, SWITCH, 'PlayStation 5', 'Xbox Series X|S'],
    genres: ['Platform', 'Adventure'],
    themes: ['Fantasy'],
    tags: ['metroidvania', 'exploration', 'boss fights'],
    franchise: 'Hollow Knight',
    status: 'backlog',
    platform: PC,
  },
  {
    slug: 'slay-the-spire',
    title: 'Slay the Spire',
    year: 2019,
    platforms: [PC, SWITCH, PS4],
    genres: ['Strategy', 'Card & Board Game', 'Indie'],
    themes: ['Fantasy'],
    tags: ['roguelike', 'turn-based', 'deckbuilder'],
    status: 'backlog',
    platform: PC,
    times: [12, 100],
  },
  {
    slug: 'cities-skylines',
    title: 'Cities: Skylines',
    year: 2015,
    platforms: [PC],
    genres: ['Simulator', 'Strategy'],
    themes: ['Sandbox'],
    tags: ['city builder'],
    status: 'backlog',
    platform: PC,
  },
  {
    slug: 'football-manager-2024',
    title: 'Football Manager 2024',
    year: 2023,
    platforms: [PC],
    genres: ['Sport', 'Simulator', 'Strategy'],
    themes: [],
    tags: ['management'],
    franchise: 'Football Manager',
    status: 'backlog',
    platform: PC,
  },
];

const EXTRA_RUN_STATUS = {
  completed: 'completed',
  completed_100: 'completed',
  dropped: 'dropped',
  backlog: 'not_started',
} as const;

export function seedDatabase(db: AppDatabase): void {
  db.transaction((tx) => {
    tx.insert(games)
      .values([
        {
          id: GAME.ocarina,
          title: 'The Legend of Zelda: Ocarina of Time',
          summary: 'Action-adventure across Hyrule, as a child and as an adult.',
          releaseDate: '1998-11-21',
          releaseYear: 1998,
          platforms: ['Nintendo 64'],
          genres: ['Adventure'],
          themes: ['Fantasy'],
          tags: ['dungeons', 'puzzles'],
          franchise: 'The Legend of Zelda',
          origin: 'manual',
        },
        {
          id: GAME.hollowKnight,
          title: 'Hollow Knight',
          summary: 'Hand-drawn metroidvania set in the ruined kingdom of Hallownest.',
          releaseDate: '2017-02-24',
          releaseYear: 2017,
          platforms: ['PC', 'Nintendo Switch', 'PlayStation 4', 'Xbox One'],
          genres: ['Platform', 'Adventure'],
          themes: ['Fantasy'],
          tags: ['metroidvania', 'exploration', 'boss fights'],
          franchise: 'Hollow Knight',
          origin: 'manual',
        },
        {
          id: GAME.darkSouls,
          title: 'Dark Souls: Remastered',
          summary: 'Action RPG in the interconnected, unforgiving land of Lordran.',
          releaseDate: '2018-05-24',
          releaseYear: 2018,
          platforms: ['PC', 'PlayStation 4', 'Xbox One', 'Nintendo Switch'],
          genres: ['Role-playing (RPG)'],
          themes: ['Fantasy', 'Action'],
          tags: ['soulslike', 'boss fights', 'new game plus'],
          franchise: 'Dark Souls',
          origin: 'manual',
        },
        {
          id: GAME.celeste,
          title: 'Celeste',
          summary: 'Precision platformer about climbing a mountain.',
          releaseDate: '2018-01-25',
          releaseYear: 2018,
          platforms: ['PC', 'Nintendo Switch', 'PlayStation 4', 'Xbox One'],
          genres: ['Platform'],
          themes: ['Fantasy'],
          tags: ['precision platformer', 'collectibles'],
          origin: 'manual',
        },
        {
          id: GAME.hades,
          title: 'Hades',
          summary: 'Roguelike dungeon crawler about escaping the Underworld.',
          releaseDate: '2020-09-17',
          releaseYear: 2020,
          platforms: ['PC', 'Nintendo Switch', 'PlayStation 5', 'Xbox Series X|S'],
          genres: ['Role-playing (RPG)', 'Indie'],
          themes: ['Fantasy', 'Action'],
          tags: ['roguelike', 'isometric'],
          franchise: 'Hades',
          origin: 'manual',
        },
        {
          id: GAME.metroidPrime,
          title: 'Metroid Prime Remastered',
          summary: 'First-person adventure on the planet Tallon IV.',
          releaseDate: '2023-02-08',
          releaseYear: 2023,
          platforms: ['Nintendo Switch'],
          genres: ['Shooter', 'Adventure'],
          themes: ['Science fiction'],
          tags: ['metroidvania', 'exploration'],
          franchise: 'Metroid',
          origin: 'manual',
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(gameExternalIds)
      .values([
        { gameId: GAME.hollowKnight, source: 'steam', externalId: '367520' },
        { gameId: GAME.darkSouls, source: 'steam', externalId: '570940' },
        { gameId: GAME.celeste, source: 'steam', externalId: '504230' },
        { gameId: GAME.hades, source: 'steam', externalId: '1145360' },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(gameTimes)
      .values([
        {
          id: 'seed-times-ocarina-of-time',
          gameId: GAME.ocarina,
          origin: 'manual',
          mainMinutes: hours(27),
          mainExtraMinutes: hours(31),
          completionistMinutes: hours(38),
        },
        {
          id: 'seed-times-hollow-knight',
          gameId: GAME.hollowKnight,
          origin: 'manual',
          mainMinutes: hours(27),
          mainExtraMinutes: hours(41),
          completionistMinutes: hours(64),
        },
        {
          id: 'seed-times-dark-souls-remastered',
          gameId: GAME.darkSouls,
          origin: 'manual',
          mainMinutes: hours(30),
          mainExtraMinutes: hours(46),
          completionistMinutes: hours(70),
        },
        {
          id: 'seed-times-celeste',
          gameId: GAME.celeste,
          origin: 'manual',
          mainMinutes: hours(8),
          mainExtraMinutes: hours(13),
          completionistMinutes: hours(38),
        },
        {
          id: 'seed-times-hades',
          gameId: GAME.hades,
          origin: 'manual',
          mainMinutes: hours(22),
          mainExtraMinutes: hours(47),
          completionistMinutes: hours(95),
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(chapterMaps)
      .values({ id: OCARINA_MAP, gameId: GAME.ocarina, origin: 'manual' })
      .onConflictDoNothing()
      .run();

    tx.insert(checkpoints)
      .values([
        {
          id: CHECKPOINT.kokiriForest,
          chapterMapId: OCARINA_MAP,
          position: 1,
          name: 'Kokiri Forest',
          aliases: ['Floresta Kokiri'],
          origin: 'manual',
        },
        {
          id: CHECKPOINT.dekuTree,
          chapterMapId: OCARINA_MAP,
          position: 2,
          name: 'Inside the Deku Tree',
          aliases: ['Deku Tree', 'Great Deku Tree', 'Árvore Deku'],
          origin: 'manual',
        },
        {
          id: CHECKPOINT.hyruleField,
          chapterMapId: OCARINA_MAP,
          position: 3,
          name: 'Hyrule Field and Castle Town',
          aliases: ['Hyrule Field', 'Hyrule Castle', 'Campo de Hyrule'],
          origin: 'manual',
        },
        {
          id: CHECKPOINT.dodongosCavern,
          chapterMapId: OCARINA_MAP,
          position: 4,
          name: "Dodongo's Cavern",
          aliases: ['Death Mountain', 'Caverna Dodongo'],
          origin: 'manual',
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(libraryEntries)
      .values([
        {
          id: ENTRY.ocarina,
          gameId: GAME.ocarina,
          status: 'playing',
          platform: 'Nintendo 64',
          isFavorite: true,
          tags: ['retro'],
        },
        { id: ENTRY.hollowKnight, gameId: GAME.hollowKnight, status: 'completed', platform: 'PC' },
        {
          id: ENTRY.darkSouls,
          gameId: GAME.darkSouls,
          status: 'playing',
          platform: 'PC',
          isFavorite: true,
        },
        { id: ENTRY.celeste, gameId: GAME.celeste, status: 'paused', platform: 'Nintendo Switch' },
        { id: ENTRY.hades, gameId: GAME.hades, status: 'backlog', platform: 'PC' },
        {
          id: ENTRY.metroidPrime,
          gameId: GAME.metroidPrime,
          status: 'wishlist',
          platform: 'Nintendo Switch',
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(playthroughs)
      .values([
        {
          id: RUN.ocarina,
          libraryEntryId: ENTRY.ocarina,
          number: 1,
          goal: 'full_100',
          status: 'playing',
          startedOn: '2026-10-28',
          playtimeMinutes: hours(2.5),
          currentCheckpointId: CHECKPOINT.dekuTree,
        },
        {
          id: RUN.hollowKnight,
          libraryEntryId: ENTRY.hollowKnight,
          number: 1,
          goal: 'finish',
          status: 'completed',
          startedOn: '2026-03-02',
          finishedOn: '2026-04-11',
          playtimeMinutes: hours(34),
        },
        {
          id: RUN.darkSoulsFirst,
          libraryEntryId: ENTRY.darkSouls,
          number: 1,
          goal: 'finish',
          status: 'completed',
          startedOn: '2026-05-04',
          finishedOn: '2026-06-20',
          playtimeMinutes: hours(52),
        },
        {
          id: RUN.darkSoulsNgPlus,
          libraryEntryId: ENTRY.darkSouls,
          number: 2,
          type: 'ng_plus',
          goal: 'all_achievements',
          status: 'playing',
          startedOn: '2026-09-15',
          playtimeMinutes: hours(9),
        },
        {
          id: RUN.celeste,
          libraryEntryId: ENTRY.celeste,
          number: 1,
          goal: 'finish',
          status: 'paused',
          startedOn: '2026-07-10',
          playtimeMinutes: hours(4),
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(progressEvents)
      .values({
        id: 'seed-progress-ocarina-1',
        playthroughId: RUN.ocarina,
        rawText: 'acabei de entrar na Árvore Deku',
        checkpointId: CHECKPOINT.dekuTree,
        resolvedBy: 'manual',
        occurredAt: at('2026-10-29T21:40:00.000Z'),
      })
      .onConflictDoNothing()
      .run();

    tx.insert(sessions)
      .values([
        {
          id: 'seed-session-ocarina-1',
          libraryEntryId: ENTRY.ocarina,
          playthroughId: RUN.ocarina,
          startedAt: at('2026-10-28T22:00:00.000Z'),
          durationMinutes: 80,
          note: 'Peguei a espada e o escudo na Floresta Kokiri.',
        },
        {
          id: 'seed-session-ocarina-2',
          libraryEntryId: ENTRY.ocarina,
          playthroughId: RUN.ocarina,
          startedAt: at('2026-10-29T20:30:00.000Z'),
          durationMinutes: 70,
          note: 'Entrei na Árvore Deku.',
        },
        {
          id: 'seed-session-dark-souls-1',
          libraryEntryId: ENTRY.darkSouls,
          playthroughId: RUN.darkSoulsNgPlus,
          startedAt: at('2026-09-15T19:00:00.000Z'),
          durationMinutes: 120,
          origin: 'steam',
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(reviews)
      .values([
        {
          id: 'seed-review-hollow-knight',
          libraryEntryId: ENTRY.hollowKnight,
          playthroughId: RUN.hollowKnight,
          score: 9.5,
          difficultyScore: 8,
          storyScore: 8.5,
          gameplayScore: 9.5,
          levelDesignScore: 10,
          soundtrackScore: 9.5,
          visualsScore: 9.5,
          perceivedLengthScore: 8,
          body: 'Um mapa enorme que recompensa cada desvio.',
          pros: ['Exploração', 'Trilha sonora', 'Chefes'],
          cons: ['Começo lento'],
          timeToBeatMinutes: hours(34),
          reviewedAt: at('2026-04-12T15:00:00.000Z'),
        },
        {
          id: 'seed-review-dark-souls-first-run',
          libraryEntryId: ENTRY.darkSouls,
          playthroughId: RUN.darkSoulsFirst,
          score: 9,
          difficultyScore: 9,
          storyScore: 8,
          gameplayScore: 9,
          levelDesignScore: 9.5,
          soundtrackScore: 8,
          visualsScore: 7.5,
          perceivedLengthScore: 8.5,
          body: 'A primeira metade tem o melhor level design que já joguei.',
          pros: ['Mundo interconectado', 'Chefes memoráveis'],
          cons: ['Segunda metade irregular'],
          hasSpoilers: false,
          timeToBeatMinutes: hours(52),
          reviewedAt: at('2026-06-21T18:00:00.000Z'),
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(achievements)
      .values([
        {
          id: ACHIEVEMENT.ringTheBell,
          gameId: GAME.darkSouls,
          origin: 'manual',
          name: 'Ring the Bell (Undead Church)',
          description: 'Ring the first Bell of Awakening.',
          globalPercent: 60,
          isStory: true,
          classifiedBy: 'user',
          sortOrder: 1,
        },
        {
          id: ACHIEVEMENT.toLinkTheFire,
          gameId: GAME.darkSouls,
          origin: 'manual',
          name: 'To Link the Fire',
          description: 'Reach the "To Link the Fire" ending.',
          globalPercent: 20,
          isStory: true,
          isMissable: true,
          classifiedBy: 'user',
          sortOrder: 2,
        },
        {
          id: ACHIEVEMENT.knightsHonor,
          gameId: GAME.darkSouls,
          origin: 'manual',
          name: "Knight's Honor",
          description: 'Acquire all rare weapons.',
          globalPercent: 5,
          isMissable: true,
          isNgPlus: true,
          classifiedBy: 'user',
          sortOrder: 3,
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(achievementProgress)
      .values([
        {
          playthroughId: RUN.darkSoulsFirst,
          achievementId: ACHIEVEMENT.ringTheBell,
          isUnlocked: true,
          unlockedAt: at('2026-05-10T20:00:00.000Z'),
        },
        {
          playthroughId: RUN.darkSoulsFirst,
          achievementId: ACHIEVEMENT.toLinkTheFire,
          isUnlocked: true,
          unlockedAt: at('2026-06-20T22:30:00.000Z'),
        },
        {
          playthroughId: RUN.darkSoulsNgPlus,
          achievementId: ACHIEVEMENT.knightsHonor,
          isUnlocked: false,
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(collectibles)
      .values([
        {
          id: COLLECTIBLE.dekuSkulltula1,
          gameId: GAME.ocarina,
          checkpointId: CHECKPOINT.dekuTree,
          name: 'Gold Skulltula (Deku Tree) #1',
          category: 'Gold Skulltula',
          sortOrder: 1,
          origin: 'manual',
        },
        {
          id: COLLECTIBLE.dekuSkulltula2,
          gameId: GAME.ocarina,
          checkpointId: CHECKPOINT.dekuTree,
          name: 'Gold Skulltula (Deku Tree) #2',
          category: 'Gold Skulltula',
          sortOrder: 2,
          origin: 'manual',
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(collectibleProgress)
      .values({
        playthroughId: RUN.ocarina,
        collectibleId: COLLECTIBLE.dekuSkulltula1,
        isCollected: true,
        collectedAt: at('2026-10-29T21:55:00.000Z'),
      })
      .onConflictDoNothing()
      .run();

    for (const extra of EXTRA_GAMES) {
      const gameId = `seed-game-${extra.slug}`;
      const entryId = `seed-entry-${extra.slug}`;
      const runId = `seed-run-${extra.slug}-1`;
      const finished = extra.status === 'completed' || extra.status === 'completed_100';

      tx.insert(games)
        .values({
          id: gameId,
          title: extra.title,
          releaseYear: extra.year,
          platforms: extra.platforms,
          genres: extra.genres,
          themes: extra.themes,
          tags: extra.tags,
          franchise: extra.franchise ?? null,
          origin: 'manual',
        })
        .onConflictDoNothing()
        .run();
      if (extra.times) {
        tx.insert(gameTimes)
          .values({
            id: `seed-times-${extra.slug}`,
            gameId,
            origin: 'manual',
            mainMinutes: hours(extra.times[0]),
            completionistMinutes: hours(extra.times[1]),
          })
          .onConflictDoNothing()
          .run();
      }
      tx.insert(libraryEntries)
        .values({
          id: entryId,
          gameId,
          status: extra.status,
          platform: extra.platform,
          isFavorite: extra.favorite ?? false,
        })
        .onConflictDoNothing()
        .run();
      tx.insert(playthroughs)
        .values({
          id: runId,
          libraryEntryId: entryId,
          number: 1,
          goal: extra.status === 'completed_100' ? 'full_100' : 'finish',
          status: EXTRA_RUN_STATUS[extra.status],
          playtimeMinutes: extra.playedHours === undefined ? null : hours(extra.playedHours),
        })
        .onConflictDoNothing()
        .run();
      if (extra.score !== undefined) {
        tx.insert(reviews)
          .values({
            id: `seed-review-${extra.slug}`,
            libraryEntryId: entryId,
            playthroughId: runId,
            score: extra.score,
            timeToBeatMinutes:
              finished && extra.playedHours !== undefined ? hours(extra.playedHours) : null,
            reviewedAt: at('2026-08-01T12:00:00.000Z'),
          })
          .onConflictDoNothing()
          .run();
      }
    }
  });
}
