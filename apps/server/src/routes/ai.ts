import {
  aiProviderIdSchema,
  saveAiProviderRequestSchema,
  saveAiSettingsRequestSchema,
  type AiModelsResponse,
  type AiTestResponse,
  type AiUsageResponse,
} from '@gamebacklog/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AI_KEY_SECRET } from '../ai/service.ts';
import type { AppContext } from '../context.ts';
import { aiUsageLog, games } from '../db/schema/index.ts';
import { badRequest, notFound } from '../errors.ts';
import { SETTINGS, getSetting, setSetting } from '../settings/store.ts';

const providerParams = z.object({ id: aiProviderIdSchema });
const usageQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

export function registerAiRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, secrets } = ctx;

  const provider = (params: unknown) => {
    const { id } = providerParams.parse(params);
    const found = ctx.ai.providers.get(id);
    if (!found) throw notFound('AI provider');
    return found;
  };

  app.get('/api/ai', () => ctx.ai.overview());

  app.put('/api/ai/settings', (request) => {
    const body = saveAiSettingsRequestSchema.parse(request.body);
    if (body.activeProviderId !== undefined)
      setSetting(db, SETTINGS.aiProvider, body.activeProviderId);
    if (body.contextBudgetTokens !== undefined) {
      setSetting(db, SETTINGS.aiContextBudget, body.contextBudgetTokens);
    }
    return ctx.ai.overview();
  });

  app.put('/api/ai/providers/:id', (request) => {
    const { id } = provider(request.params);
    const body = saveAiProviderRequestSchema.parse(request.body);

    if (body.apiKey !== undefined) {
      const secretName = AI_KEY_SECRET[id];
      if (!secretName)
        throw badRequest('ai_no_key_needed', 'This provider does not take an API key');
      secrets.set(secretName, body.apiKey);
    }
    if (body.model !== undefined) {
      const models = { ...getSetting(db, SETTINGS.aiModels) };
      if (body.model) models[id] = body.model;
      else delete models[id];
      setSetting(db, SETTINGS.aiModels, models);
    }
    if (body.baseUrl !== undefined) {
      const urls = { ...getSetting(db, SETTINGS.aiBaseUrls) };
      if (body.baseUrl) urls[id] = body.baseUrl;
      else delete urls[id];
      setSetting(db, SETTINGS.aiBaseUrls, urls);
    }
    return ctx.ai.overview();
  });

  app.delete('/api/ai/providers/:id/key', (request) => {
    const { id } = provider(request.params);
    const secretName = AI_KEY_SECRET[id];
    if (secretName) secrets.delete(secretName);
    if (getSetting(db, SETTINGS.aiProvider) === id) setSetting(db, SETTINGS.aiProvider, null);
    return ctx.ai.overview();
  });

  app.post('/api/ai/providers/:id/test', async (request): Promise<AiTestResponse> => {
    const health = await provider(request.params).healthCheck();
    return { ok: health.status === 'ok', status: health.status };
  });

  app.get('/api/ai/providers/:id/models', async (request): Promise<AiModelsResponse> => {
    const target = provider(request.params);
    try {
      return { models: (await target.listModels?.()) ?? [] };
    } catch {
      // No list is not a failure: the user can still type the model name.
      return { models: [] };
    }
  });

  app.get('/api/ai/usage', (request): AiUsageResponse => {
    const { limit } = usageQuery.parse(request.query);
    const rows = db
      .select({ log: aiUsageLog, gameTitle: games.title })
      .from(aiUsageLog)
      .leftJoin(games, eq(games.id, aiUsageLog.gameId))
      // Entries logged in the same millisecond keep their insertion order.
      .orderBy(desc(aiUsageLog.createdAt), desc(sql`"ai_usage_log".rowid`))
      .limit(limit)
      .all();
    const totals = db
      .select({
        requests: sql<number>`count(*)`,
        cacheHits: sql<number>`coalesce(sum(${aiUsageLog.cacheHit}), 0)`,
        inputTokens: sql<number>`coalesce(sum(${aiUsageLog.inputTokensEstimated}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageLog.outputTokensEstimated}), 0)`,
      })
      .from(aiUsageLog)
      .get();

    return {
      items: rows.map(({ log, gameTitle }) => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        feature: log.feature,
        providerId: log.providerId,
        model: log.model,
        gameTitle,
        inputTokensEstimated: log.inputTokensEstimated,
        outputTokensEstimated: log.outputTokensEstimated,
        durationMs: log.durationMs,
        cacheHit: log.cacheHit,
        success: log.success,
        errorCode: log.errorCode,
      })),
      totals: totals ?? { requests: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 },
    };
  });
}
