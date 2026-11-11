import type {
  AchievementListResponse,
  GameDetailResponse,
  LibraryListResponse,
  SourceListResponse,
  SteamImportPreviewResponse,
  SteamImportResponse,
} from '@gamebacklog/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameExternalIds, games } from '../db/schema/index.ts';
import type { ConsoleGame } from '../sources/types.ts';
import { catalogGame, createTestApp, type TestApp } from '../test/context.ts';

let t: TestApp;

async function call<T = unknown>(method: string, url: string, payload?: unknown) {
  const response = await t.app.inject({
    method: method as 'GET',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json<T>() };
}

const consoleGame = (overrides: Partial<ConsoleGame> & { titleId: string; name: string }) => ({
  platform: 'PlayStation 5',
  coverUrl: null,
  playtimeMinutes: null,
  lastPlayedAt: null,
  progressPercent: null,
  ...overrides,
});

const library = async () => (await call<LibraryListResponse>('GET', '/api/library')).body.items;

beforeEach(async () => {
  t = await createTestApp();
  t.sources.catalog = [
    catalogGame({
      externalId: '100',
      title: 'Bloodborne',
      platforms: ['PlayStation 4'],
      genres: ['Role-playing (RPG)'],
    }),
    // Same name on another platform: the one released on the console should win.
    catalogGame({ externalId: '101', title: 'Astro Bot', platforms: ['Arcade'] }),
    catalogGame({
      externalId: '102',
      title: 'Astro Bot',
      platforms: ['PlayStation 5'],
      alternativeTitles: ['ASTRO BOT'],
    }),
    catalogGame({ externalId: '103', title: 'Hades', steamAppIds: ['1145360'] }),
  ];
  t.sources.consoles.psn.games = [
    consoleGame({
      titleId: 'trophy2:NPWR22392_00',
      name: 'ASTRO BOT',
      progressPercent: 100,
      playtimeMinutes: 900,
    }),
    consoleGame({
      titleId: 'trophy:NPWR05506_00',
      name: 'Bloodborne™',
      platform: 'PlayStation 4',
      progressPercent: 41,
      lastPlayedAt: '2026-11-08T12:00:00.000Z',
    }),
    consoleGame({ titleId: 'trophy2:NPWR99999_00', name: 'Jogo Que a IGDB Não Conhece' }),
    consoleGame({ titleId: 'trophy2:NPWR11111_00', name: 'Hades', progressPercent: 12 }),
  ];
});

afterEach(() => t.close());

describe('console import', () => {
  it('previews the account without writing anything', async () => {
    const { status, body } = await call<SteamImportPreviewResponse>(
      'POST',
      '/api/consoles/psn/import/preview',
    );
    expect(status).toBe(200);
    expect(body.catalogAvailable).toBe(true);
    expect(
      body.items.map((item) => [
        item.name,
        item.detail,
        item.suggestedStatus,
        item.playtimeMinutes,
      ]),
    ).toEqual([
      // All trophies earned; played this week; never started; started and left.
      ['ASTRO BOT', 'PlayStation 5', 'completed_100', 900],
      ['Bloodborne™', 'PlayStation 4', 'playing', 0],
      ['Jogo Que a IGDB Não Conhece', 'PlayStation 5', 'backlog', 0],
      ['Hades', 'PlayStation 5', 'paused', 0],
    ]);
    expect(await library()).toHaveLength(0);
  });

  it('imports the chosen games, matching them to the catalog by name', async () => {
    const { body } = await call<SteamImportResponse>('POST', '/api/consoles/psn/import', {
      items: [
        { appId: 'trophy2:NPWR22392_00', status: 'completed_100' },
        { appId: 'trophy:NPWR05506_00', status: 'playing' },
        { appId: 'trophy2:NPWR99999_00', status: 'backlog' },
        { appId: 'not-on-the-account', status: 'backlog' },
      ],
    });
    expect(body).toEqual({ imported: 3, updated: 0, skipped: 1 });

    const items = await library();
    const byTitle = new Map(items.map((item) => [item.game.title, item]));
    expect(byTitle.get('Astro Bot')).toMatchObject({
      status: 'completed_100',
      platform: 'PlayStation 5',
    });
    expect(byTitle.get('Bloodborne')).toMatchObject({
      status: 'playing',
      platform: 'PlayStation 4',
    });
    expect(byTitle.get('Bloodborne')?.game.genres).toEqual(['Role-playing (RPG)']);
    // Not in the catalog: it still comes in, under the console's own name.
    expect(byTitle.get('Jogo Que a IGDB Não Conhece')).toMatchObject({ status: 'backlog' });

    // The PS5 release was picked over the arcade game of the same name.
    const astro = t.ctx.db.select().from(games).where(eq(games.title, 'Astro Bot')).all();
    expect(astro).toHaveLength(1);
    const links = t.ctx.db
      .select()
      .from(gameExternalIds)
      .where(eq(gameExternalIds.gameId, astro[0]?.id ?? ''))
      .all();
    expect(links.map((link) => `${link.source}:${link.externalId}`).sort()).toEqual([
      'igdb:102',
      'psn:trophy2:NPWR22392_00',
    ]);

    const detail = await call<GameDetailResponse>(
      'GET',
      `/api/library/${byTitle.get('Astro Bot')?.id}`,
    );
    expect(detail.body.playthroughs[0]).toMatchObject({ playtimeMinutes: 900, goal: 'full_100' });

    // Importing again changes nothing but the hours.
    const again = await call<SteamImportResponse>('POST', '/api/consoles/psn/import', {
      items: [{ appId: 'trophy2:NPWR22392_00', status: 'backlog' }],
    });
    expect(again.body).toEqual({ imported: 0, updated: 1, skipped: 0 });
    expect(await library()).toHaveLength(3);
  });

  it('links a game that is already in the library instead of adding it twice', async () => {
    const added = await call<{ libraryEntryId: string }>('POST', '/api/library', {
      status: 'playing',
      platform: 'PC',
      game: { kind: 'igdb', externalId: '103' },
    });
    const { body } = await call<SteamImportResponse>('POST', '/api/consoles/psn/import', {
      items: [{ appId: 'trophy2:NPWR11111_00', status: 'paused' }],
    });
    expect(body).toEqual({ imported: 0, updated: 1, skipped: 0 });

    const items = await library();
    expect(items).toHaveLength(1);
    // The user's own status and platform are left alone.
    expect(items[0]).toMatchObject({
      id: added.body.libraryEntryId,
      status: 'playing',
      platform: 'PC',
    });

    const preview = await call<SteamImportPreviewResponse>(
      'POST',
      '/api/consoles/psn/import/preview',
    );
    expect(preview.body.items.find((item) => item.name === 'Hades')?.libraryEntryId).toBe(
      added.body.libraryEntryId,
    );
  });

  it('imports with the console names when the catalog is not configured', async () => {
    t.sources.catalogConfigured = false;
    const { body } = await call<SteamImportResponse>('POST', '/api/consoles/xbox/import', {
      items: [{ appId: '1144039928', status: 'backlog' }],
    });
    // Nothing on the Xbox account yet.
    expect(body).toEqual({ imported: 0, updated: 0, skipped: 1 });

    t.sources.consoles.xbox.games = [
      consoleGame({ titleId: '1144039928', name: 'Halo Infinite', platform: 'Xbox Series X|S' }),
    ];
    const imported = await call<SteamImportResponse>('POST', '/api/consoles/xbox/import', {
      items: [{ appId: '1144039928', status: 'backlog' }],
    });
    expect(imported.body).toMatchObject({ imported: 1 });
    expect((await library())[0]).toMatchObject({
      platform: 'Xbox Series X|S',
      game: { title: 'Halo Infinite' },
    });
  });

  it('says so when the account is not connected, and rejects unknown consoles', async () => {
    t.sources.consoles.psn.configured = false;
    const preview = await call('POST', '/api/consoles/psn/import/preview');
    expect(preview.status).toBe(409);
    expect(preview.body).toMatchObject({ error: 'source_not_configured' });
    expect((await call('POST', '/api/consoles/switch/import/preview')).status).toBe(400);
  });
});

describe('trophies and achievements from a console account', () => {
  const trophies = [
    {
      id: '0',
      name: 'Chapter 1 Complete',
      description: 'Finish the first chapter.',
      iconUrl: null,
      isHidden: false,
      globalPercent: 80,
      isUnlocked: true,
      unlockedAt: '2026-11-02T20:00:00.000Z',
    },
    {
      id: '1',
      name: 'Collector',
      description: null,
      iconUrl: null,
      isHidden: true,
      globalPercent: 4,
      isUnlocked: false,
      unlockedAt: null,
    },
  ];

  async function importBloodborne() {
    await call('POST', '/api/consoles/psn/import', {
      items: [{ appId: 'trophy:NPWR05506_00', status: 'playing' }],
    });
    const entry = (await library())[0];
    const detail = await call<GameDetailResponse>('GET', `/api/library/${entry?.id}`);
    return { entryId: entry?.id ?? '', runId: detail.body.playthroughs[0]?.id ?? '' };
  }

  it('syncs the trophy list of a PSN game with the unlocks of the account', async () => {
    t.sources.consoles.psn.achievements['trophy:NPWR05506_00'] = trophies;
    const { entryId, runId } = await importBloodborne();

    const before = await call<AchievementListResponse>(
      'GET',
      `/api/playthroughs/${runId}/achievements`,
    );
    expect(before.body).toMatchObject({ items: [], syncSource: 'psn', steamAppId: null });

    const sync = await call('POST', `/api/library/${entryId}/achievements/sync`);
    expect(sync.body).toEqual({ total: 2, unlocked: 1, playerDataAvailable: true });

    const list = await call<AchievementListResponse>(
      'GET',
      `/api/playthroughs/${runId}/achievements`,
    );
    expect(list.body.syncedAt).not.toBeNull();
    expect(
      list.body.items.map((item) => [item.name, item.origin, item.isUnlocked, item.isStory]),
    ).toEqual([
      ['Chapter 1 Complete', 'psn', true, true],
      ['Collector', 'psn', false, false],
    ]);

    // Syncing again does not duplicate the list.
    await call('POST', `/api/library/${entryId}/achievements/sync`);
    const again = await call<AchievementListResponse>(
      'GET',
      `/api/playthroughs/${runId}/achievements`,
    );
    expect(again.body.items).toHaveLength(2);
  });

  it('syncs from the account that matches the platform the game is played on', async () => {
    // Hades is on Steam (through the catalog) and on PSN.
    const added = await call<{ libraryEntryId: string }>('POST', '/api/library', {
      status: 'playing',
      platform: 'PC',
      game: { kind: 'igdb', externalId: '103' },
    });
    const entryId = added.body.libraryEntryId;
    await call('POST', '/api/consoles/psn/import', {
      items: [{ appId: 'trophy2:NPWR11111_00', status: 'playing' }],
    });
    const detail = await call<GameDetailResponse>('GET', `/api/library/${entryId}`);
    const runId = detail.body.playthroughs[0]?.id ?? '';
    const source = async () =>
      (await call<AchievementListResponse>('GET', `/api/playthroughs/${runId}/achievements`)).body
        .syncSource;

    expect(await source()).toBe('steam');
    await call('PATCH', `/api/library/${entryId}`, { platform: 'PlayStation 5' });
    expect(await source()).toBe('psn');
  });

  it('answers 409 for a game linked to no account', async () => {
    const added = await call<{ libraryEntryId: string }>('POST', '/api/library', {
      status: 'playing',
      game: { kind: 'manual', title: 'Jogo Caseiro' },
    });
    const sync = await call('POST', `/api/library/${added.body.libraryEntryId}/achievements/sync`);
    expect(sync.status).toBe(409);
    expect(sync.body).toMatchObject({ error: 'no_steam_app' });
  });
});

describe('connecting the console accounts', () => {
  const sources = async () => (await call<SourceListResponse>('GET', '/api/sources')).body.items;

  it('stores the PSN token and the OpenXBL key as secrets and reports only whether they exist', async () => {
    expect((await sources()).find((item) => item.id === 'psn')).toMatchObject({
      configured: false,
    });

    const bad = await call('PUT', '/api/sources', { id: 'psn', npsso: 'too-short' });
    expect(bad.status).toBe(400);

    const npsso = 'a1B2'.repeat(16);
    const saved = await call<SourceListResponse>('PUT', '/api/sources', { id: 'psn', npsso });
    expect(saved.body.items.find((item) => item.id === 'psn')).toMatchObject({
      configured: true,
      detail: null,
    });
    expect(JSON.stringify(saved.body)).not.toContain(npsso);
    expect(t.ctx.secrets.get('psn.npsso')).toBe(npsso);

    await call('PUT', '/api/sources', { id: 'xbox', apiKey: 'XBL-KEY' });
    expect(t.ctx.secrets.get('xbox.openxbl_api_key')).toBe('XBL-KEY');
    expect((await call('POST', '/api/sources/xbox/test')).body).toEqual({ ok: true, code: 'ok' });

    // Neither ends up in an export.
    const exported = await call('GET', '/api/export?includeCaches=true');
    const raw = JSON.stringify(exported.body);
    expect(raw).not.toContain(npsso);
    expect(raw).not.toContain('XBL-KEY');

    // Removing the token also drops the refresh token that came from it.
    t.ctx.secrets.set('psn.refresh_token', 'REFRESH');
    await call('DELETE', '/api/sources/psn');
    expect(t.ctx.secrets.get('psn.npsso')).toBeNull();
    expect(t.ctx.secrets.get('psn.refresh_token')).toBeNull();
  });
});
