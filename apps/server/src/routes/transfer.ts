import {
  backupSettingsSchema,
  importRequestSchema,
  type ImportResultResponse,
} from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { localDate, type AppContext } from '../context.ts';
import {
  getBackupStatus,
  runBackup,
  saveBackupSettings,
  writeSafetyBackup,
} from '../transfer/backup.ts';
import { buildExport, parseExportFile } from '../transfer/export.ts';
import { applyImport, planImport } from '../transfer/import.ts';

const exportQuery = z.object({ includeCaches: z.enum(['true', 'false']).default('false') });

export function registerTransferRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/export', (request, reply) => {
    const { includeCaches } = exportQuery.parse(request.query);
    const file = buildExport(db, { includeCaches: includeCaches === 'true', now: ctx.now() });
    return reply
      .header(
        'Content-Disposition',
        `attachment; filename="gamebacklog-export-${localDate(ctx.now())}.json"`,
      )
      .send(file);
  });

  app.post('/api/import/preview', (request) => {
    const body = importRequestSchema.parse(request.body);
    const { file, originalVersion } = parseExportFile(body.file);
    return planImport(db, file, body.mode, originalVersion).preview;
  });

  app.post('/api/import', (request): ImportResultResponse => {
    const body = importRequestSchema.parse(request.body);
    const { file, originalVersion } = parseExportFile(body.file);
    const plan = planImport(db, file, body.mode, originalVersion);
    // A replace throws away what is here, so keep a copy first.
    const backupFile = body.mode === 'replace' ? writeSafetyBackup(ctx) : null;
    applyImport(db, plan);
    return { ...plan.preview, backupFile };
  });

  app.get('/api/backup', () => getBackupStatus(ctx));
  app.put('/api/backup', (request) =>
    saveBackupSettings(ctx, backupSettingsSchema.parse(request.body)),
  );
  app.post('/api/backup/run', () => runBackup(ctx));
}
