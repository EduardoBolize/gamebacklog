import type { FunnelEstimateResponse, GameAssistResponse, Provenance } from '@gamebacklog/shared';
import { and, desc, eq } from 'drizzle-orm';
import { runAiTask } from '../ai/pipeline.ts';
import {
  FUNNEL_ESTIMATE_PROMPT_VERSION,
  buildFunnelEstimatePrompt,
  funnelEstimateSchema,
} from '../ai/prompts/funnel-estimate.ts';
import type { AppContext } from '../context.ts';
import {
  achievementProgress,
  achievements,
  collectibleProgress,
  collectibles,
  progressEvents,
  sessions,
} from '../db/schema/index.ts';
import { getEffectiveTimes } from '../library/times.ts';
import { SETTINGS, getSetting } from '../settings/store.ts';
import { gameOfPlaythrough, loadMap } from './chapter-map.ts';
import { renderSources } from './wiki.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Proactive questions and the "where I left off" recap. Everything here is derived from data
 * already in the database, so opening a game never costs an AI call.
 */
export function getAssist(ctx: AppContext, playthroughId: string): GameAssistResponse {
  const { db } = ctx;
  const { playthrough, entry, game } = gameOfPlaythrough(db, playthroughId);
  const rows = loadMap(db, game.id)?.checkpoints ?? [];
  const current = rows.find((row) => row.id === playthrough.currentCheckpointId) ?? null;
  const next = current ? rows.find((row) => row.position === current.position + 1) : undefined;

  const questions: GameAssistResponse['questions'] = [];
  if (current) {
    if (current.bossName) {
      questions.push({ kind: 'boss_hint', subject: current.bossName, count: null });
    }

    const collected = new Set(
      db
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
    const waiting = db
      .select({ id: collectibles.id })
      .from(collectibles)
      .where(and(eq(collectibles.gameId, game.id), eq(collectibles.checkpointId, current.id)))
      .all()
      .filter((row) => !collected.has(row.id)).length;
    if (waiting > 0)
      questions.push({ kind: 'collectibles', subject: current.name, count: waiting });

    // Missables only matter while there is still a door about to close.
    const pointOfNoReturn = rows.find(
      (row) => row.isPointOfNoReturn && row.position > current.position,
    );
    if (pointOfNoReturn) {
      const before = new Set(
        rows.filter((row) => row.position < pointOfNoReturn.position).map((row) => row.id),
      );
      const unlocked = new Set(
        db
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
      const pending = db
        .select({ id: achievements.id, checkpointId: achievements.checkpointId })
        .from(achievements)
        .where(and(eq(achievements.gameId, game.id), eq(achievements.isMissable, true)))
        .all()
        .filter(
          (row) => row.checkpointId && before.has(row.checkpointId) && !unlocked.has(row.id),
        ).length;
      if (pending > 0) {
        questions.push({ kind: 'missables', subject: pointOfNoReturn.name, count: pending });
      }
    }
  }

  // Recap: only for a run that was going on and then went quiet.
  const lastProgress = db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.playthroughId, playthroughId))
    .orderBy(desc(progressEvents.occurredAt), progressEvents.id)
    .get();
  const recentSessions = db
    .select()
    .from(sessions)
    .where(eq(sessions.libraryEntryId, entry.id))
    .orderBy(desc(sessions.startedAt), sessions.id)
    .all();
  const lastActivity = Math.max(
    lastProgress?.occurredAt.getTime() ?? 0,
    recentSessions[0]?.startedAt.getTime() ?? 0,
  );
  const daysIdle = lastActivity ? Math.floor((ctx.now().getTime() - lastActivity) / DAY_MS) : 0;
  const inProgress = playthrough.status === 'playing' || playthrough.status === 'paused';
  const showRecap =
    inProgress && lastActivity > 0 && daysIdle >= getSetting(db, SETTINGS.recapAfterDays);

  return {
    questions,
    recap: showRecap
      ? {
          daysIdle,
          lastProgress: lastProgress
            ? { rawText: lastProgress.rawText, occurredAt: lastProgress.occurredAt.toISOString() }
            : null,
          currentCheckpoint: current?.name ?? null,
          nextCheckpoint: next?.name ?? null,
          lastNotes: recentSessions
            .filter((session) => session.note)
            .slice(0, 3)
            .map((session) => ({
              note: session.note ?? '',
              startedAt: session.startedAt.toISOString(),
            })),
        }
      : null,
  };
}

/**
 * Abandonment estimate for games with no achievement data. It is an estimate, labelled as one
 * everywhere it appears: the AI reasons from whatever the web search found plus the game's
 * length and genre.
 */
export async function estimateFunnel(
  ctx: AppContext,
  playthroughId: string,
  locale: string,
): Promise<FunnelEstimateResponse> {
  const { game } = gameOfPlaythrough(ctx.db, playthroughId);
  const times = getEffectiveTimes(ctx.db, game.id);
  const mainHours = times?.mainMinutes ? Math.round(times.mainMinutes / 60) : null;

  const result = await runAiTask(ctx, {
    feature: 'funnel_estimate',
    gameId: game.id,
    cacheKeyParts: [mainHours, locale],
    promptVersion: FUNNEL_ESTIMATE_PROMPT_VERSION,
    schema: funnelEstimateSchema,
    maxTokens: 500,
    collect: () =>
      ctx.webSearch
        .search(`${game.title} percentage of players who finished the game completion rate`, 5)
        .catch(() => []),
    build: (results, budget) =>
      buildFunnelEstimatePrompt({
        title: game.title,
        releaseYear: game.releaseYear,
        genres: game.genres,
        mainHours,
        locale,
        sources: renderSources(
          results
            .filter((item) => item.snippet)
            .map((item) => ({
              title: item.title,
              url: item.url,
              sections: [{ heading: '', text: item.snippet }],
            })),
          ['percent', 'finished', 'completed', 'players'],
          budget,
        ),
      }),
  });

  // Sources are only known when the context was collected; a cached answer keeps none.
  const sources: Provenance[] = (result.context ?? []).map((item) => ({
    origin: 'web_search',
    url: item.url,
  }));
  return {
    percentFinished: Math.round(result.output.percentFinished * 10) / 10,
    rationale: result.output.rationale,
    sources,
    cached: result.cached,
  };
}
