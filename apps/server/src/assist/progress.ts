import type {
  CheckpointResolution,
  ReportProgressRequest,
  ReportProgressResponse,
} from '@gamebacklog/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { runAiTask } from '../ai/pipeline.ts';
import {
  RESOLVE_CHECKPOINT_PROMPT_VERSION,
  buildResolveCheckpointPrompt,
  resolveCheckpointSchema,
} from '../ai/prompts/resolve-checkpoint.ts';
import type { AppContext } from '../context.ts';
import {
  achievementProgress,
  achievements,
  checkpoints,
  collectibleProgress,
  collectibles,
  playthroughs,
  progressEvents,
} from '../db/schema/index.ts';
import { badRequest } from '../errors.ts';
import { gameOfPlaythrough, generateChapterMap, loadMap, toCheckpoint } from './chapter-map.ts';
import { normalizeText } from './wiki.ts';

type CheckpointRow = typeof checkpoints.$inferSelect;

/** Words too common to identify a place on their own. */
const STOP_WORDS = new Set([
  'the',
  'of',
  'and',
  'in',
  'to',
  'at',
  'on',
  'for',
  'a',
  'an',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'na',
  'no',
  'nas',
  'nos',
  'em',
  'e',
  'o',
  'os',
  'as',
  'um',
  'uma',
]);

/**
 * Matches free text to a checkpoint without AI: the text has to contain a checkpoint's name or
 * one of its aliases, as whole words. The longest match wins, so "Inside the Deku Tree" beats
 * "Deku Tree" when both are on the map.
 */
export function matchCheckpointLocally(text: string, rows: CheckpointRow[]): CheckpointRow | null {
  const haystack = ` ${normalizeText(text)} `;
  let best: { row: CheckpointRow; length: number } | null = null;

  for (const row of rows) {
    for (const label of [row.name, ...row.aliases]) {
      const needle = normalizeText(label);
      const significant = needle
        .split(' ')
        .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
      if (significant.length === 0) continue;
      // Whole phrase first; failing that, every significant word of the name, in any order.
      const hit =
        haystack.includes(` ${needle} `) ||
        (significant.length >= 2 && significant.every((word) => haystack.includes(` ${word} `)));
      if (hit && (!best || needle.length > best.length)) best = { row, length: needle.length };
    }
  }
  return best?.row ?? null;
}

async function resolveWithAi(
  ctx: AppContext,
  game: { id: string; title: string },
  mapId: string,
  rows: CheckpointRow[],
  text: string,
): Promise<CheckpointRow | null> {
  const { output } = await runAiTask(ctx, {
    feature: 'resolve_checkpoint',
    gameId: game.id,
    cacheKeyParts: [mapId, rows.map((row) => row.id).join(','), normalizeText(text)],
    promptVersion: RESOLVE_CHECKPOINT_PROMPT_VERSION,
    schema: resolveCheckpointSchema,
    maxTokens: 200,
    collect: () => Promise.resolve(null),
    build: () =>
      buildResolveCheckpointPrompt({
        title: game.title,
        checkpoints: rows.map((row) => ({ name: row.name, aliases: row.aliases })),
        text,
      }),
  });
  const row = output.checkpoint ? rows[output.checkpoint - 1] : undefined;
  if (!row) return null;

  // Remember how this player calls the place, so the next mention needs no AI.
  const alias = output.alias?.trim();
  const known = [row.name, ...row.aliases].map(normalizeText);
  if (alias && normalizeText(alias).length > 2 && !known.includes(normalizeText(alias))) {
    ctx.db
      .update(checkpoints)
      .set({ aliases: [...row.aliases, alias].slice(0, 20) })
      .where(eq(checkpoints.id, row.id))
      .run();
  }
  return row;
}

