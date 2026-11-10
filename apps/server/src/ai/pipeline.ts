import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import { aiCache, aiUsageLog } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { AiProviderError, estimateTokens, type AiProvider } from './provider.ts';

/**
 * The "data first" pipeline every AI feature goes through:
 *
 * 1. look in the AI cache;
 * 2. only on a miss, collect deterministic context from the sources;
 * 3. trim it to the token budget;
 * 4. ask the AI with a versioned prompt that demands JSON;
 * 5. validate the JSON; on failure retry once with the error attached;
 * 6. cache the answer and log the usage.
 *
 * A repeated request therefore costs zero tokens, and the usage log shows it as a cache hit.
 */

export interface AiTask<TContext, TOutput> {
  /** Stable name of the feature, e.g. `hint` or `chapter_map`. */
  feature: string;
  gameId: string | null;
  /** Everything that makes two requests "the same": checkpoint, goal, level… */
  cacheKeyParts: (string | number | null | undefined)[];
  /** Version of the prompt template. Bumping it invalidates older answers. */
  promptVersion: string;
  schema: z.ZodType<TOutput>;
  maxTokens: number;
  /** How long the answer stays valid. Omit for "until the prompt version changes". */
  ttlMs?: number;
  /** Runs only on a cache miss. */
  collect: () => Promise<TContext>;
  /** Builds the prompts from the collected context and the token budget for it. */
  build: (context: TContext, budgetTokens: number) => { system: string; prompt: string };
}

export interface AiTaskResult<TOutput, TContext> {
  output: TOutput;
  cached: boolean;
  /** The collected context; null on a cache hit, when nothing was collected. */
  context: TContext | null;
}

export function aiCacheKey(
  task: Pick<AiTask<unknown, unknown>, 'feature' | 'gameId' | 'cacheKeyParts' | 'promptVersion'>,
): string {
  const material = JSON.stringify([
    task.feature,
    task.gameId,
    task.promptVersion,
    ...task.cacheKeyParts.map((part) => (part === undefined ? null : part)),
  ]);
  return createHash('sha256').update(material).digest('hex');
}

/** Cuts text to a token budget on a line boundary, so no sentence is fed in half. */
export function fitToBudget(text: string, budgetTokens: number): string {
  if (estimateTokens(text) <= budgetTokens) return text;
  const cut = text.slice(0, budgetTokens * 4);
  const lastBreak = cut.lastIndexOf('\n');
  return (lastBreak > cut.length * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

function logUsage(
  ctx: AppContext,
  entry: {
    feature: string;
    gameId: string | null;
    provider: AiProvider | null;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    cacheHit?: boolean;
    errorCode?: string;
  },
): void {
  ctx.db
    .insert(aiUsageLog)
    .values({
      feature: entry.feature,
      gameId: entry.gameId,
      providerId: entry.provider?.id ?? null,
      model: entry.model ?? null,
      inputTokensEstimated: entry.inputTokens ?? 0,
      outputTokensEstimated: entry.outputTokens ?? 0,
      durationMs: entry.durationMs ?? 0,
      cacheHit: entry.cacheHit ?? false,
      success: !entry.errorCode,
      errorCode: entry.errorCode ?? null,
      createdAt: ctx.now(),
    })
    .run();
}

/** Looks up a cached answer without running anything. */
export function readAiCache<TOutput>(
  ctx: AppContext,
  task: Pick<
    AiTask<unknown, TOutput>,
    'feature' | 'gameId' | 'cacheKeyParts' | 'promptVersion' | 'schema'
  >,
): TOutput | null {
  const row = ctx.db
    .select()
    .from(aiCache)
    .where(eq(aiCache.cacheKey, aiCacheKey(task)))
    .get();
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= ctx.now().getTime()) return null;
  const parsed = task.schema.safeParse((row.response as { value: unknown }).value);
  return parsed.success ? parsed.data : null;
}

export async function runAiTask<TContext, TOutput>(
  ctx: AppContext,
  task: AiTask<TContext, TOutput>,
): Promise<AiTaskResult<TOutput, TContext>> {
  const provider = ctx.ai.getActive();

  // 1. Cache first: an identical request never reaches the AI again.
  const cached = readAiCache(ctx, task);
  if (cached !== null) {
    logUsage(ctx, { feature: task.feature, gameId: task.gameId, provider, cacheHit: true });
    return { output: cached, cached: true, context: null };
  }

  if (!provider) {
    throw new HttpError(409, 'ai_not_connected', 'Connect an AI to use this feature');
  }

  // 2–3. Deterministic context, trimmed by the feature to the budget.
  const context = await task.collect();
  const budget = Math.min(ctx.aiContextBudget(), provider.capabilities.maxContextTokens);
  const { system, prompt } = task.build(context, budget);

  // 4–5. Ask, validate, and retry once with the validation error attached.
  let attemptPrompt = prompt;
  for (let attempt = 0; ; attempt++) {
    try {
      const completion = await provider.complete({
        system,
        prompt: attemptPrompt,
        schema: task.schema,
        maxTokens: task.maxTokens,
      });

      // 6. Remember it and account for it.
      const createdAt = ctx.now();
      const values = {
        cacheKey: aiCacheKey(task),
        feature: task.feature,
        gameId: task.gameId,
        promptVersion: task.promptVersion,
        providerId: provider.id,
        model: completion.model,
        response: { value: completion.output },
        createdAt,
        expiresAt: task.ttlMs ? new Date(createdAt.getTime() + task.ttlMs) : null,
      };
      ctx.db
        .insert(aiCache)
        .values(values)
        .onConflictDoUpdate({ target: aiCache.cacheKey, set: values })
        .run();
      logUsage(ctx, {
        feature: task.feature,
        gameId: task.gameId,
        provider,
        model: completion.model,
        inputTokens: completion.usage.inputTokensEstimated,
        outputTokens: completion.usage.outputTokensEstimated,
        durationMs: completion.usage.durationMs,
      });
      return { output: completion.output, cached: false, context };
    } catch (error) {
      const code = error instanceof AiProviderError ? error.code : 'provider_error';
      logUsage(ctx, {
        feature: task.feature,
        gameId: task.gameId,
        provider,
        inputTokens: estimateTokens(system + attemptPrompt),
        errorCode: code,
      });
      if (error instanceof AiProviderError && error.code === 'invalid_response' && attempt === 0) {
        attemptPrompt =
          `${prompt}\n\nYour previous answer was rejected:\n${error.detail ?? error.message}\n` +
          'Answer again with JSON that fixes exactly that.';
        continue;
      }
      if (error instanceof AiProviderError) {
        throw new HttpError(502, `ai_${error.code}`, error.message);
      }
      throw error;
    }
  }
}
