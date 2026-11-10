import {
  classifyAchievementRequestSchema,
  setAchievementUnlockedRequestSchema,
} from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  classifyAchievement,
  getFunnel,
  listAchievements,
  setAchievementUnlocked,
  syncAchievementsFromSteam,
} from '../achievements/service.ts';
import type { AppContext } from '../context.ts';

const idParams = z.object({ id: z.string().min(1) });
const unlockParams = z.object({ id: z.string().min(1), achievementId: z.string().min(1) });
const OK = { ok: true } as const;

export function registerAchievementRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/playthroughs/:id/achievements', (request) =>
    listAchievements(db, idParams.parse(request.params).id),
  );
  app.get('/api/playthroughs/:id/funnel', (request) =>
    getFunnel(db, idParams.parse(request.params).id),
  );
  app.put('/api/playthroughs/:id/achievements/:achievementId', (request) => {
    const params = unlockParams.parse(request.params);
    const body = setAchievementUnlockedRequestSchema.parse(request.body);
    setAchievementUnlocked(db, params.id, params.achievementId, body.isUnlocked, ctx.now());
    return OK;
  });
  app.patch('/api/achievements/:id', (request) => {
    classifyAchievement(
      db,
      idParams.parse(request.params).id,
      classifyAchievementRequestSchema.parse(request.body),
    );
    return OK;
  });
  app.post('/api/library/:id/achievements/sync', (request) =>
    syncAchievementsFromSteam(ctx, idParams.parse(request.params).id),
  );
}
