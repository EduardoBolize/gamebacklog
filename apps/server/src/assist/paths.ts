import type { PathWarning, PathsResponse, Provenance } from '@gamebacklog/shared';
import { and, eq } from 'drizzle-orm';
import { readAiCache, runAiTask } from '../ai/pipeline.ts';
import {
  NEXT_PATHS_PROMPT_VERSION,
  buildNextPathsPrompt,
  nextPathsSchema,
  type NextPathsOutput,
} from '../ai/prompts/next-paths.ts';
import type { AppContext } from '../context.ts';
import { achievementProgress, achievements, type checkpoints } from '../db/schema/index.ts';
import { conflict } from '../errors.ts';
import { gameOfPlaythrough, loadMap, nextCheckpoints, toCheckpoint } from './chapter-map.ts';
import { collectWikiDocs, normalizeText, renderSources, storedWikiUrl } from './wiki.ts';

/**
 * "Where can I go from here, and what would I lose?" The options come from the chapter map
 * and cost nothing. The AI reads them against the wiki and the achievements still locked, once
 * per position, and only when asked.
 */

type CheckpointRow = typeof checkpoints.$inferSelect;
type Locale = 'pt-BR' | 'en';

/** Most locked achievements listed in one prompt; missable ones go first. */
const MAX_ACHIEVEMENTS_IN_PROMPT = 80;

function locate(ctx: AppContext, playthroughId: string) {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const loaded = loadMap(ctx.db, game.id);
  const rows = loaded?.checkpoints ?? [];
  const current = rows.find((row) => row.id === playthrough.currentCheckpointId) ?? null;
  const completed = new Set(playthrough.completedCheckpointIds);
  const options = current ? nextCheckpoints(rows, current, completed) : [];
  return { game, mapId: loaded?.map.id ?? null, rows, current, completed, options };
}

/**
 * Achievements of the game this run has not unlocked, missable ones first. The order is stable,
 * so the numbers the AI answers with can be mapped back.
 */
function lockedAchievements(ctx: AppContext, playthroughId: string, gameId: string) {
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
  return ctx.db
    .select()
    .from(achievements)
    .where(eq(achievements.gameId, gameId))
    .orderBy(achievements.sortOrder, achievements.id)
    .all()
    .filter((row) => !unlocked.has(row.id))
    .sort((a, b) => Number(b.isMissable) - Number(a.isMissable))
    .slice(0, MAX_ACHIEVEMENTS_IN_PROMPT);
}

function taskIdentity(
  gameId: string,
  mapId: string,
  current: CheckpointRow,
  options: CheckpointRow[],
  achievementIds: string[],
  locale: Locale,
) {
  return {
    feature: 'next_paths',
    gameId,
    // The same place with the same ways out reads the same; achievements are in the key because
    // the AI answers with their numbers in the list.
    cacheKeyParts: [
      mapId,
      current.id,
      options.map((row) => row.id).join(','),
      achievementIds.join(','),
      locale,
    ],
    promptVersion: NEXT_PATHS_PROMPT_VERSION,
    schema: nextPathsSchema,
  };
}

function toResponse(
  ctx: AppContext,
  located: ReturnType<typeof locate>,
  locked: { id: string; name: string }[],
  output: NextPathsOutput | null,
  extra: { cached: boolean; sources: Provenance[] },
): PathsResponse {
  const { current, options } = located;
  const byName = new Map(locked.map((row) => [normalizeText(row.name), row.id]));
  const warning = (item: NextPathsOutput['beforeLeaving'][number]): PathWarning => {
    const achievementId =
      (item.achievement ? locked[item.achievement - 1]?.id : undefined) ??
      byName.get(normalizeText(item.name)) ??
      null;
    return {
      kind: achievementId ? 'achievement' : item.kind === 'achievement' ? 'other' : item.kind,
      name: item.name,
      detail: item.detail,
      achievementId,
    };
  };

  return {
    current: current && toCheckpoint(current),
    options: options.map(toCheckpoint),
    analysis: output && {
      beforeLeaving: output.beforeLeaving.map(warning),
      paths: output.paths.flatMap((path) => {
        const row = options[path.option - 1];
        if (!row) return [];
        return [
          {
            checkpointId: row.id,
            howToGetThere: path.howToGetThere,
            warnings: path.warnings.map(warning),
          },
        ];
      }),
      sources: extra.sources,
      cached: extra.cached,
    },
    aiConnected: ctx.ai.getActive() !== null,
  };
}

/** Wiki pages of the places involved, linked without fetching anything. */
function linkedSources(ctx: AppContext, gameId: string, names: string[]): Provenance[] {
  const base = storedWikiUrl(ctx, gameId);
  if (!base) return [];
  return names.map((name) => ({
    origin: 'wiki' as const,
    url: base + encodeURIComponent(name.replace(/ /g, '_')),
  }));
}

/** The ways on from the current place, with the AI's reading when it is in the cache. */
export function getPaths(ctx: AppContext, playthroughId: string, locale: Locale): PathsResponse {
  const located = locate(ctx, playthroughId);
  const { game, mapId, current, options } = located;
  if (!current || !mapId) return toResponse(ctx, located, [], null, { cached: true, sources: [] });

  const locked = lockedAchievements(ctx, playthroughId, game.id);
  const cached = readAiCache(
    ctx,
    taskIdentity(
      game.id,
      mapId,
      current,
      options,
      locked.map((row) => row.id),
      locale,
    ),
  );
  return toResponse(ctx, located, locked, cached, {
    cached: true,
    sources: cached
      ? linkedSources(ctx, game.id, [current.name, ...options.map((row) => row.name)])
      : [],
  });
}

/** Asks the AI what each way on would cost. Repeated for the same place, it costs nothing. */
export async function analyzePaths(
  ctx: AppContext,
  playthroughId: string,
  locale: Locale,
): Promise<PathsResponse> {
  const located = locate(ctx, playthroughId);
  const { game, mapId, current, completed, rows, options } = located;
  if (!current || !mapId) {
    throw conflict('no_position', 'Say where you are in the game first');
  }
  const locked = lockedAchievements(ctx, playthroughId, game.id);

  const result = await runAiTask(ctx, {
    ...taskIdentity(
      game.id,
      mapId,
      current,
      options,
      locked.map((row) => row.id),
      locale,
    ),
    maxTokens: 3000,
    collect: () =>
      collectWikiDocs(
        ctx,
        game.id,
        [current.name, ...options.map((row) => row.name), `${game.title} missable`],
        4,
      ),
    build: (docs, budget) =>
      buildNextPathsPrompt({
        title: game.title,
        locale,
        current: current.name,
        completed: rows.filter((row) => completed.has(row.id)).map((row) => row.name),
        options: options.map((row) => ({ name: row.name, requirement: row.requirement })),
        achievements: locked.map((row) => ({ name: row.name, description: row.description })),
        sources: renderSources(
          docs,
          [current.name, ...options.map((row) => row.name), 'missable', 'quest', 'achievement'],
          budget,
        ),
      }),
  });

  return toResponse(ctx, located, locked, result.output, {
    cached: result.cached,
    sources: result.context
      ? result.context.map((doc) => doc.provenance)
      : linkedSources(ctx, game.id, [current.name, ...options.map((row) => row.name)]),
  });
}
