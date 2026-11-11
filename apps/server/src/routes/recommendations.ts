import {
  explainRecommendationsRequestSchema,
  recommendationLocaleSchema,
} from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import {
  explainRecommendations,
  getFavoriteGenre,
  getPlayNext,
  getSimilarCompletion,
  getSimilarGames,
  getTasteProfile,
} from '../recommendations/service.ts';

const idParams = z.object({ id: z.string().min(1) });
/** The locale only picks which cached AI lines to show; the lists themselves do not depend on it. */
const listQuery = z.object({ locale: recommendationLocaleSchema.default('pt-BR') });
const genreQuery = listQuery.extend({ genre: z.string().trim().min(1).max(80).optional() });

export function registerRecommendationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const id = (params: unknown) => idParams.parse(params).id;
  const locale = (query: unknown) => listQuery.parse(query).locale;

  app.get('/api/recommendations/profile', () => getTasteProfile(ctx));
  app.get('/api/recommendations/play-next', (request) => getPlayNext(ctx, locale(request.query)));
  app.get('/api/recommendations/similar/:id', (request) =>
    getSimilarGames(ctx, id(request.params), locale(request.query)),
  );
  app.get('/api/recommendations/completion/:id', (request) =>
    getSimilarCompletion(ctx, id(request.params), locale(request.query)),
  );
  app.get('/api/recommendations/genre', (request) => {
    const query = genreQuery.parse(request.query);
    return getFavoriteGenre(ctx, query.genre, query.locale);
  });

  // The only route here that can reach the AI, and only when the user asks.
  app.post('/api/recommendations/explain', (request) =>
    explainRecommendations(ctx, explainRecommendationsRequestSchema.parse(request.body)),
  );
}
