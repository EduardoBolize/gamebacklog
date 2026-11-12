import {
  ACHIEVEMENT_SYNC_SOURCES,
  type AchievementSyncSource,
  type AddGameRequest,
  type AddGameResponse,
  type CatalogSearchResponse,
  type CreatePlaythroughRequest,
  type GameDetailResponse,
  type LibraryItem,
  type LibraryStatus,
  type Playthrough,
  type PlaythroughGoal,
  type PlaythroughStatus,
  type UpdateLibraryEntryRequest,
  type UpdatePlaythroughRequest,
} from '@gamebacklog/shared';
import { and, count, desc, eq, inArray, max } from 'drizzle-orm';
import { localDate, type AppContext } from '../context.ts';
import type { AppDatabase } from '../db/client.ts';
import {
  achievements,
  gameExternalIds,
  gameTimes,
  games,
  libraryEntries,
  playthroughs,
  progressEvents,
  reviews,
  sessions,
} from '../db/schema/index.ts';
import { goalMinutes } from '../stats/service.ts';
import { conflict, notFound } from '../errors.ts';
import type { CatalogGameData } from '../sources/types.ts';
import { pickEffectiveTimes, queueTimesRefresh } from './times.ts';

type PlaythroughRow = typeof playthroughs.$inferSelect;
/** `db` or an open transaction: anything that can run queries. */
type Queryable = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete'>;

export function toPlaythrough(row: PlaythroughRow): Playthrough {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    label: row.label,
    goal: row.goal,
    status: row.status,
    platform: row.platform,
    startedOn: row.startedOn,
    finishedOn: row.finishedOn,
    playtimeMinutes: row.playtimeMinutes,
  };
}

// --- Catalog -------------------------------------------------------------------

export async function searchCatalog(ctx: AppContext, text: string): Promise<CatalogSearchResponse> {
  if (!(await ctx.igdb.isConfigured())) return { configured: false, results: [] };
  const query = text.trim();
  if (query.length < 2) return { configured: true, results: [] };

  const { data } = await ctx.igdb.search(query);
  const externalIds = data.map((game) => game.externalId);
  const inLibrary =
    externalIds.length === 0
      ? []
      : ctx.db
          .select({ externalId: gameExternalIds.externalId, entryId: libraryEntries.id })
          .from(gameExternalIds)
          .innerJoin(libraryEntries, eq(libraryEntries.gameId, gameExternalIds.gameId))
          .where(
            and(
              eq(gameExternalIds.source, 'igdb'),
              inArray(gameExternalIds.externalId, externalIds),
            ),
          )
          .all();
  const entryByExternalId = new Map(inLibrary.map((row) => [row.externalId, row.entryId]));

  return {
    configured: true,
    results: data.map((game) => ({
      source: 'igdb',
      externalId: game.externalId,
      title: game.title,
      releaseYear: game.releaseYear,
      coverUrl: game.coverUrl,
      platforms: game.platforms,
      libraryEntryId: entryByExternalId.get(game.externalId) ?? null,
    })),
  };
}

/**
 * Stores a catalog game, or refreshes it when it already exists, and returns its ID.
 * The game is recognised by its IGDB ID or by any of its Steam app IDs.
 */
export function upsertCatalogGame(db: Queryable, data: CatalogGameData, fetchedAt: Date): string {
  const known = db
    .select({ gameId: gameExternalIds.gameId })
    .from(gameExternalIds)
    .where(and(eq(gameExternalIds.source, 'igdb'), eq(gameExternalIds.externalId, data.externalId)))
    .get();
  const knownBySteam =
    known || data.steamAppIds.length === 0
      ? undefined
      : db
          .select({ gameId: gameExternalIds.gameId })
          .from(gameExternalIds)
          .where(
            and(
              eq(gameExternalIds.source, 'steam'),
              inArray(gameExternalIds.externalId, data.steamAppIds),
            ),
          )
          .get();

  const metadata = {
    title: data.title,
    alternativeTitles: data.alternativeTitles,
    summary: data.summary,
    coverUrl: data.coverUrl,
    releaseDate: data.releaseDate,
    releaseYear: data.releaseYear,
    platforms: data.platforms,
    genres: data.genres,
    themes: data.themes,
    tags: data.tags,
    franchise: data.franchise,
    origin: 'igdb' as const,
    originUrl: data.url,
    fetchedAt,
  };

  let gameId = known?.gameId ?? knownBySteam?.gameId;
  if (gameId) {
    db.update(games).set(metadata).where(eq(games.id, gameId)).run();
  } else {
    gameId = db.insert(games).values(metadata).returning({ id: games.id }).get().id;
  }

  const links = [
    { gameId, source: 'igdb' as const, externalId: data.externalId, url: data.url },
    ...data.steamAppIds.map((appId) => ({
      gameId: gameId,
      source: 'steam' as const,
      externalId: appId,
      url: `https://store.steampowered.com/app/${appId}`,
    })),
  ];
  // "Do nothing" keeps a link the user corrected by hand.
  db.insert(gameExternalIds).values(links).onConflictDoNothing().run();
  return gameId;
}