/** What would be left behind for good by moving past `pointOfNoReturn`. */
function pendingMissables(
  ctx: AppContext,
  playthroughId: string,
  gameId: string,
  beforeIds: string[],
) {
  if (beforeIds.length === 0) return { missableAchievements: [], missableCollectibles: [] };

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

  return {
    missableAchievements: ctx.db
      .select({ id: achievements.id, name: achievements.name })
      .from(achievements)
      .where(
        and(
          eq(achievements.gameId, gameId),
          eq(achievements.isMissable, true),
          inArray(achievements.checkpointId, beforeIds),
        ),
      )
      .all()
      .filter((row) => !unlocked.has(row.id)),
    missableCollectibles: ctx.db
      .select({ id: collectibles.id, name: collectibles.name })
      .from(collectibles)
      .where(
        and(
          eq(collectibles.gameId, gameId),
          eq(collectibles.isMissable, true),
          inArray(collectibles.checkpointId, beforeIds),
        ),
      )
      .all()
      .filter((row) => !collected.has(row.id)),
  };
}

/**
 * Records "where am I?". Free text is matched to a checkpoint locally first and by the AI only
 * when that fails. A move that crosses a point of no return is held back with a warning until
 * the user confirms it. With no map and no AI, the text is simply stored.
 */
export async function reportProgress(
  ctx: AppContext,
  playthroughId: string,
  request: ReportProgressRequest,
): Promise<ReportProgressResponse> {
  if (!request.rawText && !request.checkpointId) {
    throw badRequest('invalid_request', 'Write where you are or pick a checkpoint');
  }
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const aiConnected = ctx.ai.getActive() !== null;

  // The first progress report is when the map gets built.
  if (!loadMap(ctx.db, game.id) && aiConnected && request.rawText) {
    await generateChapterMap(ctx, game.id).catch(() => undefined);
  }
  const loaded = loadMap(ctx.db, game.id);
  const rows = loaded?.checkpoints ?? [];

  let target: CheckpointRow | null = null;
  let resolvedBy: CheckpointResolution | null = null;
  if (request.checkpointId) {
    target = rows.find((row) => row.id === request.checkpointId) ?? null;
    if (!target) throw badRequest('checkpoint_not_found', 'That checkpoint is not on this map');
    resolvedBy = 'manual';
  } else if (request.rawText && loaded && rows.length > 0) {
    target = matchCheckpointLocally(request.rawText, rows);
    if (target) {
      resolvedBy = 'local_match';
    } else if (aiConnected) {
      target = await resolveWithAi(ctx, game, loaded.map.id, rows, request.rawText).catch(
        () => null,
      );
      if (target) resolvedBy = 'ai';
    }
  }

  if (target && !request.confirmPointOfNoReturn) {
    const currentPosition =
      rows.find((row) => row.id === playthrough.currentCheckpointId)?.position ?? 0;
    const targetPosition = target.position;
    // Reaching a checkpoint flagged as a point of no return closes off everything before it.
    const crossed = rows.find(
      (row) =>
        row.isPointOfNoReturn && row.position > currentPosition && row.position <= targetPosition,
    );
    if (crossed) {
      const before = rows.filter((row) => row.position < crossed.position).map((row) => row.id);
      return {
        saved: false,
        checkpoint: toCheckpoint(target),
        resolvedBy,
        warning: {
          pointOfNoReturn: toCheckpoint(crossed),
          ...pendingMissables(ctx, playthroughId, game.id, before),
        },
      };
    }
  }

  ctx.db.transaction((tx) => {
    tx.insert(progressEvents)
      .values({
        playthroughId,
        rawText: request.rawText ?? null,
        checkpointId: target?.id ?? null,
        resolvedBy,
        occurredAt: ctx.now(),
      })
      .run();
    if (target) {
      tx.update(playthroughs)
        .set({ currentCheckpointId: target.id })
        .where(eq(playthroughs.id, playthroughId))
        .run();
    }
  });

  return {
    saved: true,
    checkpoint: target ? toCheckpoint(target) : null,
    resolvedBy,
    warning: null,
  };
}
