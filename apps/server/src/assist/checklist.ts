import type { AreaChecklistResponse, Provenance } from '@gamebacklog/shared';
import { and, eq, inArray } from 'drizzle-orm';
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
import { achievementLinkFor, syncAchievements } from '../achievements/service.ts';
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

/** Language the descriptions are written in: the one the interface is in. */
export type ChecklistLocale = 'pt-BR' | 'en';

function taskIdentity(
  ctx: AppContext,
  gameId: string,
  checkpoint: CheckpointRow,
  locale: ChecklistLocale,
) {
  return {
    feature: 'area_checklist',
    gameId,
    // The AI answers with achievement numbers, so the list it saw is part of the question.
    cacheKeyParts: [
      checkpoint.id,
      normalizeText(checkpoint.name),
      locale,
      gameAchievements(ctx, gameId)
        .map((row) => row.id)
        .join(','),
    ],
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
  extra: { cached: boolean; locale: ChecklistLocale; sources?: Provenance[] },
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
      achievementName: item.achievementName,
      achievementId: item.achievementId,
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
    // "Generated" means generated, and stored, in this language: a list written in another
    // one can be asked for again, and comes back rewritten.
    generated:
      readAiCache(ctx, taskIdentity(ctx, gameId, checkpoint, extra.locale)) !== null &&
      items.every((item) => item.origin !== 'ai' || item.locale === extra.locale),
    cached: extra.cached,
  };
}

/** What is known about an area right now. Reads only; never calls the AI. */
export function getAreaChecklist(
  ctx: AppContext,
  playthroughId: string,
  options: { checkpointId?: string; locale: ChecklistLocale },
): AreaChecklistResponse {
  const { game, rows, checkpoint } = locate(ctx, playthroughId, options.checkpointId);
  return buildResponse(ctx, playthroughId, game.id, rows, checkpoint, {
    cached: true,
    locale: options.locale,
  });
}

/**
 * Builds the completionist list for one area from the wiki: collectibles and secrets become a
 * checklist, and achievements the sources call missable are flagged and tied to the area.
 * Descriptions are written in the language of the interface. Items and classifications the
 * user made by hand are left alone.
 */
export async function generateAreaChecklist(
  ctx: AppContext,
  playthroughId: string,
  options: { checkpointId?: string; locale: ChecklistLocale },
): Promise<AreaChecklistResponse> {
  const { locale } = options;
  const { game, rows, checkpoint } = locate(ctx, playthroughId, options.checkpointId);
  // Data first: a game linked to an account whose achievements were never read gets them now,
  // so the AI can tell what counts towards each one instead of guessing.
  if (gameAchievements(ctx, game.id).length === 0) {
    const { entry } = gameOfPlaythrough(ctx.db, playthroughId);
    if (achievementLinkFor(ctx.db, entry)) {
      await syncAchievements(ctx, entry.id).catch(() => undefined);
    }
  }
  const listed = gameAchievements(ctx, game.id);

  const result = await runAiTask<ContextDoc[], ReturnType<typeof areaChecklistSchema.parse>>(ctx, {
    ...taskIdentity(ctx, game.id, checkpoint, locale),
    maxTokens: 5000,
    collect: () =>
      collectWikiDocs(
        ctx,
        game.id,
        [
          checkpoint.name,
          `${checkpoint.name} collectibles`,
          // With no achievement data at all, the wiki's own list stands in for it.
          listed.length === 0 ? `${game.title} trophies achievements` : null,
          `${game.title} missable`,
        ],
        4,
      ),
    build: (docs, budget) =>
      buildAreaChecklistPrompt({
        title: game.title,
        checkpoint: checkpoint.name,
        achievements: listed.map((row) => ({ name: row.name, description: row.description })),
        locale,
        sources: renderSources(
          docs,
          [
            checkpoint.name,
            'collectible',
            'secret',
            'missable',
            'item',
            'location',
            'achievement',
            'trophy',
          ],
          budget,
        ),
      }),
  });

  // Stored on every call, cache hits included: the same answer may have to replace a list
  // written in another language, which costs no tokens when that language was asked before.
  const docs = result.context ?? [];
  const fetchedAt = ctx.now();
  const achievementByName = new Map(listed.map((row) => [normalizeText(row.name), row.id]));
  ctx.db.transaction((tx) => {
    const existing = tx
      .select()
      .from(collectibles)
      .where(and(eq(collectibles.gameId, game.id), eq(collectibles.checkpointId, checkpoint.id)))
      .orderBy(collectibles.sortOrder, collectibles.id)
      .all();
    const used = new Set<string>();
    // Lists written before `sourceName` existed were in English, so their name is that key.
    const byKey = new Map(existing.map((row) => [normalizeText(row.sourceName ?? row.name), row]));
    const byName = new Map(existing.map((row) => [normalizeText(row.name), row]));

    const seen = new Set<string>();
    result.output.collectibles.forEach((item, index) => {
      const key = normalizeText(item.sourceName ?? item.name);
      if (seen.has(key)) return;
      seen.add(key);
      const achievementId =
        (item.achievement ? listed[item.achievement - 1]?.id : undefined) ??
        (item.achievementName
          ? achievementByName.get(normalizeText(item.achievementName))
          : undefined) ??
        null;
      const values = {
        name: item.name,
        sourceName: item.sourceName ?? item.name,
        description: item.description,
        category: item.category,
        isMissable: item.isMissable,
        achievementName:
          item.achievementName ??
          (achievementId ? (listed.find((row) => row.id === achievementId)?.name ?? null) : null),
        achievementId,
        locale,
        sortOrder: index,
        fetchedAt,
      };
      // The same item, whatever language either list is in.
      const known = [byKey.get(key), byName.get(normalizeText(item.name))].find(
        (row) => row && !used.has(row.id),
      );
      if (known) {
        used.add(known.id);
        // Never what the user typed.
        if (known.origin === 'ai') {
          tx.update(collectibles).set(values).where(eq(collectibles.id, known.id)).run();
        }
        return;
      }
      tx.insert(collectibles)
        .values({
          ...values,
          gameId: game.id,
          checkpointId: checkpoint.id,
          origin: 'ai',
          originUrl: docs[0]?.url ?? existing[0]?.originUrl ?? null,
        })
        .run();
    });

    // What the new answer no longer lists goes away, unless someone already ticked it.
    const ticked = new Set(
      tx
        .select({ id: collectibleProgress.collectibleId })
        .from(collectibleProgress)
        .where(eq(collectibleProgress.isCollected, true))
        .all()
        .map((row) => row.id),
    );
    const stale = existing
      .filter((row) => row.origin === 'ai' && !used.has(row.id) && !ticked.has(row.id))
      .map((row) => row.id);
    if (stale.length > 0) tx.delete(collectibles).where(inArray(collectibles.id, stale)).run();

    for (const number of result.output.missableAchievements) {
      const row = listed[number - 1];
      if (!row || row.classifiedBy === 'user') continue;
      tx.update(achievements)
        .set({ isMissable: true, checkpointId: checkpoint.id, classifiedBy: 'ai' })
        .where(eq(achievements.id, row.id))
        .run();
    }
  });

  return buildResponse(ctx, playthroughId, game.id, rows, checkpoint, {
    cached: result.cached,
    locale,
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
