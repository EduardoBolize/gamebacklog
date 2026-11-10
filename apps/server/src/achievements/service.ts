import type {
  Achievement,
  AchievementListResponse,
  AchievementSyncResponse,
  ClassifyAchievementRequest,
  FunnelResponse,
} from '@gamebacklog/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import type { AppDatabase } from '../db/client.ts';
import {
  achievementProgress,
  achievements,
  gameExternalIds,
  libraryEntries,
} from '../db/schema/index.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { listPlaythroughs, requireEntry, requirePlaythrough } from '../library/service.ts';
import { getEffectiveTimes } from '../library/times.ts';
import { computeFunnel } from './funnel.ts';
import { looksLikeNewGamePlus, looksLikeStory } from './heuristics.ts';

type AchievementRow = typeof achievements.$inferSelect;

export function steamAppIdForGame(db: AppDatabase, gameId: string): string | null {
  const link = db
    .select({ externalId: gameExternalIds.externalId })
    .from(gameExternalIds)
    .where(and(eq(gameExternalIds.gameId, gameId), eq(gameExternalIds.source, 'steam')))
    .get();
  return link?.externalId ?? null;
}

function gameIdOfPlaythrough(db: AppDatabase, playthroughId: string) {
  const playthrough = requirePlaythrough(db, playthroughId);
  const entry = requireEntry(db, playthrough.libraryEntryId);
  return { playthrough, entry, gameId: entry.gameId };
}

/**
 * Fetches the achievement catalog, the global percentages and the player's unlocks from Steam.
 * Flags the user classified by hand are never overwritten.
 */
export async function syncAchievementsFromSteam(
  ctx: AppContext,
  entryId: string,
): Promise<AchievementSyncResponse> {
  const { db } = ctx;
  const entry = requireEntry(db, entryId);
  const appId = steamAppIdForGame(db, entry.gameId);
  if (!appId) throw conflict('no_steam_app', 'This game is not linked to a Steam app');

  const [schema, percentages, player] = await Promise.all([
    ctx.steam.getAchievementSchema(appId),
    ctx.steam.getGlobalPercentages(appId),
    ctx.steam.getPlayerAchievements(appId),
  ]);
  const fetchedAt = schema.provenance.fetchedAt ? new Date(schema.provenance.fetchedAt) : ctx.now();

  return db.transaction((tx) => {
    const existing = new Map(
      tx
        .select()
        .from(achievements)
        .where(and(eq(achievements.gameId, entry.gameId), eq(achievements.origin, 'steam')))
        .all()
        .map((row) => [row.externalId, row]),
    );

    const idByApiName = new Map<string, string>();
    schema.data.forEach((definition, index) => {
      const known = existing.get(definition.apiName);
      const catalog = {
        name: definition.name,
        description: definition.description,
        iconUrl: definition.iconUrl,
        globalPercent: percentages[definition.apiName] ?? null,
        isHidden: definition.isHidden,
        sortOrder: index,
        originUrl: schema.provenance.url ?? null,
        fetchedAt,
      };
      const guess =
        known?.classifiedBy === 'user'
          ? {}
          : {
              isStory: looksLikeStory(definition),
              isNgPlus: looksLikeNewGamePlus(definition),
              classifiedBy: 'heuristic' as const,
            };

      if (known) {
        tx.update(achievements)
          .set({ ...catalog, ...guess })
          .where(eq(achievements.id, known.id))
          .run();
        idByApiName.set(definition.apiName, known.id);
      } else {
        const created = tx
          .insert(achievements)
          .values({
            gameId: entry.gameId,
            origin: 'steam',
            externalId: definition.apiName,
            ...catalog,
            ...guess,
          })
          .returning({ id: achievements.id })
          .get();
        idByApiName.set(definition.apiName, created.id);
      }
    });

    let unlocked = 0;
    if (player) {
      const runs = listPlaythroughs(tx, entryId);
      const runIds = runs.map((run) => run.id);
      const alreadyUnlocked = new Set(
        runIds.length === 0
          ? []
          : tx
              .select({ achievementId: achievementProgress.achievementId })
              .from(achievementProgress)
              .where(
                and(
                  inArray(achievementProgress.playthroughId, runIds),
                  eq(achievementProgress.isUnlocked, true),
                ),
              )
              .all()
              .map((row) => row.achievementId),
      );

      for (const item of player) {
        const achievementId = idByApiName.get(item.apiName);
        if (!item.isUnlocked || !achievementId) continue;
        unlocked++;
        if (alreadyUnlocked.has(achievementId)) continue;

        // Steam unlocks belong to the account; credit the run that was going on at the time.
        const unlockDay = item.unlockedAt?.toISOString().slice(0, 10);
        const run =
          (unlockDay
            ? runs.findLast((candidate) => candidate.startedOn && candidate.startedOn <= unlockDay)
            : undefined) ?? runs[0];
        if (!run) continue;

        const values = {
          playthroughId: run.id,
          achievementId,
          isUnlocked: true,
          unlockedAt: item.unlockedAt,
          origin: 'steam' as const,
        };
        tx.insert(achievementProgress)
          .values(values)
          .onConflictDoUpdate({
            target: [achievementProgress.playthroughId, achievementProgress.achievementId],
            set: values,
          })
          .run();
      }
    }

    return { total: schema.data.length, unlocked, playerDataAvailable: player !== null };
  });
}

