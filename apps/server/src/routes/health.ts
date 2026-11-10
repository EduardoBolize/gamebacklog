import { APP_NAME, healthResponseSchema, type HealthResponse } from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../db/client.ts';
import { readDataSchemaVersion } from '../db/migrate.ts';
import { APP_VERSION } from '../transfer/export.ts';

export function registerHealthRoute(app: FastifyInstance, db: AppDatabase): void {
  app.get('/api/health', (): HealthResponse => {
    // Reading the version from the database also proves the database is reachable.
    const schemaVersion = readDataSchemaVersion(db);
    return healthResponseSchema.parse({
      status: 'ok',
      app: APP_NAME,
      version: APP_VERSION,
      schemaVersion,
    });
  });
}
