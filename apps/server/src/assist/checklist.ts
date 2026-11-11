import type { AreaChecklistResponse, Provenance } from '@gamebacklog/shared';
import { and, eq } from 'drizzle-orm';
import { readAiCache, runAiTask } from '../ai/pipeline.ts';
import {
  AREA_CHECKLIST_PROMPT_VERSION,
  areaChecklistSchema,
  buildAreaChecklistPrompt,
} from '../ai/prompts/area-checklist.ts';
import type { AppContext } from '../context.ts';
import type { checkpoints } from '../db/schema/index.ts';
import {
  achievementProgress,
  achievements,
  collectibleProgress,
  collectibles,
} from '../db/schema/index.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { gameOfPlaythrough, loadMap, toCheckpoint } from './chapter-map.ts';
import { collectWikiDocs, normalizeText, renderSources, type ContextDoc } from './wiki.ts';

type CheckpointRow = typeof checkpoints.$inferSelect;

/** Most achievements a single prompt lists; beyond that the list is cut, rarest last. */
const MAX_ACHIEVEMENTS_IN_PROMPT = 60;

function locate(ctx: AppContext, playthroughId: string, checkpointId: string | undefined) {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const rows = loadMap(ctx.db, game.id)?.checkpoints ?? [];
  if (rows.length === 0) throw conflict('no_chapter_map', 'This game has no chapter map yet');
  const checkpoint =
    rows.find((row) => row.id === (checkpointId ?? playthrough.currentCheckpointId)) ??
    (checkpointId ? undefined : rows[0]);
  if (!checkpoint) throw notFound('Checkpoint');
  return { game, rows, checkpoint };
}

function taskIdentity(gameId: string, checkpoint: CheckpointRow) {
  return {
    feature: 'area_checklist',
    gameId,
    cacheKeyParts: [checkpoint.id, normalizeText(checkpoint.name)],
    promptVersion: AREA_CHECKLIST_PROMPT_VERSION,
    schema: areaChecklistSchema,
  };
}

function gameAchievements(ctx: AppContext, gameId: string) {
  return ctx.db
    .select()
    .from(achievements)
    .where(eq(achievements.gameId, gameId))
    .orderBy(achievements.sortOrder, achievements.id)
    .all()
    .slice(0, MAX_ACHIEVEMENTS_IN_PROMPT);
}

function buildResponse(
  ctx: AppContext,
  playthroughId: string,
  gameId: string,
  rows: CheckpointRow[],
  checkpoint: CheckpointRow,
  extra: { cached: boolean; sources?: Provenance[] },
): AreaChecklistResponse {
  const items = ctx.db
    .select()
    .from(collectibles)
    .where(and(eq(collectibles.gameId, gameId), eq(collectibles.checkpointId, checkpoint.id)))
    .orderBy(collectibles.sortOrder, collectibles.id)
    .all();
  const collected = new Set(
    ctx.db
      .select({ id: collectibleProgress.collectibleId })
      .from(collectibleProgress)
      .where(
        and(
          eq(collectibleProgress.playthroughId, playthroughId),
          eq(collectibleProgress.isCollected, true),
        ),
      )
      .all()
      .map((row) => row.id),
  );
  const unlocked = new Set(
    ctx.db
      .select({ id: achievementProgress.achievementId })
      .from(achievementProgress)
      .where(
        and(
          eq(achievementProgress.playthroughId, playthroughId),
          eq(achievementProgress.isUnlocked, true),
        ),
      )
      .all()
      .map((row) => row.id),
  );
  const missable = ctx.db
    .select()
    .from(achievements)
    .where(
      and(
        eq(achievements.gameId, gameId),
        eq(achievements.isMissable, true),
        eq(achievements.checkpointId, checkpoint.id),
      ),
    )
    .all()
    .filter((row) => !unlocked.has(row.id));

  const urls = [
    ...new Set(items.map((item) => item.originUrl).filter((url): url is string => Boolean(url))),
  ];
  const nextPointOfNoReturn = rows.find(
    (row) => row.isPointOfNoReturn && row.position > checkpoint.position,
  );

  return {
    checkpoint: toCheckpoint(checkpoint),
    collectibles: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      isMissable: item.isMissable,
      isCollected: collected.has(item.id),
      origin: item.origin,
    })),
    missableAchievements: missable.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
    })),
    nextPointOfNoReturn: nextPointOfNoReturn ? toCheckpoint(nextPointOfNoReturn) : null,
    sources: extra.sources ?? urls.map((url) => ({ origin: 'wiki' as const, url })),
    generated:
      items.some((item) => item.origin !== 'manual') ||
      readAiCache(ctx, taskIdentity(gameId, checkpoint)) !== null,
    cached: extra.cached,
  };
}

