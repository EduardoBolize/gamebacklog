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
  });
}
