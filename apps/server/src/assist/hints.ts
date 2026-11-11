import type {
  HintRequest,
  HintResponse,
  Provenance,
  RevealedHintsResponse,
} from '@gamebacklog/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { aiCacheKey, runAiTask } from '../ai/pipeline.ts';
import { HINT_PROMPT_VERSION, buildHintPrompt, hintSchema } from '../ai/prompts/hint.ts';
import type { AppContext } from '../context.ts';
import { hintsCache } from '../db/schema/index.ts';
import { conflict } from '../errors.ts';
import { gameOfPlaythrough, loadMap } from './chapter-map.ts';
import { collectWikiDocs, normalizeText, renderSources, type ContextDoc } from './wiki.ts';

interface HintContext {
  docs: ContextDoc[];
}

/**
 * One rung of the hint ladder. Each level is generated only when asked for, cached for good,
 * and returned with the sources it was built from.
 *
 * Puzzles have to be climbed one level at a time, so the answer is never one click away.
 * Boss fights can open at any level: knowing the strategy spoils nothing.
 */
export async function requestHint(
  ctx: AppContext,
  playthroughId: string,
  request: HintRequest,
): Promise<HintResponse> {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const checkpoint =
    loadMap(ctx.db, game.id)?.checkpoints.find(
      (row) => row.id === playthrough.currentCheckpointId,
    ) ?? null;
  const stuckOn = request.stuckOn?.trim() || null;

  const identity = (level: number) => ({
    feature: 'hint',
    gameId: game.id,
    cacheKeyParts: [
      checkpoint?.id ?? null,
      request.kind,
      level,
      normalizeText(stuckOn ?? ''),
      request.locale,
    ],
    promptVersion: HINT_PROMPT_VERSION,
  });
  const cacheKey = aiCacheKey(identity(request.level));
  const stored = (key: string) =>
    ctx.db.select().from(hintsCache).where(eq(hintsCache.cacheKey, key)).get();

  if (
    request.kind === 'puzzle' &&
    request.level > 1 &&
    !stored(aiCacheKey(identity(request.level - 1)))
  ) {
    throw conflict('hint_level_locked', 'Open the previous hint level first');
  }

  const result = await runAiTask<HintContext, ReturnType<typeof hintSchema.parse>>(ctx, {
    ...identity(request.level),
    schema: hintSchema,
    maxTokens: request.level === 4 ? 1500 : 600,
    async collect() {
      const docs = await collectWikiDocs(ctx, game.id, [
        request.kind === 'boss' ? checkpoint?.bossName : null,
        stuckOn && checkpoint ? `${checkpoint.name} ${stuckOn}` : stuckOn,
        checkpoint?.name,
      ]);
      // Guides found by the optional web search join as extra, clearly attributed sources.
      const query = [
        game.title,
        checkpoint?.name,
        stuckOn,
        request.kind === 'boss' ? 'boss guide' : 'guide',
      ]
        .filter(Boolean)
        .join(' ');
      const found = await ctx.webSearch.search(query, 3).catch(() => []);
      for (const item of found) {
        if (!item.snippet) continue;
        docs.push({
          title: item.title,
          url: item.url,
          sections: [{ heading: '', text: item.snippet }],
          provenance: { origin: 'web_search', url: item.url, fetchedAt: ctx.now().toISOString() },
        });
      }
      return { docs };
    },
    build: ({ docs }, budget) =>
      buildHintPrompt({
        title: game.title,
        checkpoint: checkpoint?.name ?? null,
        bossName: checkpoint?.bossName ?? null,
        kind: request.kind,
        level: request.level,
        stuckOn,
        locale: request.locale,
        sources: renderSources(docs, [checkpoint?.name, checkpoint?.bossName, stuckOn], budget),
      }),
  });

  let sources: Provenance[];
  if (result.context) {
    const { docs } = result.context;
    const used = result.output.sources
      .map((number) => docs[number - 1])
      .filter((doc) => doc !== undefined);
    // If the model named no source, show everything it was given rather than nothing.
    sources = (used.length > 0 ? used : docs).map((doc) => doc.provenance);
    const values = {
      cacheKey,
      gameId: game.id,
      checkpointId: checkpoint?.id ?? null,
      kind: request.kind,
      level: request.level,
      stuckOn,
      content: { text: result.output.hint, locale: request.locale },
      sources,
      promptVersion: HINT_PROMPT_VERSION,
      providerId: ctx.ai.getActive()?.id ?? null,
      createdAt: ctx.now(),
    };
    ctx.db
      .insert(hintsCache)
      .values(values)
      .onConflictDoUpdate({ target: hintsCache.cacheKey, set: values })
      .run();
  } else {
    sources = stored(cacheKey)?.sources ?? [];
  }

  return {
    kind: request.kind,
    level: request.level,
    text: result.output.hint,
    sources,
    cached: result.cached,
  };
}

/** Hints already revealed where the player is now. Reading them again costs nothing. */
export function listRevealedHints(ctx: AppContext, playthroughId: string): RevealedHintsResponse {
  const { playthrough, game } = gameOfPlaythrough(ctx.db, playthroughId);
  const checkpoint =
    loadMap(ctx.db, game.id)?.checkpoints.find(
      (row) => row.id === playthrough.currentCheckpointId,
    ) ?? null;
  const rows = ctx.db
    .select()
    .from(hintsCache)
    .where(
      and(
        eq(hintsCache.gameId, game.id),
        checkpoint ? eq(hintsCache.checkpointId, checkpoint.id) : isNull(hintsCache.checkpointId),
      ),
    )
    .orderBy(hintsCache.createdAt, hintsCache.level)
    .all();

  return {
    checkpoint: checkpoint?.name ?? null,
    items: rows.map((row) => ({
      kind: row.kind,
      level: Math.min(4, Math.max(1, row.level)) as 1 | 2 | 3 | 4,
      stuckOn: row.stuckOn,
      text: (row.content as { text?: string }).text ?? '',
      sources: row.sources,
    })),
    aiConnected: ctx.ai.getActive() !== null,
  };
}
