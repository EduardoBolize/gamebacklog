import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { getNudges, getStats } from '../stats/service.ts';

export function registerStatsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/stats', () => getStats(ctx));
  app.get('/api/library/nudges', () => getNudges(ctx));
}
