import type {
  ConsoleImportRequest,
  ConsolePlatform,
  LibraryStatus,
  SteamImportPreviewResponse,
  SteamImportResponse,
} from '@gamebacklog/shared';
import { and, eq } from 'drizzle-orm';
import { localDate, type AppContext } from '../context.ts';
import { gameExternalIds, games, libraryEntries, playthroughs } from '../db/schema/index.ts';
import { createLibraryEntry, listPlaythroughs, upsertCatalogGame } from '../library/service.ts';
import { queueTimesRefresh } from '../library/times.ts';
import { SourceError } from '../sources/adapter.ts';
import { cleanTitle } from '../sources/hltb/index.ts';
import type { CatalogGameData, ConsoleGame, ConsoleSource } from '../sources/types.ts';

/**
 * Importing the library of a console account (PSN, Xbox). It mirrors the Steam import: a
 * preview that writes nothing, then an import of what the user ticked.
 */

const DAY = 24 * 60 * 60 * 1000;
const RECENT_MS = 14 * DAY;

export const consoleSource = (ctx: AppContext, platform: ConsolePlatform): ConsoleSource =>
  platform === 'psn' ? ctx.psn : ctx.xbox;

/** Lowercase letters and digits only, so "Marvel's Spider-Man™ 2" equals "Marvels Spider Man 2". */
const titleKey = (title: string) =>
  cleanTitle(title)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

function linkedEntries(ctx: AppContext, platform: ConsolePlatform): Map<string, string> {
  const rows = ctx.db
    .select({ entryId: libraryEntries.id, externalId: gameExternalIds.externalId })
    .from(libraryEntries)
    .innerJoin(
      gameExternalIds,
      and(eq(gameExternalIds.gameId, libraryEntries.gameId), eq(gameExternalIds.source, platform)),
    )
    .all();
  return new Map(rows.map((row) => [row.externalId, row.entryId]));
}

function suggestStatus(game: ConsoleGame, now: Date): LibraryStatus {
  if (game.progressPercent === 100) return 'completed_100';
  const last = game.lastPlayedAt ? new Date(game.lastPlayedAt).getTime() : null;
  if (last !== null && now.getTime() - last <= RECENT_MS) return 'playing';
  // Started at some point and left: the console cannot tell a finished game from a paused one.
  return (game.progressPercent ?? 0) > 0 ? 'paused' : 'backlog';
}

/** Lists the account's games with what an import would do. Writes nothing. */
export async function previewConsoleImport(
  ctx: AppContext,
  platform: ConsolePlatform,
): Promise<SteamImportPreviewResponse> {
  const owned = await consoleSource(ctx, platform).getGames();
  const linked = linkedEntries(ctx, platform);
  const now = ctx.now();
  return {
    catalogAvailable: await ctx.igdb.isConfigured(),
    items: owned.map((game) => {
      const status = suggestStatus(game, now);
      return {
        appId: game.titleId,
        name: game.name,
        playtimeMinutes: game.playtimeMinutes ?? 0,
        playedRecently: status === 'playing',
        // Matching to the catalog costs a search per game, so it waits for the import itself.
        match: null,
        detail: game.platform,
        libraryEntryId: linked.get(game.titleId) ?? null,
        suggestedStatus: status,
      };
    }),
  };
}

/**
 * Finds the catalog game a console title is. A console only gives a name, so the match has to
 * be exact after cleaning; when several games share it, the one released on that console wins.
 */
async function findInCatalog(ctx: AppContext, game: ConsoleGame): Promise<CatalogGameData | null> {
  const wanted = titleKey(game.name);
  if (!wanted) return null;
  const { data } = await ctx.igdb.search(cleanTitle(game.name));
  const sameTitle = data.filter(
    (candidate) =>
      titleKey(candidate.title) === wanted ||
      candidate.alternativeTitles.some((title) => titleKey(title) === wanted),
  );
  const family = game.platform.split(' ')[0]?.toLowerCase() ?? '';
  return (
    sameTitle.find((candidate) =>
      candidate.platforms.some((name) => name.toLowerCase().includes(family)),
    ) ??
    sameTitle[0] ??
    null
  );
}

