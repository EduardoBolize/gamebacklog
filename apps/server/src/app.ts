import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppDatabase } from './db/client.ts';
import { registerHealthRoute } from './routes/health.ts';

export interface BuildAppOptions {
  db: AppDatabase;
  /** Built web app to serve (production). Omit in dev, where Vite serves the web app. */
  webDistDir?: string;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  registerHealthRoute(app, options.db);

  const { webDistDir } = options;
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
