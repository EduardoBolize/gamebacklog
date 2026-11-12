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
import { HttpError, badRequest } from '../errors.ts';
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

interface TextMatch {
  row: CheckpointRow;
  /** Where in the normalized text the place is named. */
  start: number;
  end: number;
}

/** Words that say "this is where I am now", e.g. "estou na", "now at". */
const HERE_CUE =
  /\b(estou|to|tou|cheguei|entrei|agora|now|currently|im|i m|i am|reached|arrived)\b[^.,;]{0,20}$/;

/**
 * Every place the text names, without AI: the text has to contain a checkpoint's name or one
 * of its aliases, as whole words, or (for names of two words or more) every significant word
 * of it in any order. When names overlap, the longest wins, so "Inside the Deku Tree" beats
 * "Deku Tree". Results are in the order the text mentions them.
 */
export function findCheckpointsInText(text: string, rows: CheckpointRow[]): TextMatch[] {
  const haystack = ` ${normalizeText(text)} `;
  const found: (TextMatch & { length: number })[] = [];

  for (const row of rows) {
    let best: (TextMatch & { length: number }) | null = null;
    for (const label of [row.name, ...row.aliases]) {
      const needle = normalizeText(label);
      const significant = needle
        .split(' ')
        .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
      if (significant.length === 0) continue;

      let match: { start: number; end: number } | null = null;
      const phrase = haystack.indexOf(` ${needle} `);
      if (phrase >= 0) {
        match = { start: phrase + 1, end: phrase + 1 + needle.length };
      } else if (significant.length >= 2) {
        const positions = significant.map((word) => haystack.indexOf(` ${word} `));
        if (positions.every((position) => position >= 0)) {
          const last = Math.max(...positions);
          const lastWord = significant[positions.indexOf(last)] ?? '';
          match = { start: Math.min(...positions) + 1, end: last + 1 + lastWord.length };
        }
      }
      if (match && (!best || needle.length > best.length)) {
        best = { row, ...match, length: needle.length };
      }
    }
    if (best) found.push(best);
  }

  // Longest names first; a shorter one that sits inside a longer one is the same mention.
  const kept: typeof found = [];
  for (const candidate of found.sort((a, b) => b.length - a.length)) {
    const overlaps = kept.some(
      (other) => candidate.start < other.end && other.start < candidate.end,
    );
    if (!overlaps) kept.push(candidate);
  }
  return kept.sort((a, b) => a.start - b.start).map(({ row, start, end }) => ({ row, start, end }));
}

/** The one place the text names, or the longest one when it names several. */
export function matchCheckpointLocally(text: string, rows: CheckpointRow[]): CheckpointRow | null {
  const matches = findCheckpointsInText(text, rows);
  if (matches.length === 0) return null;
  return matches.reduce((best, match) =>
    match.end - match.start > best.end - best.start ? match : best,
  ).row;
}

/**
 * Reads "I finished X and Y, I'm at Z" without AI. The place the text points at with "I'm
 * at / now" is the current one; failing that, the last one mentioned. The others are taken as
 * finished.
 */
export function readProgressLocally(
  text: string,
  rows: CheckpointRow[],
): { current: CheckpointRow; completed: CheckpointRow[] } | null {
  const matches = findCheckpointsInText(text, rows);
  if (matches.length === 0) return null;
  const haystack = ` ${normalizeText(text)} `;
  const cued = matches.filter((match) => HERE_CUE.test(haystack.slice(0, match.start)));
  const current = (cued.at(-1) ?? matches.at(-1))?.row;
  if (!current) return null;
  return {
    current,
    completed: matches.map((match) => match.row).filter((row) => row.id !== current.id),
  };
}

async function resolveWithAi(
  ctx: AppContext,
  game: { id: string; title: string },
  mapId: string,
  rows: CheckpointRow[],
  text: string,
): Promise<{ current: CheckpointRow; completed: CheckpointRow[] } | null> {
  const { output } = await runAiTask(ctx, {
    feature: 'resolve_checkpoint',
    gameId: game.id,
    cacheKeyParts: [mapId, rows.map((row) => row.id).join(','), normalizeText(text)],
    promptVersion: RESOLVE_CHECKPOINT_PROMPT_VERSION,
    schema: resolveCheckpointSchema,
    maxTokens: 300,
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
  const completed = output.completed
    .flatMap((number) => rows[number - 1] ?? [])
    .filter((done) => done.id !== row.id);

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
  return { current: row, completed };
}

/** Code of an AI failure, to tell the user why the text could not be placed. */
const aiErrorCode = (error: unknown) =>
  error instanceof HttpError && error.code.startsWith('ai_') ? error.code : 'ai_provider_error';

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
 * Records "where am I?". Free text is matched to the map locally first ("I beat X and Y, I'm
 * at Z" marks X and Y as finished) and by the AI only when that fails. A move that crosses a
 * point of no return is held back with a warning until the user confirms it. With no map and
 * no AI, the text is simply stored, and the answer says why it was not placed.
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
  let aiError: string | null = null;

  // The first progress report is when the map gets built.
  if (!loadMap(ctx.db, game.id) && aiConnected && request.rawText) {
    await generateChapterMap(ctx, game.id, { locale: request.locale }).catch((error: unknown) => {
      aiError = aiErrorCode(error);
    });
  }
  const loaded = loadMap(ctx.db, game.id);
  const rows = loaded?.checkpoints ?? [];

  let target: CheckpointRow | null = null;
  let finished: CheckpointRow[] = [];
  let resolvedBy: CheckpointResolution | null = null;
  if (request.checkpointId) {
    target = rows.find((row) => row.id === request.checkpointId) ?? null;
    if (!target) throw badRequest('checkpoint_not_found', 'That checkpoint is not on this map');
    resolvedBy = 'manual';
  } else if (request.rawText && loaded && rows.length > 0) {
    let read = readProgressLocally(request.rawText, rows);
    if (read) {
      resolvedBy = 'local_match';
    } else if (aiConnected) {
      read = await resolveWithAi(ctx, game, loaded.map.id, rows, request.rawText).catch(
        (error: unknown) => {
          aiError = aiErrorCode(error);
          return null;
        },
      );
      if (read) resolvedBy = 'ai';
    }
    target = read?.current ?? null;
    finished = read?.completed ?? [];
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
        completed: finished.map(toCheckpoint),
        notPlaced: null,
        aiError,
        warning: {
          pointOfNoReturn: toCheckpoint(crossed),
          ...pendingMissables(ctx, playthroughId, game.id, before),
        },
      };
    }
  }

  const alreadyDone = new Set(playthrough.completedCheckpointIds);
  const newlyDone = finished.filter((row) => !alreadyDone.has(row.id));
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
      const completed = new Set([...alreadyDone, ...finished.map((row) => row.id)]);
      // Being back at a place means it is not finished after all.
      completed.delete(target.id);
      tx.update(playthroughs)
        .set({ currentCheckpointId: target.id, completedCheckpointIds: [...completed] })
        .where(eq(playthroughs.id, playthroughId))
        .run();
    }
  });

  return {
    saved: true,
    checkpoint: target ? toCheckpoint(target) : null,
    resolvedBy,
    completed: newlyDone.map(toCheckpoint),
    notPlaced: target ? null : rows.length === 0 ? 'no_map' : 'no_match',
    aiError,
    warning: null,
  };
}