// --- Library -------------------------------------------------------------------

const PLAYTHROUGH_STATUS_FOR: Record<LibraryStatus, PlaythroughStatus> = {
  playing: 'playing',
  backlog: 'not_started',
  wishlist: 'not_started',
  completed: 'completed',
  completed_100: 'completed',
  paused: 'paused',
  dropped: 'dropped',
};

/** Creates the library entry and its first playthrough. */
export function createLibraryEntry(
  db: Queryable,
  options: {
    gameId: string;
    status: LibraryStatus;
    platform: string | null;
    playtimeMinutes?: number;
    today: string;
  },
): string {
  const entryId = db
    .insert(libraryEntries)
    .values({ gameId: options.gameId, status: options.status, platform: options.platform })
    .returning({ id: libraryEntries.id })
    .get().id;

  const goal: PlaythroughGoal = options.status === 'completed_100' ? 'full_100' : 'finish';
  db.insert(playthroughs)
    .values({
      libraryEntryId: entryId,
      number: 1,
      goal,
      status: PLAYTHROUGH_STATUS_FOR[options.status],
      startedOn: options.status === 'playing' ? options.today : null,
      playtimeMinutes: options.playtimeMinutes ?? null,
    })
    .run();
  return entryId;
}

export async function addGame(ctx: AppContext, request: AddGameRequest): Promise<AddGameResponse> {
  let catalog: { data: CatalogGameData; fetchedAt: Date } | null = null;
  if (request.game.kind === 'igdb') {
    const found = await ctx.igdb.getById(request.game.externalId);
    if (!found) throw notFound('Catalog game');
    catalog = {
      data: found.data,
      fetchedAt: found.provenance.fetchedAt ? new Date(found.provenance.fetchedAt) : ctx.now(),
    };
  }

  const result = ctx.db.transaction((tx) => {
    let gameId: string;
    let platforms: string[];
    if (catalog) {
      gameId = upsertCatalogGame(tx, catalog.data, catalog.fetchedAt);
      platforms = catalog.data.platforms;
    } else if (request.game.kind === 'manual') {
      platforms = request.platform ? [request.platform] : [];
      gameId = tx
        .insert(games)
        .values({
          title: request.game.title,
          releaseYear: request.game.releaseYear ?? null,
          platforms,
          origin: 'manual',
        })
        .returning({ id: games.id })
        .get().id;
    } else {
      throw notFound('Catalog game');
    }

    const existing = tx
      .select({ id: libraryEntries.id })
      .from(libraryEntries)
      .where(eq(libraryEntries.gameId, gameId))
      .get();
    if (existing) return { libraryEntryId: existing.id, created: false, gameId };

    const platform = request.platform ?? (platforms.length === 1 ? (platforms[0] ?? null) : null);
    const libraryEntryId = createLibraryEntry(tx, {
      gameId,
      status: request.status,
      platform,
      today: localDate(ctx.now()),
    });
    return { libraryEntryId, created: true, gameId };
  });

  if (result.created) queueTimesRefresh(ctx, result.gameId);
  return { libraryEntryId: result.libraryEntryId, created: result.created };
}

/** Groups rows by a key, keeping their order. */
function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/** Keeps the latest instant per key. */
function latestBy(rows: { key: string; at: Date }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.key, Math.max(map.get(row.key) ?? 0, row.at.getTime()));
  return map;
}

const FINISHED: LibraryStatus[] = ['completed', 'completed_100'];
const SYNC_SOURCES = new Set<string>(ACHIEVEMENT_SYNC_SOURCES);