function toAchievement(
  row: AchievementRow,
  progress: { isUnlocked: boolean; unlockedAt: Date | null } | undefined,
): Achievement {
  return {
    id: row.id,
    origin: row.origin,
    name: row.name,
    description: row.description,
    iconUrl: row.iconUrl,
    globalPercent: row.globalPercent,
    isHidden: row.isHidden,
    isMissable: row.isMissable,
    isStory: row.isStory,
    isNgPlus: row.isNgPlus,
    classifiedBy: row.classifiedBy,
    isUnlocked: progress?.isUnlocked ?? false,
    unlockedAt: progress?.isUnlocked ? (progress.unlockedAt?.toISOString() ?? null) : null,
  };
}

function loadAchievements(db: AppDatabase, gameId: string, playthroughId: string) {
  const rows = db.select().from(achievements).where(eq(achievements.gameId, gameId)).all();
  const progress = new Map(
    db
      .select()
      .from(achievementProgress)
      .where(eq(achievementProgress.playthroughId, playthroughId))
      .all()
      .map((row) => [row.achievementId, row]),
  );
  // Most common first; achievements without a percentage go last, in catalog order.
  rows.sort(
    (a, b) =>
      (b.globalPercent ?? -1) - (a.globalPercent ?? -1) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
  return rows.map((row) => toAchievement(row, progress.get(row.id)));
}

export function listAchievements(db: AppDatabase, playthroughId: string): AchievementListResponse {
  const { gameId } = gameIdOfPlaythrough(db, playthroughId);
  const syncedAt = db
    .select({ fetchedAt: achievements.fetchedAt })
    .from(achievements)
    .where(and(eq(achievements.gameId, gameId), eq(achievements.origin, 'steam')))
    .all()
    .reduce<Date | null>(
      (latest, row) =>
        row.fetchedAt && (!latest || row.fetchedAt > latest) ? row.fetchedAt : latest,
      null,
    );
  return {
    items: loadAchievements(db, gameId, playthroughId),
    steamAppId: steamAppIdForGame(db, gameId),
    syncedAt: syncedAt?.toISOString() ?? null,
  };
}

/** The user's own classification. From here on the heuristic leaves this achievement alone. */
export function classifyAchievement(
  db: AppDatabase,
  achievementId: string,
  request: ClassifyAchievementRequest,
): void {
  const updated = db
    .update(achievements)
    .set({ ...request, classifiedBy: 'user' })
    .where(eq(achievements.id, achievementId))
    .returning({ id: achievements.id })
    .all();
  if (updated.length === 0) throw notFound('Achievement');
}

export function setAchievementUnlocked(
  db: AppDatabase,
  playthroughId: string,
  achievementId: string,
  isUnlocked: boolean,
  now: Date,
): void {
  const { gameId } = gameIdOfPlaythrough(db, playthroughId);
  const achievement = db
    .select()
    .from(achievements)
    .where(eq(achievements.id, achievementId))
    .get();
  if (!achievement) throw notFound('Achievement');
  if (achievement.gameId !== gameId) {
    throw badRequest('achievement_mismatch', 'The achievement belongs to another game');
  }
  const values = {
    playthroughId,
    achievementId,
    isUnlocked,
    unlockedAt: isUnlocked ? now : null,
    origin: 'manual' as const,
  };
  db.insert(achievementProgress)
    .values(values)
    .onConflictDoUpdate({
      target: [achievementProgress.playthroughId, achievementProgress.achievementId],
      set: values,
    })
    .run();
}

export function getFunnel(db: AppDatabase, playthroughId: string): FunnelResponse {
  const { playthrough, gameId } = gameIdOfPlaythrough(db, playthroughId);
  return computeFunnel({
    achievements: loadAchievements(db, gameId, playthroughId),
    goal: playthrough.goal,
    times: getEffectiveTimes(db, gameId),
    playtimeMinutes: playthrough.playtimeMinutes,
  });
}

/** Library entries that have a Steam app, with that app's ID. */
export function listSteamLinkedEntries(db: AppDatabase) {
  return db
    .select({
      entryId: libraryEntries.id,
      gameId: libraryEntries.gameId,
      appId: gameExternalIds.externalId,
    })
    .from(libraryEntries)
    .innerJoin(
      gameExternalIds,
      and(eq(gameExternalIds.gameId, libraryEntries.gameId), eq(gameExternalIds.source, 'steam')),
    )
    .all();
}
