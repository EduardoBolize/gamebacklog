import {
  addGameRequestSchema,
  createPlaythroughRequestSchema,
  createProgressRequestSchema,
  createSessionRequestSchema,
  saveReviewRequestSchema,
  setManualTimesRequestSchema,
  updateLibraryEntryRequestSchema,
  updatePlaythroughRequestSchema,
  updateSessionRequestSchema,
} from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import {
  addProgress,
  createSession,
  deleteReview,
  deleteSession,
  listProgress,
  listReviews,
  listSessions,
  saveReview,
  updateSession,
} from '../library/journal.ts';
import {
  addGame,
  createPlaythrough,
  deletePlaythrough,
  getGameDetail,
  listLibrary,
  removeLibraryEntry,
  requireEntry,
  searchCatalog,
  updateLibraryEntry,
  updatePlaythrough,
} from '../library/service.ts';
import { getEffectiveTimes, refreshTimesFromHltb, setManualTimes } from '../library/times.ts';
import { SourceError } from '../sources/adapter.ts';

const idParams = z.object({ id: z.string().min(1) });
const searchQuery = z.object({ q: z.string().max(200).default('') });
const OK = { ok: true } as const;

export function registerLibraryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const id = (params: unknown) => idParams.parse(params).id;

  app.get('/api/catalog/search', (request) =>
    searchCatalog(ctx, searchQuery.parse(request.query).q),
  );

  // --- Library entries ---
  app.get('/api/library', () => ({ items: listLibrary(db) }));
  app.post('/api/library', async (request, reply) => {
    const result = await addGame(ctx, addGameRequestSchema.parse(request.body));
    return reply.code(result.created ? 201 : 200).send(result);
  });
  app.get('/api/library/:id', (request) => getGameDetail(db, id(request.params)));
  app.patch('/api/library/:id', (request) =>
    updateLibraryEntry(
      ctx,
      id(request.params),
      updateLibraryEntryRequestSchema.parse(request.body),
    ),
  );
  app.delete('/api/library/:id', (request) => {
    removeLibraryEntry(db, id(request.params));
    return OK;
  });

  // --- Times to beat ---
  app.put('/api/library/:id/times', (request) => {
    const entry = requireEntry(db, id(request.params));
    return {
      times: setManualTimes(db, entry.gameId, setManualTimesRequestSchema.parse(request.body)),
    };
  });
  app.post('/api/library/:id/times/refresh', async (request) => {
    const entry = requireEntry(db, id(request.params));
    try {
      return { times: await refreshTimesFromHltb(ctx, entry.gameId), sourceFailed: false };
    } catch (error) {
      // HowLongToBeat failing is expected now and then: answer with what we have.
      if (!(error instanceof SourceError)) throw error;
      return { times: getEffectiveTimes(db, entry.gameId), sourceFailed: true };
    }
  });

  // --- Playthroughs ---
  app.post('/api/library/:id/playthroughs', (request, reply) =>
    reply
      .code(201)
      .send(
        createPlaythrough(
          db,
          id(request.params),
          createPlaythroughRequestSchema.parse(request.body),
        ),
      ),
  );
  app.patch('/api/playthroughs/:id', (request) =>
    updatePlaythrough(db, id(request.params), updatePlaythroughRequestSchema.parse(request.body)),
  );
  app.delete('/api/playthroughs/:id', (request) => {
    deletePlaythrough(db, id(request.params));
    return OK;
  });

  // --- "Where am I?" ---
  app.get('/api/playthroughs/:id/progress', (request) => ({
    items: listProgress(db, id(request.params)),
  }));
  app.post('/api/playthroughs/:id/progress', (request, reply) =>
    reply
      .code(201)
      .send(
        addProgress(
          db,
          id(request.params),
          createProgressRequestSchema.parse(request.body),
          ctx.now(),
        ),
      ),
  );

  // --- Sessions ---
  app.get('/api/library/:id/sessions', (request) => ({
    items: listSessions(db, id(request.params)),
  }));
  app.post('/api/library/:id/sessions', (request, reply) =>
    reply
      .code(201)
      .send(createSession(db, id(request.params), createSessionRequestSchema.parse(request.body))),
  );
  app.patch('/api/sessions/:id', (request) =>
    updateSession(db, id(request.params), updateSessionRequestSchema.parse(request.body)),
  );
  app.delete('/api/sessions/:id', (request) => {
    deleteSession(db, id(request.params));
    return OK;
  });

  // --- Reviews ---
  app.get('/api/library/:id/reviews', (request) => ({
    items: listReviews(db, id(request.params)),
  }));
  app.put('/api/library/:id/reviews', (request) =>
    saveReview(db, id(request.params), saveReviewRequestSchema.parse(request.body), ctx.now()),
  );
  app.delete('/api/reviews/:id', (request) => {
    deleteReview(db, id(request.params));
    return OK;
  });
}