/** Imports the chosen games. Games already in the library are linked instead of duplicated. */
export async function importFromConsole(
  ctx: AppContext,
  platform: ConsolePlatform,
  request: ConsoleImportRequest,
): Promise<SteamImportResponse> {
  const owned = new Map(
    (await consoleSource(ctx, platform).getGames()).map((game) => [game.titleId, game]),
  );
  const wanted = request.items.flatMap((item) => {
    const game = owned.get(item.appId);
    return game ? [{ game, status: item.status }] : [];
  });

  // The catalog is asked before any write, one game at a time (its own rate limit applies).
  const matches = new Map<string, CatalogGameData>();
  if (await ctx.igdb.isConfigured()) {
    for (const { game } of wanted) {
      try {
        const match = await findInCatalog(ctx, game);
        if (match) matches.set(game.titleId, match);
      } catch (error) {
        // The catalog went down mid-import: the rest comes in with the console's own names.
        if (!(error instanceof SourceError)) throw error;
        break;
      }
    }
  }

  const fetchedAt = ctx.now();
  const newGameIds: string[] = [];
  const result = ctx.db.transaction((tx) => {
    const linked = linkedEntries(ctx, platform);
    const libraryByTitle = new Map(
      tx
        .select({ gameId: games.id, title: games.title, entryId: libraryEntries.id })
        .from(libraryEntries)
        .innerJoin(games, eq(games.id, libraryEntries.gameId))
        .all()
        .map((row) => [titleKey(row.title), row]),
    );
    let imported = 0;
    let updated = 0;

    for (const { game, status } of wanted) {
      const link = (gameId: string) =>
        tx
          .insert(gameExternalIds)
          .values({ gameId, source: platform, externalId: game.titleId })
          .onConflictDoNothing()
          .run();
      const refreshHours = (entryId: string) => {
        const latest = listPlaythroughs(tx, entryId).at(-1);
        if (
          latest &&
          game.playtimeMinutes &&
          (latest.playtimeMinutes ?? 0) < game.playtimeMinutes
        ) {
          tx.update(playthroughs)
            .set({ playtimeMinutes: game.playtimeMinutes })
            .where(eq(playthroughs.id, latest.id))
            .run();
        }
      };

      const known = linked.get(game.titleId);
      if (known) {
        refreshHours(known);
        updated++;
        continue;
      }

      const match = matches.get(game.titleId);
      const gameId = match
        ? upsertCatalogGame(tx, match, fetchedAt)
        : (libraryByTitle.get(titleKey(game.name))?.gameId ??
          tx
            .insert(games)
            .values({
              title: cleanTitle(game.name),
              coverUrl: game.coverUrl,
              platforms: [game.platform],
              origin: platform,
              fetchedAt,
            })
            .returning({ id: games.id })
            .get().id);
      link(gameId);

      // The same game may already be here, from Steam or added by hand: link it, do not copy it.
      const existing = tx
        .select({ id: libraryEntries.id })
        .from(libraryEntries)
        .where(eq(libraryEntries.gameId, gameId))
        .get();
      if (existing) {
        linked.set(game.titleId, existing.id);
        updated++;
        continue;
      }

      const entryId = createLibraryEntry(tx, {
        gameId,
        status,
        platform: game.platform,
        playtimeMinutes: game.playtimeMinutes ?? undefined,
        today: localDate(fetchedAt),
      });
      linked.set(game.titleId, entryId);
      libraryByTitle.set(titleKey(game.name), { gameId, title: game.name, entryId });
      newGameIds.push(gameId);
      imported++;
    }
    return { imported, updated };
  });

  for (const gameId of newGameIds) queueTimesRefresh(ctx, gameId);
  return { ...result, skipped: request.items.length - result.imported - result.updated };
}
