import {
  configurableSourceSchema,
  consoleImportRequestSchema,
  consoleParamsSchema,
  saveSourceRequestSchema,
  steamImportRequestSchema,
  type AppStateResponse,
  type ConfigurableSource,
  type SourceListResponse,
  type SourceStatus,
  type SourceTestResponse,
} from '@gamebacklog/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { importFromConsole, previewConsoleImport } from '../consoles/service.ts';
import type { AppContext } from '../context.ts';
import type { SecretName } from '../secrets/store.ts';
import { SETTINGS, getSetting, setSetting } from '../settings/store.ts';
import type { SourceHealth } from '../sources/adapter.ts';
import { importFromSteam, previewSteamImport, syncSteamPlaytime } from '../steam/service.ts';

const sourceParams = z.object({ id: configurableSourceSchema });
const OK = { ok: true } as const;

const SECRETS_OF: Record<ConfigurableSource, SecretName[]> = {
  igdb: ['igdb.client_id', 'igdb.client_secret'],
  steam: ['steam.api_key'],
  psn: ['psn.npsso'],
  xbox: ['xbox.openxbl_api_key'],
  hltb: [],
  rawg: ['rawg.api_key'],
  retroachievements: ['retroachievements.username', 'retroachievements.api_key'],
};

/** Shows enough of the SteamID to recognise it without printing it whole. */
const maskSteamId = (steamId: string) => `${steamId.slice(0, 4)}…${steamId.slice(-4)}`;

function sourceStatuses(ctx: AppContext): SourceStatus[] {
  const has = (source: ConfigurableSource) =>
    SECRETS_OF[source].every((name) => Boolean(ctx.secrets.get(name)));
  const steamId = getSetting(ctx.db, SETTINGS.steamId);

  return [
    { id: 'igdb', configured: has('igdb'), enabled: true, detail: null },
    {
      id: 'steam',
      configured: has('steam') && Boolean(steamId),
      enabled: true,
      detail: steamId ? maskSteamId(steamId) : null,
    },
    { id: 'psn', configured: has('psn'), enabled: true, detail: null },
    { id: 'xbox', configured: has('xbox'), enabled: true, detail: null },
    {
      id: 'hltb',
      configured: true,
      enabled: getSetting(ctx.db, SETTINGS.hltbEnabled),
      detail: null,
    },
    { id: 'rawg', configured: has('rawg'), enabled: true, detail: null },
    { id: 'retroachievements', configured: has('retroachievements'), enabled: true, detail: null },
  ];
}

function toTestResponse(health: SourceHealth): SourceTestResponse {
  return { ok: health.status === 'ok', code: health.status };
}

export function registerSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, secrets } = ctx;

  // --- App state ---
  app.get('/api/app/state', (): AppStateResponse => ({
    setupCompleted: getSetting(db, SETTINGS.setupCompleted),
    dataDir: ctx.dataDir,
    steamLastSyncAt: getSetting(db, SETTINGS.steamLastSyncAt),
  }));
  app.post('/api/app/setup-completed', () => {
    setSetting(db, SETTINGS.setupCompleted, true);
    return OK;
  });

  // --- Sources ---
  app.get('/api/sources', (): SourceListResponse => ({
    items: sourceStatuses(ctx),
    secretStore: secrets.kind,
  }));

  app.put('/api/sources', (request) => {
    const body = saveSourceRequestSchema.parse(request.body);
    switch (body.id) {
      case 'igdb':
        secrets.set('igdb.client_id', body.clientId);
        secrets.set('igdb.client_secret', body.clientSecret);
        break;
      case 'steam':
        secrets.set('steam.api_key', body.apiKey);
        setSetting(db, SETTINGS.steamId, body.steamId);
        break;
      case 'psn':
        secrets.set('psn.npsso', body.npsso);
        // A refresh token belongs to the session of the token it came from.
        secrets.delete('psn.refresh_token');
        break;
      case 'xbox':
        secrets.set('xbox.openxbl_api_key', body.apiKey);
        break;
      case 'hltb':
        setSetting(db, SETTINGS.hltbEnabled, body.enabled);
        break;
      case 'rawg':
        secrets.set('rawg.api_key', body.apiKey);
        break;
      case 'retroachievements':
        secrets.set('retroachievements.username', body.username);
        secrets.set('retroachievements.api_key', body.apiKey);
        break;
    }
    return { items: sourceStatuses(ctx), secretStore: secrets.kind };
  });

  app.delete('/api/sources/:id', (request) => {
    const { id } = sourceParams.parse(request.params);
    for (const name of SECRETS_OF[id]) secrets.delete(name);
    if (id === 'steam') setSetting(db, SETTINGS.steamId, null);
    if (id === 'psn') secrets.delete('psn.refresh_token');
    return { items: sourceStatuses(ctx), secretStore: secrets.kind };
  });

  app.post('/api/sources/:id/test', async (request): Promise<SourceTestResponse> => {
    const { id } = sourceParams.parse(request.params);
    if (id === 'igdb') return toTestResponse(await ctx.igdb.healthCheck());
    if (id === 'steam') return toTestResponse(await ctx.steam.healthCheck());
    if (id === 'psn') return toTestResponse(await ctx.psn.healthCheck());
    if (id === 'xbox') return toTestResponse(await ctx.xbox.healthCheck());
    if (id === 'hltb') return toTestResponse(await ctx.hltb.healthCheck());
    if (id === 'retroachievements') return toTestResponse(await ctx.retro.healthCheck());
    // RAWG is stored but not used yet; there is nothing to call.
    const configured = SECRETS_OF[id].every((name) => Boolean(secrets.get(name)));
    return { ok: configured, code: configured ? 'ok' : 'not_configured' };
  });

  // --- Steam library ---
  app.post('/api/steam/import/preview', () => previewSteamImport(ctx));
  app.post('/api/steam/import', (request) =>
    importFromSteam(ctx, steamImportRequestSchema.parse(request.body)),
  );
  app.post('/api/steam/sync', () => syncSteamPlaytime(ctx));

  // --- Console libraries (PSN, Xbox) ---
  app.post('/api/consoles/:platform/import/preview', (request) =>
    previewConsoleImport(ctx, consoleParamsSchema.parse(request.params).platform),
  );
  app.post('/api/consoles/:platform/import', (request) =>
    importFromConsole(
      ctx,
      consoleParamsSchema.parse(request.params).platform,
      consoleImportRequestSchema.parse(request.body),
    ),
  );
}
