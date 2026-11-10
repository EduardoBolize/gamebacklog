import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { registerErrorHandler } from './errors.ts';
import { registerAchievementRoutes } from './routes/achievements.ts';
import { registerHealthRoute } from './routes/health.ts';
import { registerLibraryRoutes } from './routes/library.ts';
import { registerSourceRoutes } from './routes/sources.ts';
import { registerTransferRoutes } from './routes/transfer.ts';

export interface BuildAppOptions {
  ctx: AppContext;
  /** Built web app to serve (production). Omit in dev, where Vite serves the web app. */
  webDistDir?: string;
  logger?: boolean;
}

/** Export files with caches can be large; everything else is tiny. */
const BODY_LIMIT_BYTES = 200 * 1024 * 1024;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { ctx, webDistDir } = options;
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: BODY_LIMIT_BYTES });

  registerErrorHandler(app);
  registerHealthRoute(app, ctx.db);
  registerLibraryRoutes(app, ctx);
  registerAchievementRoutes(app, ctx);
  registerSourceRoutes(app, ctx);
  registerTransferRoutes(app, ctx);

  if (webDistDir) {
    if (!existsSync(path.join(webDistDir, 'index.html'))) {
      throw new Error(`Web build not found at ${webDistDir}. Run "pnpm build" first.`);
    }
    await app.register(fastifyStatic, { root: webDistDir });
  }

  app.setNotFoundHandler((request, reply) => {
    const isPageRequest = request.method === 'GET' && !request.url.startsWith('/api/');
    if (webDistDir && isPageRequest) {
      // Client-side routes: let the web app handle the URL.
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
