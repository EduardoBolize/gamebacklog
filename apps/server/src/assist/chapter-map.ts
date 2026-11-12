import type {
  ChapterMapResponse,
  Checkpoint,
  Provenance,
  SaveCheckpointsRequest,
} from '@gamebacklog/shared';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { runAiTask } from '../ai/pipeline.ts';
import {
  CHAPTER_MAP_PROMPT_VERSION,
  buildChapterMapPrompt,
  chapterMapSchema,
} from '../ai/prompts/chapter-map.ts';
import type { AppContext } from '../context.ts';
import type { AppDatabase } from '../db/client.ts';
import {
  achievements,
  chapterMaps,
  checkpoints,
  games,
  libraryEntries,
  playthroughs,
} from '../db/schema/index.ts';
import { badRequest, notFound } from '../errors.ts';
import { requireEntry, requirePlaythrough } from '../library/service.ts';
import {
  collectWikiDocs,
  normalizeText,
  renderSources,
  storedWikiUrl,
  type ContextDoc,
} from './wiki.ts';

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
    leadsTo: row.leadsTo,
    requirement: row.requirement,
    origin: row.origin,
  };
}

/**
 * Where the player can go from a checkpoint: the ones it leads to, or simply the next one in
 * the list when the map has no branches there. Finished checkpoints are left out.
 */
export function nextCheckpoints(
  rows: CheckpointRow[],
  from: CheckpointRow | null,
  completed: ReadonlySet<string>,
): CheckpointRow[] {
  const ids = from?.leadsTo ?? [];
  const candidates =
    ids.length > 0
      ? ids.flatMap((id) => rows.find((row) => row.id === id) ?? [])
      : rows.filter((row) => row.position === (from?.position ?? 0) + 1);
  return candidates.filter((row) => row.id !== from?.id && !completed.has(row.id));
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
    completedCheckpointIds: playthrough.completedCheckpointIds.filter((checkpointId) =>
      loaded?.checkpoints.some((row) => row.id === checkpointId),
    ),
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
  options: { force?: boolean; locale?: string } = {},
): Promise<void> {
  const locale = options.locale ?? 'pt-BR';
  const game = ctx.db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) throw notFound('Game');
  const existing = loadMap(ctx.db, gameId);
  if (existing && !options.force) return;

  const storyAchievements = storyAchievementNames(ctx.db, gameId);
  const result = await runAiTask<ContextDoc[], ReturnType<typeof chapterMapSchema.parse>>(ctx, {
    feature: 'chapter_map',
    gameId,
    // A forced rebuild must not be answered by the cached first attempt.
    cacheKeyParts: [
      storyAchievements.join('|'),
      locale,
      options.force ? ctx.now().toISOString() : null,
    ],
    promptVersion: CHAPTER_MAP_PROMPT_VERSION,
    schema: chapterMapSchema,
    maxTokens: 6000,
    collect: () =>
      // The game's own article comes first: on real wikis it lists the areas in order, while
      // a search for "walkthrough" tends to return pages about printed strategy guides.
      collectWikiDocs(ctx, gameId, [
        game.title,
        `${game.title} locations`,
        `${game.title} dungeons`,
        `${game.title} chapters`,
        `${game.title} walkthrough`,
      ]),
    build: (docs, budget) =>
      buildChapterMapPrompt({
        title: game.title,
        locale,
        storyAchievements,
        sources: renderSources(docs, ['walkthrough', 'chapter', 'dungeon', 'area', 'boss'], budget),
      }),
  });

  const sources: Provenance[] = (result.context ?? []).map((doc) => doc.provenance);
  const ids = result.output.checkpoints.map(() => randomUUID());
  ctx.db.transaction((tx) => {
    const current = loadMap(tx, gameId);
    // Runs keep their place across a rebuild when the place keeps its name.
    const runs = current ? runsOfGame(tx, gameId) : [];
    const oldNames = new Map(current?.checkpoints.map((row) => [row.id, normalizeText(row.name)]));
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
          id: ids[index],
          chapterMapId: map.id,
          position: index + 1,
          name: checkpoint.name,
          aliases: checkpoint.aliases,
          isPointOfNoReturn: checkpoint.isPointOfNoReturn,
          bossName: checkpoint.bossName,
          leadsTo: [
            ...new Set(
              checkpoint.leadsTo
                .filter((number) => number !== index + 1)
                .flatMap((number) => ids[number - 1] ?? []),
            ),
          ],
          requirement: checkpoint.requirement,
          origin: 'ai' as const,
        })),
      )
      .run();

    const newIds = new Map(
      result.output.checkpoints.map((checkpoint, index) => [
        normalizeText(checkpoint.name),
        ids[index] ?? '',
      ]),
    );
    const carry = (checkpointId: string | null) => {
      const name = checkpointId ? oldNames.get(checkpointId) : undefined;
      return (name && newIds.get(name)) || null;
    };
    for (const run of runs) {
      tx.update(playthroughs)
        .set({
          currentCheckpointId: carry(run.currentCheckpointId),
          completedCheckpointIds: run.completedCheckpointIds.flatMap((done) => carry(done) ?? []),
        })
        .where(eq(playthroughs.id, run.id))
        .run();
    }
  });
}

function runsOfGame(db: Queryable, gameId: string) {
  return db
    .select({
      id: playthroughs.id,
      currentCheckpointId: playthroughs.currentCheckpointId,
      completedCheckpointIds: playthroughs.completedCheckpointIds,
    })
    .from(playthroughs)
    .innerJoin(libraryEntries, eq(playthroughs.libraryEntryId, libraryEntries.id))
    .where(eq(libraryEntries.gameId, gameId))
    .all();
}

/** Ticks a checkpoint as finished (or not) for one run, without moving its current position. */
export function setCheckpointDone(
  ctx: AppContext,
  playthroughId: string,
  checkpointId: string,
  done: boolean,
): void {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const rows = loadMap(ctx.db, game.id)?.checkpoints ?? [];
  if (!rows.some((row) => row.id === checkpointId)) {
    throw badRequest('checkpoint_not_found', 'That checkpoint is not on this map');
  }
  const completed = new Set(playthrough.completedCheckpointIds);
  if (done) completed.add(checkpointId);
  else completed.delete(checkpointId);
  ctx.db
    .update(playthroughs)
    .set({ completedCheckpointIds: [...completed] })
    .where(eq(playthroughs.id, playthroughId))
    .run();
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
    const removed = loaded.checkpoints.filter((row) => !kept.has(row.id)).map((row) => row.id);
    if (removed.length > 0) {
      tx.delete(checkpoints).where(inArray(checkpoints.id, removed)).run();
      // Branches pointing at a removed place now point nowhere.
      for (const row of loaded.checkpoints) {
        if (kept.has(row.id) && row.leadsTo.some((target) => removed.includes(target))) {
          tx.update(checkpoints)
            .set({ leadsTo: row.leadsTo.filter((target) => !removed.includes(target)) })
            .where(eq(checkpoints.id, row.id))
            .run();
        }
      }
    }
    tx.update(chapterMaps).set({ isUserEdited: true }).where(eq(chapterMaps.id, mapId)).run();
  });
}