export function listLibrary(db: AppDatabase): LibraryItem[] {
  const rows = db
    .select({ entry: libraryEntries, game: games })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .orderBy(desc(libraryEntries.createdAt), libraryEntries.id)
    .all();

  const scores = new Map(
    db
      .select({ entryId: reviews.libraryEntryId, score: max(reviews.score) })
      .from(reviews)
      .groupBy(reviews.libraryEntryId)
      .all()
      .map((row) => [row.entryId, row.score]),
  );
  const timesByGame = groupBy(db.select().from(gameTimes).all(), (row) => row.gameId);
  const runRows = db
    .select()
    .from(playthroughs)
    .orderBy(playthroughs.number, playthroughs.id)
    .all();
  const runsByEntry = groupBy(runRows, (row) => row.libraryEntryId);
  const sessionRows = db
    .select({
      key: sessions.libraryEntryId,
      at: sessions.startedAt,
      minutes: sessions.durationMinutes,
    })
    .from(sessions)
    .all();
  const diaryMinutes = new Map<string, number>();
  for (const row of sessionRows)
    diaryMinutes.set(row.key, (diaryMinutes.get(row.key) ?? 0) + row.minutes);
  const lastSession = latestBy(sessionRows);
  const entryOfRun = new Map(runRows.map((run) => [run.id, run.libraryEntryId]));
  const lastReport = latestBy(
    db
      .select({ run: progressEvents.playthroughId, at: progressEvents.occurredAt })
      .from(progressEvents)
      .all()
      .flatMap((row) => {
        const key = entryOfRun.get(row.run);
        return key ? [{ key, at: row.at }] : [];
      }),
  );
  const achievementCounts = new Map(
    db
      .select({ gameId: achievements.gameId, total: count() })
      .from(achievements)
      .groupBy(achievements.gameId)
      .all()
      .map((row) => [row.gameId, row.total]),
  );
  const accountsByGame = groupBy(
    db
      .select({ gameId: gameExternalIds.gameId, source: gameExternalIds.source })
      .from(gameExternalIds)
      .orderBy(gameExternalIds.source)
      .all()
      .filter((row) => SYNC_SOURCES.has(row.source)),
    (row) => row.gameId,
  );

  return rows.map(({ entry, game }) => {
    const times = pickEffectiveTimes(timesByGame.get(game.id) ?? []);
    const runs = runsByEntry.get(entry.id) ?? [];
    const runMinutes = runs.reduce((sum, run) => sum + (run.playtimeMinutes ?? 0), 0);
    // Hours on the runs are the fuller record; the diary fills in when they have none.
    const playedMinutes = runMinutes > 0 ? runMinutes : (diaryMinutes.get(entry.id) ?? 0);
    const lastPlayed = Math.max(lastSession.get(entry.id) ?? 0, lastReport.get(entry.id) ?? 0);

    let progressPercent: number | null = null;
    if (FINISHED.includes(entry.status)) progressPercent = 100;
    else if (entry.status === 'playing') {
      const run = runs.findLast((candidate) => candidate.status === 'playing') ?? runs.at(-1);
      const goal = goalMinutes(times, run?.goal ?? 'finish');
      const played = run?.playtimeMinutes ?? playedMinutes;
      if (goal && goal > 0) progressPercent = Math.min(99, Math.round((played / goal) * 100));
    }

    return {
      id: entry.id,
      status: entry.status,
      platform: entry.platform,
      isFavorite: entry.isFavorite,
      tags: entry.tags,
      addedAt: entry.createdAt.toISOString(),
      game: {
        id: game.id,
        title: game.title,
        coverUrl: game.coverUrl,
        releaseYear: game.releaseYear,
        platforms: game.platforms,
        genres: game.genres,
      },
      score: scores.get(entry.id) ?? null,
      mainMinutes: times?.mainMinutes ?? null,
      playedMinutes,
      lastPlayedAt: lastPlayed > 0 ? new Date(lastPlayed).toISOString() : null,
      progressPercent,
      achievementCount: achievementCounts.get(game.id) ?? 0,
      accounts: (accountsByGame.get(game.id) ?? []).map(
        (row) => row.source as AchievementSyncSource,
      ),
    };
  });
}

export function requireEntry(db: Queryable, entryId: string) {
  const entry = db.select().from(libraryEntries).where(eq(libraryEntries.id, entryId)).get();
  if (!entry) throw notFound('Library entry');
  return entry;
}

export function requirePlaythrough(db: Queryable, playthroughId: string) {
  const row = db.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get();
  if (!row) throw notFound('Playthrough');
  return row;
}

export function listPlaythroughs(db: Queryable, entryId: string): PlaythroughRow[] {
  return db
    .select()
    .from(playthroughs)
    .where(eq(playthroughs.libraryEntryId, entryId))
    .orderBy(playthroughs.number)
    .all();
}

