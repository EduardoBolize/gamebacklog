import type { GameTimes, SetManualTimesRequest } from '@gamebacklog/shared';
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import type { AppDatabase } from '../db/client.ts';
import { gameExternalIds, gameTimes, games } from '../db/schema/index.ts';

type TimesRow = typeof gameTimes.$inferSelect;

const hasAnyTime = (row: TimesRow) =>
  row.mainMinutes !== null || row.mainExtraMinutes !== null || row.completionistMinutes !== null;

function toContract(row: TimesRow): GameTimes {
  return {
    origin: row.origin,
    mainMinutes: row.mainMinutes,
    mainExtraMinutes: row.mainExtraMinutes,
    completionistMinutes: row.completionistMinutes,
    originUrl: row.originUrl,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
  };
}

/** The times to show: what the user typed wins over HowLongToBeat. */
export function pickEffectiveTimes(rows: TimesRow[]): GameTimes | null {
  const manual = rows.find((row) => row.origin === 'manual' && hasAnyTime(row));
  const hltb = rows.find((row) => row.origin === 'hltb' && hasAnyTime(row));
  const chosen = manual ?? hltb;
  return chosen ? toContract(chosen) : null;
}

export function getEffectiveTimes(db: AppDatabase, gameId: string): GameTimes | null {
  return pickEffectiveTimes(db.select().from(gameTimes).where(eq(gameTimes.gameId, gameId)).all());
}

function upsertTimes(
  db: AppDatabase,
  values: Pick<
    typeof gameTimes.$inferInsert,
    | 'gameId'
    | 'origin'
    | 'mainMinutes'
    | 'mainExtraMinutes'
    | 'completionistMinutes'
    | 'originUrl'
    | 'fetchedAt'
  >,
): void {
  db.insert(gameTimes)
    .values(values)
    .onConflictDoUpdate({
      target: [gameTimes.gameId, gameTimes.origin],
      set: { ...values, updatedAt: new Date() },
    })
    .run();
}

/** Saves the user's own times. All-null clears the override, so HLTB shows again. */
export function setManualTimes(
  db: AppDatabase,
  gameId: string,
  request: SetManualTimesRequest,
): GameTimes | null {
  const isEmpty =
    request.mainMinutes === null &&
    request.mainExtraMinutes === null &&
    request.completionistMinutes === null;
  if (isEmpty) {
    db.delete(gameTimes)
      .where(and(eq(gameTimes.gameId, gameId), eq(gameTimes.origin, 'manual')))
      .run();
  } else {
    upsertTimes(db, { gameId, origin: 'manual', ...request, originUrl: null, fetchedAt: null });
  }
  return getEffectiveTimes(db, gameId);
}

/**
 * Asks HowLongToBeat for the game's times and stores them.
 * Throws `SourceError` when the source fails; the caller decides whether that matters.
 */
export async function refreshTimesFromHltb(
  ctx: AppContext,
  gameId: string,
): Promise<GameTimes | null> {
  const game = ctx.db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) return null;

  const found = await ctx.hltb.findTimes({
    title: game.title,
    alternativeTitles: game.alternativeTitles,
    releaseYear: game.releaseYear,
  });
  if (found) {
    const fetchedAt = found.provenance.fetchedAt ? new Date(found.provenance.fetchedAt) : ctx.now();
    upsertTimes(ctx.db, {
      gameId,
      origin: 'hltb',
      mainMinutes: found.data.mainMinutes,
      mainExtraMinutes: found.data.mainExtraMinutes,
      completionistMinutes: found.data.completionistMinutes,
      originUrl: found.data.url,
      fetchedAt,
    });
    ctx.db
      .insert(gameExternalIds)
      .values({ gameId, source: 'hltb', externalId: found.data.externalId, url: found.data.url })
      .onConflictDoNothing()
      .run();
  }
  return getEffectiveTimes(ctx.db, gameId);
}

/**
 * Fetches times in the background. Never awaited by a request and never throws:
 * the UI must not wait for, or break because of, HowLongToBeat.
 */
export function queueTimesRefresh(ctx: AppContext, gameId: string): void {
  void refreshTimesFromHltb(ctx, gameId).catch(() => undefined);
}
