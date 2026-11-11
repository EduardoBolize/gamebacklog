import type {
  ChapterMapResponse,
  Checkpoint,
  Provenance,
  SaveCheckpointsRequest,
} from '@gamebacklog/shared';
import { and, eq } from 'drizzle-orm';
import { runAiTask } from '../ai/pipeline.ts';
import {
  CHAPTER_MAP_PROMPT_VERSION,
  buildChapterMapPrompt,
  chapterMapSchema,
} from '../ai/prompts/chapter-map.ts';
import type { AppContext } from '../context.ts';
import type { AppDatabase } from '../db/client.ts';
import { achievements, chapterMaps, checkpoints, games } from '../db/schema/index.ts';
import { notFound } from '../errors.ts';
import { requireEntry, requirePlaythrough } from '../library/service.ts';
import { collectWikiDocs, renderSources, storedWikiUrl, type ContextDoc } from './wiki.ts';

type Queryable = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete'>;
type CheckpointRow = typeof checkpoints.$inferSelect;

export function toCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    aliases: row.aliases,
    isPointOfNoReturn: row.isPointOfNoReturn,
    bossName: row.bossName,
    origin: row.origin,
  };
}

/** The game's map and its checkpoints in play order, or null when there is no map. */
export function loadMap(db: Queryable, gameId: string) {
  const map = db.select().from(chapterMaps).where(eq(chapterMaps.gameId, gameId)).get();
  if (!map) return null;
  const rows = db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.chapterMapId, map.id))
    .orderBy(checkpoints.position, checkpoints.id)
    .all();
  return { map, checkpoints: rows };
}

export function gameOfPlaythrough(db: Queryable, playthroughId: string) {
  const playthrough = requirePlaythrough(db, playthroughId);
  const entry = requireEntry(db, playthrough.libraryEntryId);
  const game = db.select().from(games).where(eq(games.id, entry.gameId)).get();
  if (!game) throw notFound('Game');
  return { playthrough, entry, game };
}

export function getChapterMap(ctx: AppContext, playthroughId: string): ChapterMapResponse {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const loaded = loadMap(ctx.db, game.id);
  return {
    map: loaded && {
      id: loaded.map.id,
      origin: loaded.map.origin,
      isUserEdited: loaded.map.isUserEdited,
      sources: loaded.map.sources,
      checkpoints: loaded.checkpoints.map(toCheckpoint),
    },
    currentCheckpointId: playthrough.currentCheckpointId,
    wikiUrl: storedWikiUrl(ctx, game.id),
    aiConnected: ctx.ai.getActive() !== null,
  };
}

function storyAchievementNames(db: Queryable, gameId: string): string[] {
  return db
    .select()
    .from(achievements)
    .where(and(eq(achievements.gameId, gameId), eq(achievements.isStory, true)))
    .all()
    .sort((a, b) => (b.globalPercent ?? 0) - (a.globalPercent ?? 0))
    .map((row) => row.name);
}

/**
 * Builds the chapter map once per game from the wiki and the story achievements; the AI only
 * puts in order what those sources say. A map the user edited is never replaced unless asked.
 */
export async function generateChapterMap(
  ctx: AppContext,
  gameId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const game = ctx.db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) throw notFound('Game');
  const existing = loadMap(ctx.db, gameId);
  if (existing && !options.force) return;

  const storyAchievements = storyAchievementNames(ctx.db, gameId);
  const result = await runAiTask<ContextDoc[], ReturnType<typeof chapterMapSchema.parse>>(ctx, {
    feature: 'chapter_map',
    gameId,
    // A forced rebuild must not be answered by the cached first attempt.
    cacheKeyParts: [storyAchievements.join('|'), options.force ? ctx.now().toISOString() : null],
    promptVersion: CHAPTER_MAP_PROMPT_VERSION,
    schema: chapterMapSchema,
    maxTokens: 3000,
    collect: () =>
      collectWikiDocs(ctx, gameId, [
        `${game.title} walkthrough`,
        `${game.title} chapters`,
        `${game.title} dungeons`,
        game.title,
      ]),
    build: (docs, budget) =>
      buildChapterMapPrompt({
        title: game.title,
        storyAchievements,
        sources: renderSources(docs, ['walkthrough', 'chapter', 'dungeon', 'area', 'boss'], budget),
      }),
  });

  const sources: Provenance[] = (result.context ?? []).map((doc) => doc.provenance);
  ctx.db.transaction((tx) => {
    const current = loadMap(tx, gameId);
    if (current) tx.delete(chapterMaps).where(eq(chapterMaps.id, current.map.id)).run();
    const map = tx
      .insert(chapterMaps)
      .values({
        gameId,
        origin: 'ai',
        sources,
        promptVersion: CHAPTER_MAP_PROMPT_VERSION,
        generatedAt: ctx.now(),
      })
      .returning({ id: chapterMaps.id })
      .get();
    tx.insert(checkpoints)
      .values(
        result.output.checkpoints.map((checkpoint, index) => ({
          chapterMapId: map.id,
          position: index + 1,
          name: checkpoint.name,
          aliases: checkpoint.aliases,
          isPointOfNoReturn: checkpoint.isPointOfNoReturn,
          bossName: checkpoint.bossName,
          origin: 'ai' as const,
        })),
      )
      .run();
  });
}

/**
 * Saves the map as the user arranged it: order, names, aliases, points of no return, bosses.
 * Works with no AI at all — a map can be written entirely by hand.
 */
export function saveCheckpoints(
  ctx: AppContext,
  gameId: string,
  request: SaveCheckpointsRequest,
): void {
  ctx.db.transaction((tx) => {
    let loaded = loadMap(tx, gameId);
    if (!loaded) {
      const map = tx.insert(chapterMaps).values({ gameId, origin: 'manual' }).returning().get();
      loaded = { map, checkpoints: [] };
    }
    const mapId = loaded.map.id;
    const known = new Map(loaded.checkpoints.map((row) => [row.id, row]));
    const kept = new Set<string>();

    request.checkpoints.forEach((checkpoint, index) => {
      const values = {
        position: index + 1,
        name: checkpoint.name,
        aliases: checkpoint.aliases,
        isPointOfNoReturn: checkpoint.isPointOfNoReturn,
        bossName: checkpoint.bossName,
      };
      if (checkpoint.id && known.has(checkpoint.id)) {
        kept.add(checkpoint.id);
        tx.update(checkpoints).set(values).where(eq(checkpoints.id, checkpoint.id)).run();
      } else {
        tx.insert(checkpoints)
          .values({ ...values, chapterMapId: mapId, origin: 'manual' })
          .run();
      }
    });
    for (const row of loaded.checkpoints) {
      if (!kept.has(row.id)) tx.delete(checkpoints).where(eq(checkpoints.id, row.id)).run();
    }
    tx.update(chapterMaps).set({ isUserEdited: true }).where(eq(chapterMaps.id, mapId)).run();
  });
}
