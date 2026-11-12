import {
  ACHIEVEMENT_SYNC_SOURCES,
  type Achievement,
  type AchievementListResponse,
  type AchievementSyncResponse,
  type AchievementSyncSource,
  type ClassifyAchievementRequest,
  type FunnelResponse,
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
import { parseRetroGameId } from '../sources/retroachievements/index.ts';
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

/** Where a game's achievement list can be fetched from, and its ID there. */
export interface AchievementLink {
  source: AchievementSyncSource;
  externalId: string;
}

/**
 * The account to sync a game from. A game can exist on several (Steam and PSN, say); the one
 * matching the platform the user plays on wins, so the list shown is the one being earned.
 */
export function achievementLinkFor(
  db: AppDatabase,
  entry: { gameId: string; platform: string | null },
): AchievementLink | null {
  const links = db
    .select({ source: gameExternalIds.source, externalId: gameExternalIds.externalId })
    .from(gameExternalIds)
    .where(
      and(
        eq(gameExternalIds.gameId, entry.gameId),
        inArray(gameExternalIds.source, [...ACHIEVEMENT_SYNC_SOURCES]),
      ),
    )
    .orderBy(gameExternalIds.createdAt, gameExternalIds.externalId)
    .all() as AchievementLink[];
  const of = (source: AchievementSyncSource) => links.find((link) => link.source === source);

  const platform = (entry.platform ?? '').toLowerCase();
  const preferred = /playstation|^ps\b|^ps\d/.test(platform)
    ? of('psn')
    : platform.includes('xbox')
      ? of('xbox')
      : undefined;
  return preferred ?? ACHIEVEMENT_SYNC_SOURCES.map(of).find((link) => link !== undefined) ?? null;
}

/** One achievement as fetched from an account, whatever the account. */
interface FetchedAchievement {
  externalId: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  isHidden: boolean;
  globalPercent: number | null;
  isUnlocked: boolean;
  unlockedAt: Date | null;
  /** Set when the account itself classifies the achievement; otherwise the names are guessed from. */
  isStory?: boolean;
  isMissable?: boolean;
}

interface FetchedList {
  origin: AchievementSyncSource;
  items: FetchedAchievement[];
  /** False when the catalog came but the player's own unlocks were not visible. */
  playerDataAvailable: boolean;
  url: string | null;
  fetchedAt: Date;
}

async function fetchFromSteam(ctx: AppContext, appId: string): Promise<FetchedList> {
  const [schema, percentages, player] = await Promise.all([
    ctx.steam.getAchievementSchema(appId),
    ctx.steam.getGlobalPercentages(appId),
    ctx.steam.getPlayerAchievements(appId),
  ]);
  const mine = new Map((player ?? []).map((item) => [item.apiName, item]));
  return {
    origin: 'steam',
    items: schema.data.map((definition) => ({
      externalId: definition.apiName,
      name: definition.name,
      description: definition.description,
      iconUrl: definition.iconUrl,
      isHidden: definition.isHidden,
      globalPercent: percentages[definition.apiName] ?? null,
      isUnlocked: mine.get(definition.apiName)?.isUnlocked ?? false,
      unlockedAt: mine.get(definition.apiName)?.unlockedAt ?? null,
    })),
    playerDataAvailable: player !== null,
    url: schema.provenance.url ?? null,
    fetchedAt: schema.provenance.fetchedAt ? new Date(schema.provenance.fetchedAt) : ctx.now(),
  };
}

async function fetchFromConsole(
  ctx: AppContext,
  platform: 'psn' | 'xbox',
  titleId: string,
): Promise<FetchedList> {
  const source = platform === 'psn' ? ctx.psn : ctx.xbox;
  const list = await source.getAchievements(titleId);
  return {
    origin: platform,
    items: list.data.map((item) => ({
      externalId: item.id,
      name: item.name,
      description: item.description,
      iconUrl: item.iconUrl,
      isHidden: item.isHidden,
      globalPercent: item.globalPercent,
      isUnlocked: item.isUnlocked,
      unlockedAt: item.unlockedAt ? new Date(item.unlockedAt) : null,
    })),
    playerDataAvailable: true,
    url: list.provenance.url ?? null,
    fetchedAt: list.provenance.fetchedAt ? new Date(list.provenance.fetchedAt) : ctx.now(),
  };
}

async function fetchFromRetro(ctx: AppContext, gameId: string): Promise<FetchedList | null> {
  const game = await ctx.retro.getGame(gameId);
  if (!game) return null;
  return {
    origin: 'retroachievements',
    items: game.data.achievements.map((item) => ({
      externalId: item.id,
      name: item.name,
      description: item.description,
      iconUrl: item.iconUrl,
      isHidden: false,
      globalPercent: item.globalPercent,
      isUnlocked: item.isUnlocked,
      unlockedAt: item.unlockedAt ? new Date(item.unlockedAt) : null,
      isStory: item.isStory,
      isMissable: item.isMissable,
    })),
    playerDataAvailable: true,
    url: game.data.url,
    fetchedAt: game.fetchedAt,
  };
}

/**
 * Fetches a game's achievement or trophy list, the global percentages and the player's unlocks
 * from the account the game is linked to. Flags the user classified by hand are never
 * overwritten.
 */
export async function syncAchievements(
  ctx: AppContext,
  entryId: string,
): Promise<AchievementSyncResponse> {
  const { db } = ctx;
  const entry = requireEntry(db, entryId);
  const link = achievementLinkFor(db, entry);
  if (!link) throw conflict('no_steam_app', 'This game is not linked to an account');

  const fetched =
    link.source === 'steam'
      ? await fetchFromSteam(ctx, link.externalId)
      : link.source === 'retroachievements'
        ? await fetchFromRetro(ctx, link.externalId)
        : await fetchFromConsole(ctx, link.source, link.externalId);
  if (!fetched) throw conflict('no_steam_app', 'This game is not linked to an account');
  const { origin, fetchedAt } = fetched;

  return db.transaction((tx) => {
    const existing = new Map(
      tx
        .select()
        .from(achievements)
        .where(and(eq(achievements.gameId, entry.gameId), eq(achievements.origin, origin)))
        .all()
        .map((row) => [row.externalId, row]),
    );

    const idByExternal = new Map<string, string>();
    fetched.items.forEach((definition, index) => {
      const known = existing.get(definition.externalId);
      const catalog = {
        name: definition.name,
        description: definition.description,
        iconUrl: definition.iconUrl,
        globalPercent: definition.globalPercent,
        isHidden: definition.isHidden,
        sortOrder: index,
        originUrl: fetched.url,
        fetchedAt,
      };
      const guess =
        known?.classifiedBy === 'user'
          ? {}
          : {
              // What the account says wins over a guess from the name.
              isStory: definition.isStory ?? looksLikeStory(definition),
              ...(definition.isMissable === undefined ? {} : { isMissable: definition.isMissable }),
              isNgPlus: looksLikeNewGamePlus(definition),
              classifiedBy: 'heuristic' as const,
            };

      if (known) {
        tx.update(achievements)
          .set({ ...catalog, ...guess })
          .where(eq(achievements.id, known.id))
          .run();
        idByExternal.set(definition.externalId, known.id);
      } else {
        const created = tx
          .insert(achievements)
          .values({
            gameId: entry.gameId,
            origin,
            externalId: definition.externalId,
            ...catalog,
            ...guess,
          })
          .returning({ id: achievements.id })
          .get();
        idByExternal.set(definition.externalId, created.id);
      }
    });

    let unlocked = 0;
    if (fetched.playerDataAvailable) {
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

      for (const item of fetched.items) {
        const achievementId = idByExternal.get(item.externalId);
        if (!item.isUnlocked || !achievementId) continue;
        unlocked++;
        if (alreadyUnlocked.has(achievementId)) continue;

        // Unlocks belong to the account; credit the run that was going on at the time.
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
          origin,
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

    return {
      total: fetched.items.length,
      unlocked,
      playerDataAvailable: fetched.playerDataAvailable,
    };
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
  const { entry, gameId } = gameIdOfPlaythrough(db, playthroughId);
  const link = achievementLinkFor(db, entry);
  const syncedAt = link
    ? db
        .select({ fetchedAt: achievements.fetchedAt })
        .from(achievements)
        .where(and(eq(achievements.gameId, gameId), eq(achievements.origin, link.source)))
        .all()
        .reduce<Date | null>(
          (latest, row) =>
            row.fetchedAt && (!latest || row.fetchedAt > latest) ? row.fetchedAt : latest,
          null,
        )
    : null;
  return {
    items: loadAchievements(db, gameId, playthroughId),
    steamAppId: steamAppIdForGame(db, gameId),
    syncSource: link?.source ?? null,
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

/**
 * Ties a game to its page on RetroAchievements. The site has no search by name in its API, so
 * the user points at the game (ID or page address) and the app checks that it exists.
 */
export async function linkRetroGame(
  ctx: AppContext,
  entryId: string,
  input: string,
): Promise<{ gameId: string; title: string; consoleName: string | null }> {
  const entry = requireEntry(ctx.db, entryId);
  const gameId = parseRetroGameId(input);
  if (!gameId) throw badRequest('retro_game_invalid', 'Not a RetroAchievements game ID or address');
  const found = await ctx.retro.getGame(gameId);
  if (!found) throw notFound('RetroAchievements game');

  ctx.db.transaction((tx) => {
    // One RetroAchievements game per library game: a new link replaces the old one.
    tx.delete(gameExternalIds)
      .where(
        and(
          eq(gameExternalIds.gameId, entry.gameId),
          eq(gameExternalIds.source, 'retroachievements'),
        ),
      )
      .run();
    tx.insert(gameExternalIds)
      .values({
        gameId: entry.gameId,
        source: 'retroachievements',
        externalId: gameId,
        url: found.data.url,
        matchedBy: 'user',
      })
      .onConflictDoUpdate({
        target: [gameExternalIds.source, gameExternalIds.externalId],
        set: { gameId: entry.gameId, url: found.data.url, matchedBy: 'user' },
      })
      .run();
  });
  return { gameId, title: found.data.title, consoleName: found.data.consoleName };
}
