import {
  funnelEstimateRequestSchema,
  hintRequestSchema,
  reportProgressRequestSchema,
  saveCheckpointsRequestSchema,
  saveWebSearchRequestSchema,
  setCollectedRequestSchema,
  setWikiRequestSchema,
  type WebSearchSettings,
} from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateChapterMap, getChapterMap, saveCheckpoints } from '../assist/chapter-map.ts';
import { generateAreaChecklist, getAreaChecklist, setCollected } from '../assist/checklist.ts';
import { listRevealedHints, requestHint } from '../assist/hints.ts';
import { estimateFunnel, getAssist } from '../assist/overview.ts';
import { reportProgress } from '../assist/progress.ts';
import { setWikiForGame } from '../assist/wiki.ts';
import type { AppContext } from '../context.ts';
import { requireEntry } from '../library/service.ts';
import { SETTINGS, getSetting, setSetting } from '../settings/store.ts';

const idParams = z.object({ id: z.string().min(1) });
const collectibleParams = z.object({ id: z.string().min(1), collectibleId: z.string().min(1) });
const checklistQuery = z.object({ checkpointId: z.string().min(1).optional() });
const generateMapBody = z.object({ force: z.boolean().optional() }).default({});
const OK = { ok: true } as const;

export function registerAssistRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, secrets } = ctx;
  const id = (params: unknown) => idParams.parse(params).id;

  // --- Chapter map ---
  app.get('/api/playthroughs/:id/map', (request) => getChapterMap(ctx, id(request.params)));
  app.post('/api/library/:id/map/generate', async (request) => {
    const entry = requireEntry(db, id(request.params));
    await generateChapterMap(ctx, entry.gameId, generateMapBody.parse(request.body ?? {}));
    return OK;
  });
  app.put('/api/library/:id/map', (request) => {
    const entry = requireEntry(db, id(request.params));
    saveCheckpoints(ctx, entry.gameId, saveCheckpointsRequestSchema.parse(request.body));
    return OK;
  });
  app.put('/api/library/:id/wiki', async (request) => {
    const entry = requireEntry(db, id(request.params));
    const { wikiUrl } = setWikiRequestSchema.parse(request.body);
    return { wikiUrl: await setWikiForGame(ctx, entry.gameId, wikiUrl) };
  });

  // --- "Where am I?" ---
  app.post('/api/playthroughs/:id/progress', async (request, reply) => {
    const result = await reportProgress(
      ctx,
      id(request.params),
      reportProgressRequestSchema.parse(request.body),
    );
    // 201 when the progress was recorded; 200 when it is waiting for the user to confirm.
    return reply.code(result.saved ? 201 : 200).send(result);
  });

  // --- Hints ---
  app.get('/api/playthroughs/:id/hints', (request) => listRevealedHints(ctx, id(request.params)));
  app.post('/api/playthroughs/:id/hints', (request) =>
    requestHint(ctx, id(request.params), hintRequestSchema.parse(request.body)),
  );

  // --- 100% mode ---
  app.get('/api/playthroughs/:id/checklist', (request) =>
    getAreaChecklist(ctx, id(request.params), checklistQuery.parse(request.query).checkpointId),
  );
  app.post('/api/playthroughs/:id/checklist/generate', (request) =>
    generateAreaChecklist(
      ctx,
      id(request.params),
      checklistQuery.parse(request.query).checkpointId,
    ),
  );
  app.put('/api/playthroughs/:id/collectibles/:collectibleId', (request) => {
    const params = collectibleParams.parse(request.params);
    const body = setCollectedRequestSchema.parse(request.body);
    setCollected(ctx, params.id, params.collectibleId, body.isCollected);
    return OK;
  });

  // --- Proactive questions, recap and the estimated funnel ---
  app.get('/api/playthroughs/:id/assist', (request) => getAssist(ctx, id(request.params)));
  app.post('/api/playthroughs/:id/funnel/estimate', (request) =>
    estimateFunnel(
      ctx,
      id(request.params),
      funnelEstimateRequestSchema.parse(request.body ?? {}).locale,
    ),
  );

  // --- Web search settings ---
  const webSearchSettings = (): WebSearchSettings => ({
    provider: getSetting(db, SETTINGS.webSearchProvider),
    searxngUrl: getSetting(db, SETTINGS.searxngUrl),
    hasBraveKey: Boolean(secrets.get('search.brave.api_key')),
    hasTavilyKey: Boolean(secrets.get('search.tavily.api_key')),
  });
  app.get('/api/search', webSearchSettings);
  app.put('/api/search', (request) => {
    const body = saveWebSearchRequestSchema.parse(request.body);
    if (body.provider !== undefined) setSetting(db, SETTINGS.webSearchProvider, body.provider);
    if (body.searxngUrl !== undefined) setSetting(db, SETTINGS.searxngUrl, body.searxngUrl);
    if (body.braveKey !== undefined) secrets.set('search.brave.api_key', body.braveKey);
    if (body.tavilyKey !== undefined) secrets.set('search.tavily.api_key', body.tavilyKey);
    return webSearchSettings();
  });
}