export function getGameDetail(db: AppDatabase, entryId: string): GameDetailResponse {
  const entry = requireEntry(db, entryId);
  const game = db.select().from(games).where(eq(games.id, entry.gameId)).get();
  if (!game) throw notFound('Game');

  return {
    entry: {
      id: entry.id,
      status: entry.status,
      platform: entry.platform,
      isFavorite: entry.isFavorite,
      tags: entry.tags,
    },
    game: {
      id: game.id,
      title: game.title,
      summary: game.summary,
      coverUrl: game.coverUrl,
      releaseDate: game.releaseDate,
      releaseYear: game.releaseYear,
      platforms: game.platforms,
      genres: game.genres,
      themes: game.themes,
      franchise: game.franchise,
      origin: game.origin,
      originUrl: game.originUrl,
      fetchedAt: game.fetchedAt?.toISOString() ?? null,
    },
    externalIds: db
      .select({
        source: gameExternalIds.source,
        externalId: gameExternalIds.externalId,
        url: gameExternalIds.url,
      })
      .from(gameExternalIds)
      .where(eq(gameExternalIds.gameId, game.id))
      .all(),
    times: pickEffectiveTimes(
      db.select().from(gameTimes).where(eq(gameTimes.gameId, game.id)).all(),
    ),
    playthroughs: listPlaythroughs(db, entry.id).map(toPlaythrough),
  };
}

/**
 * Keeps the latest playthrough in step with a new library status, so the user does not have to
 * say the same thing twice ("I finished it" on the game and again on the run).
 */
function alignLatestPlaythrough(
  db: Queryable,
  entryId: string,
  status: LibraryStatus,
  today: string,
) {
  const latest = listPlaythroughs(db, entryId).at(-1);
  if (!latest) return;

  let change: Partial<PlaythroughRow> | null = null;
  if (status === 'playing' && (latest.status === 'not_started' || latest.status === 'paused')) {
    change = { status: 'playing', startedOn: latest.startedOn ?? today };
  } else if (
    (status === 'completed' || status === 'completed_100') &&
    latest.status !== 'completed'
  ) {
    change = { status: 'completed', finishedOn: latest.finishedOn ?? today };
  } else if (status === 'paused' && latest.status === 'playing') {
    change = { status: 'paused' };
  } else if (status === 'dropped' && (latest.status === 'playing' || latest.status === 'paused')) {
    change = { status: 'dropped' };
  }
  if (change) db.update(playthroughs).set(change).where(eq(playthroughs.id, latest.id)).run();
}

export function updateLibraryEntry(
  ctx: AppContext,
  entryId: string,
  request: UpdateLibraryEntryRequest,
): GameDetailResponse {
  ctx.db.transaction((tx) => {
    const entry = requireEntry(tx, entryId);
    if (Object.keys(request).length > 0) {
      tx.update(libraryEntries).set(request).where(eq(libraryEntries.id, entryId)).run();
    }
    if (request.status && request.status !== entry.status) {
      alignLatestPlaythrough(tx, entryId, request.status, localDate(ctx.now()));
    }
  });
  return getGameDetail(ctx.db, entryId);
}

/** Removes the game from the library together with its runs, diary and reviews. */
export function removeLibraryEntry(db: AppDatabase, entryId: string): void {
  requireEntry(db, entryId);
  db.delete(libraryEntries).where(eq(libraryEntries.id, entryId)).run();
}

// --- Playthroughs ----------------------------------------------------------------

export function createPlaythrough(
  db: AppDatabase,
  entryId: string,
  request: CreatePlaythroughRequest,
): Playthrough {
  return db.transaction((tx) => {
    requireEntry(tx, entryId);
    const last = listPlaythroughs(tx, entryId).at(-1);
    const row = tx
      .insert(playthroughs)
      .values({
        libraryEntryId: entryId,
        number: (last?.number ?? 0) + 1,
        type: request.type,
        label: request.label ?? null,
        goal: request.goal,
      })
      .returning()
      .get();
    return toPlaythrough(row);
  });
}

export function updatePlaythrough(
  db: AppDatabase,
  playthroughId: string,
  request: UpdatePlaythroughRequest,
): Playthrough {
  requirePlaythrough(db, playthroughId);
  if (Object.keys(request).length > 0) {
    db.update(playthroughs).set(request).where(eq(playthroughs.id, playthroughId)).run();
  }
  return toPlaythrough(requirePlaythrough(db, playthroughId));
}

export function deletePlaythrough(db: AppDatabase, playthroughId: string): void {
  db.transaction((tx) => {
    const row = requirePlaythrough(tx, playthroughId);
    if (listPlaythroughs(tx, row.libraryEntryId).length <= 1) {
      throw conflict('last_playthrough', 'A game in the library keeps at least one playthrough');
    }
    tx.delete(playthroughs).where(eq(playthroughs.id, playthroughId)).run();
  });
}