/** What is known about an area right now. Reads only; never calls the AI. */
export function getAreaChecklist(
  ctx: AppContext,
  playthroughId: string,
  checkpointId?: string,
): AreaChecklistResponse {
  const { game, rows, checkpoint } = locate(ctx, playthroughId, checkpointId);
  return buildResponse(ctx, playthroughId, game.id, rows, checkpoint, { cached: true });
}

/**
 * Builds the completionist list for one area from the wiki: collectibles and secrets become a
 * checklist, and achievements the sources call missable are flagged and tied to the area.
 * Classifications the user made by hand are left alone.
 */
export async function generateAreaChecklist(
  ctx: AppContext,
  playthroughId: string,
  checkpointId?: string,
): Promise<AreaChecklistResponse> {
  const { game, rows, checkpoint } = locate(ctx, playthroughId, checkpointId);
  const listed = gameAchievements(ctx, game.id);

  const result = await runAiTask<ContextDoc[], ReturnType<typeof areaChecklistSchema.parse>>(ctx, {
    ...taskIdentity(game.id, checkpoint),
    maxTokens: 2500,
    collect: () =>
      collectWikiDocs(ctx, game.id, [
        checkpoint.name,
        `${checkpoint.name} collectibles`,
        `${game.title} missable`,
      ]),
    build: (docs, budget) =>
      buildAreaChecklistPrompt({
        title: game.title,
        checkpoint: checkpoint.name,
        achievements: listed.map((row) => ({ name: row.name, description: row.description })),
        sources: renderSources(
          docs,
          [checkpoint.name, 'collectible', 'secret', 'missable', 'item', 'location'],
          budget,
        ),
      }),
  });

  // On a cache hit everything below was already stored the first time.
  if (result.context) {
    const docs = result.context;
    const fetchedAt = ctx.now();
    ctx.db.transaction((tx) => {
      const existing = new Set(
        tx
          .select({ name: collectibles.name })
          .from(collectibles)
          .where(
            and(eq(collectibles.gameId, game.id), eq(collectibles.checkpointId, checkpoint.id)),
          )
          .all()
          .map((row) => normalizeText(row.name)),
      );
      result.output.collectibles.forEach((item, index) => {
        if (existing.has(normalizeText(item.name))) return;
        existing.add(normalizeText(item.name));
        tx.insert(collectibles)
          .values({
            gameId: game.id,
            checkpointId: checkpoint.id,
            name: item.name,
            description: item.description,
            category: item.category,
            isMissable: item.isMissable,
            sortOrder: index,
            origin: 'ai',
            originUrl: docs[0]?.url ?? null,
            fetchedAt,
          })
          .run();
      });
      for (const number of result.output.missableAchievements) {
        const row = listed[number - 1];
        if (!row || row.classifiedBy === 'user') continue;
        tx.update(achievements)
          .set({ isMissable: true, checkpointId: checkpoint.id, classifiedBy: 'ai' })
          .where(eq(achievements.id, row.id))
          .run();
      }
    });
  }

  return buildResponse(ctx, playthroughId, game.id, rows, checkpoint, {
    cached: result.cached,
    sources: result.context?.map((doc) => doc.provenance),
  });
}

export function setCollected(
  ctx: AppContext,
  playthroughId: string,
  collectibleId: string,
  isCollected: boolean,
): void {
  const { game } = gameOfPlaythrough(ctx.db, playthroughId);
  const item = ctx.db.select().from(collectibles).where(eq(collectibles.id, collectibleId)).get();
  if (!item) throw notFound('Collectible');
  if (item.gameId !== game.id) {
    throw badRequest('collectible_mismatch', 'The collectible belongs to another game');
  }
  const values = {
    playthroughId,
    collectibleId,
    isCollected,
    collectedAt: isCollected ? ctx.now() : null,
  };
  ctx.db
    .insert(collectibleProgress)
    .values(values)
    .onConflictDoUpdate({
      target: [collectibleProgress.playthroughId, collectibleProgress.collectibleId],
      set: values,
    })
    .run();
}
