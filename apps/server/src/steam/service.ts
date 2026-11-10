import type {
  LibraryStatus,
  SteamImportPreviewResponse,
  SteamImportRequest,
  SteamImportResponse,
  SteamSyncResponse,
} from '@gamebacklog/shared';
import { eq } from 'drizzle-orm';
import { listSteamLinkedEntries } from '../achievements/service.ts';
import { localDate, type AppContext } from '../context.ts';
import { gameExternalIds, games, playthroughs, sessions } from '../db/schema/index.ts';
import { addPlaytime } from '../library/journal.ts';
import { createLibraryEntry, listPlaythroughs, upsertCatalogGame } from '../library/service.ts';
import { queueTimesRefresh } from '../library/times.ts';
import { SETTINGS, getSetting, setSetting } from '../settings/store.ts';
import { SourceError } from '../sources/adapter.ts';
import { cleanTitle } from '../sources/hltb/index.ts';
import type { CatalogGameData } from '../sources/types.ts';

/** Asks the catalog which games these Steam apps are. Without a catalog, nothing matches. */
async function matchCatalog(ctx: AppContext, appIds: string[]) {
  if (appIds.length === 0 || !(await ctx.igdb.isConfigured())) {
    return {
      available: await ctx.igdb.isConfigured(),
      matches: new Map<string, CatalogGameData>(),
    };
  }
  try {
    return { available: true, matches: await ctx.igdb.findBySteamAppIds(appIds) };
  } catch (error) {
    // The import still works with Steam's own names when the catalog is down.
    if (!(error instanceof SourceError)) throw error;
    return { available: false, matches: new Map<string, CatalogGameData>() };
  }
}

/** Lists the user's Steam library with what an import would do. Writes nothing. */
export async function previewSteamImport(ctx: AppContext): Promise<SteamImportPreviewResponse> {
  const owned = await ctx.steam.getOwnedGames();
  const { available, matches } = await matchCatalog(
    ctx,
    owned.map((game) => game.appId),
  );
  const entryByApp = new Map(listSteamLinkedEntries(ctx.db).map((row) => [row.appId, row.entryId]));

  return {
    catalogAvailable: available,
    items: owned
      .map((game) => {
        const match = matches.get(game.appId);
        const playedRecently = game.playtimeTwoWeeksMinutes > 0;
        // Steam cannot tell whether a game was finished, so the suggestion stops at "playing".
        const suggestedStatus: LibraryStatus = playedRecently ? 'playing' : 'backlog';
        return {
          appId: game.appId,
          name: game.name,
          playtimeMinutes: game.playtimeMinutes,
          playedRecently,
          match: match
            ? {
                externalId: match.externalId,
                title: match.title,
                releaseYear: match.releaseYear,
                coverUrl: match.coverUrl,
              }
            : null,
          libraryEntryId: entryByApp.get(game.appId) ?? null,
          suggestedStatus,
        };
      })
      .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes),
  };
}

/** Imports the chosen Steam games. Games already in the library only get their hours refreshed. */
export async function importFromSteam(
  ctx: AppContext,
  request: SteamImportRequest,
): Promise<SteamImportResponse> {
  const owned = new Map((await ctx.steam.getOwnedGames()).map((game) => [game.appId, game]));
  const wanted = request.items.filter((item) => owned.has(item.appId));
  const { matches } = await matchCatalog(
    ctx,
    wanted.map((item) => item.appId),
  );
  const fetchedAt = ctx.now();
  const newGameIds: string[] = [];

  const result = ctx.db.transaction((tx) => {
    const entryByApp = new Map(
      listSteamLinkedEntries(ctx.db).map((row) => [row.appId, row.entryId]),
    );
    const baselines = { ...getSetting(ctx.db, SETTINGS.steamPlaytime) };
    let imported = 0;
    let updated = 0;

    for (const item of wanted) {
      const game = owned.get(item.appId);
      if (!game) continue;

      const existingEntryId = entryByApp.get(item.appId);
      if (existingEntryId) {
        const latest = listPlaythroughs(tx, existingEntryId).at(-1);
        if (latest && latest.playtimeMinutes === null) {
          tx.update(playthroughs)
            .set({ playtimeMinutes: game.playtimeMinutes })
            .where(eq(playthroughs.id, latest.id))
            .run();
        }
        baselines[item.appId] = game.playtimeMinutes;
        updated++;
        continue;
      }

      const match = matches.get(item.appId);
      let gameId: string;
      if (match) {
        gameId = upsertCatalogGame(tx, match, fetchedAt);
      } else {
        gameId = tx
          .insert(games)
          .values({
            title: cleanTitle(game.name),
            platforms: ['PC'],
            origin: 'steam',
            originUrl: `https://store.steampowered.com/app/${item.appId}`,
            fetchedAt,
          })
          .returning({ id: games.id })
          .get().id;
      }
      tx.insert(gameExternalIds)
        .values({
          gameId,
          source: 'steam',
          externalId: item.appId,
          url: `https://store.steampowered.com/app/${item.appId}`,
        })
        .onConflictDoNothing()
        .run();

      const entryId = createLibraryEntry(tx, {
        gameId,
        status: item.status,
        platform: 'PC',
        playtimeMinutes: game.playtimeMinutes,
        today: localDate(fetchedAt),
      });
      entryByApp.set(item.appId, entryId);
      baselines[item.appId] = game.playtimeMinutes;
      newGameIds.push(gameId);
      imported++;
    }

    setSetting(ctx.db, SETTINGS.steamPlaytime, baselines);
    return { imported, updated };
  });

  // The HLTB adapter rate-limits itself, so a big import trickles out in the background.
  for (const gameId of newGameIds) queueTimesRefresh(ctx, gameId);
  return { ...result, skipped: request.items.length - result.imported - result.updated };
}

/**
 * Compares Steam's hours with the last sync. Every game whose hours grew gets an automatic
 * session for the difference, logged against the run in progress.
 */
export async function syncSteamPlaytime(ctx: AppContext): Promise<SteamSyncResponse> {
  const owned = new Map((await ctx.steam.getOwnedGames()).map((game) => [game.appId, game]));
  const syncedAt = ctx.now();

  const sessionsCreated = ctx.db.transaction((tx) => {
    const baselines = { ...getSetting(ctx.db, SETTINGS.steamPlaytime) };
    let created = 0;

    for (const link of listSteamLinkedEntries(ctx.db)) {
      const game = owned.get(link.appId);
      if (!game) continue;
      const baseline = baselines[link.appId];
      baselines[link.appId] = game.playtimeMinutes;
      // First time we see this game: there is no "before" to compare with.
      if (baseline === undefined) continue;

      const delta = game.playtimeMinutes - baseline;
      if (delta <= 0) continue;

      const runs = listPlaythroughs(tx, link.entryId);
      const run = runs.findLast((candidate) => candidate.status === 'playing') ?? runs.at(-1);
      tx.insert(sessions)
        .values({
          libraryEntryId: link.entryId,
          playthroughId: run?.id ?? null,
          startedAt: syncedAt,
          durationMinutes: delta,
          origin: 'steam',
        })
        .run();
      addPlaytime(tx, run?.id ?? null, delta);
      created++;
    }

    setSetting(ctx.db, SETTINGS.steamPlaytime, baselines);
    setSetting(ctx.db, SETTINGS.steamLastSyncAt, syncedAt.toISOString());
    return created;
  });

  return { sessionsCreated, syncedAt: syncedAt.toISOString() };
}
