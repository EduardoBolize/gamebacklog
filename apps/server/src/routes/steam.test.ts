import type {
  AchievementListResponse,
  FunnelResponse,
  GameDetailResponse,
  SourceListResponse,
  SteamImportPreviewResponse,
} from '@gamebacklog/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings } from '../db/schema/index.ts';
import { catalogGame, createTestApp, flushBackgroundWork, type TestApp } from '../test/context.ts';

let t: TestApp;

async function call<T = unknown>(method: string, url: string, payload?: unknown) {
  const response = await t.app.inject({
    method: method as 'GET',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json<T>(), raw: response.body };
}

const DARK_SOULS = '570940';

beforeEach(async () => {
  t = await createTestApp();
  t.sources.catalog = [
    catalogGame({
      externalId: '81085',
      title: 'Dark Souls: Remastered',
      releaseYear: 2018,
      platforms: ['PC', 'PlayStation 4'],
      steamAppIds: [DARK_SOULS],
    }),
    catalogGame({ externalId: '14593', title: 'Hollow Knight', steamAppIds: ['367520'] }),
  ];
  t.sources.ownedGames = [
    { appId: '367520', name: 'Hollow Knight', playtimeMinutes: 2040, playtimeTwoWeeksMinutes: 0 },
    {
      appId: DARK_SOULS,
      name: 'DARK SOULS™: REMASTERED',
      playtimeMinutes: 3660,
      playtimeTwoWeeksMinutes: 120,
    },
    { appId: '999', name: 'Obscure Tool™', playtimeMinutes: 0, playtimeTwoWeeksMinutes: 0 },
  ];
  t.sources.achievementSchemas[DARK_SOULS] = [
    {
      apiName: 'BELL_1',
      name: 'Ring the Bell (Undead Church)',
      description: 'Defeat the Bell Gargoyles.',
      iconUrl: 'https://example.test/a1.jpg',
      isHidden: false,
    },
    {
      apiName: 'ENDING',
      name: 'To Link the Fire',
      description: 'Reach the ending.',
      iconUrl: null,
      isHidden: true,
    },
    {
      apiName: 'WEAPONS',
      name: "Knight's Honor",
      description: 'Acquire all rare weapons.',
      iconUrl: null,
      isHidden: false,
    },
  ];
  t.sources.globalPercentages[DARK_SOULS] = { BELL_1: 60, ENDING: 24, WEAPONS: 5 };
  t.sources.playerAchievements[DARK_SOULS] = [
    { apiName: 'BELL_1', isUnlocked: true, unlockedAt: new Date('2026-05-10T20:00:00.000Z') },
    { apiName: 'ENDING', isUnlocked: false, unlockedAt: null },
    { apiName: 'WEAPONS', isUnlocked: false, unlockedAt: null },
  ];
});

afterEach(() => t.close());

async function addDarkSouls() {
  const { body } = await call<{ libraryEntryId: string }>('POST', '/api/library', {
    status: 'playing',
    platform: 'PC',
    game: { kind: 'igdb', externalId: '81085' },
  });
  const detail = (await call<GameDetailResponse>('GET', `/api/library/${body.libraryEntryId}`))
    .body;
  return { entryId: body.libraryEntryId, runId: detail.playthroughs[0]?.id ?? '' };
}

describe('source configuration', () => {
  it('stores credentials without ever returning them', async () => {
    const saved = await call<SourceListResponse>('PUT', '/api/sources', {
      id: 'steam',
      apiKey: 'SUPERSECRETKEY',
      steamId: '76561198000000000',
    });
    expect(saved.status).toBe(200);
    expect(saved.raw).not.toContain('SUPERSECRETKEY');
    expect(saved.body.items.find((item) => item.id === 'steam')).toEqual({
      id: 'steam',
      configured: true,
      enabled: true,
      detail: '7656…0000',
    });

    await call('PUT', '/api/sources', {
      id: 'igdb',
      clientId: 'abc',
      clientSecret: 'TWITCHSECRET',
    });
    const list = await call<SourceListResponse>('GET', '/api/sources');
    expect(list.raw).not.toContain('TWITCHSECRET');
    expect(list.body.items.find((item) => item.id === 'igdb')?.configured).toBe(true);

    // Secrets live in the secret store, never in the settings table that gets exported.
    const stored = JSON.stringify(t.ctx.db.select().from(settings).all());
    expect(stored).not.toContain('SUPERSECRETKEY');
    expect(stored).not.toContain('TWITCHSECRET');
    expect(t.ctx.secrets.get('steam.api_key')).toBe('SUPERSECRETKEY');
  });

  it('removes credentials', async () => {
    await call('PUT', '/api/sources', {
      id: 'steam',
      apiKey: 'KEY',
      steamId: '76561198000000000',
    });
    const { body } = await call<SourceListResponse>('DELETE', '/api/sources/steam');
    expect(body.items.find((item) => item.id === 'steam')).toMatchObject({
      configured: false,
      detail: null,
    });
    expect(t.ctx.secrets.get('steam.api_key')).toBeNull();
  });

  it('validates the SteamID format', async () => {
    const { status } = await call('PUT', '/api/sources', {
      id: 'steam',
      apiKey: 'k',
      steamId: 'me',
    });
    expect(status).toBe(400);
  });

  it('turns HowLongToBeat off and on', async () => {
    const off = await call<SourceListResponse>('PUT', '/api/sources', {
      id: 'hltb',
      enabled: false,
    });
    expect(off.body.items.find((item) => item.id === 'hltb')?.enabled).toBe(false);
  });

  it('tests a connection', async () => {
    expect((await call('POST', '/api/sources/igdb/test')).body).toEqual({ ok: true, code: 'ok' });
    t.sources.catalogConfigured = false;
    expect((await call('POST', '/api/sources/igdb/test')).body).toEqual({
      ok: false,
      code: 'not_configured',
    });
    expect((await call('POST', '/api/sources/rawg/test')).body).toEqual({
      ok: false,
      code: 'not_configured',
    });
  });

  it('tracks whether the first-run setup was completed', async () => {
    expect((await call('GET', '/api/app/state')).body).toMatchObject({ setupCompleted: false });
    await call('POST', '/api/app/setup-completed');
    expect((await call('GET', '/api/app/state')).body).toMatchObject({ setupCompleted: true });
  });
});

describe('Steam achievements', () => {
  it('syncs the catalog with global percentages and the player unlocks', async () => {
    const { entryId, runId } = await addDarkSouls();
    const sync = await call('POST', `/api/library/${entryId}/achievements/sync`);
    expect(sync.body).toEqual({ total: 3, unlocked: 1, playerDataAvailable: true });

    const { body } = await call<AchievementListResponse>(
      'GET',
      `/api/playthroughs/${runId}/achievements`,
    );
    expect(body.steamAppId).toBe(DARK_SOULS);
    expect(body.syncedAt).toBe('2026-11-01T00:00:00.000Z');
    // Most common first.
    expect(body.items.map((item) => [item.name, item.globalPercent, item.isUnlocked])).toEqual([
      ['Ring the Bell (Undead Church)', 60, true],
      ['To Link the Fire', 24, false],
      ["Knight's Honor", 5, false],
    ]);
    expect(body.items[0]).toMatchObject({
      origin: 'steam',
      isStory: true,
      classifiedBy: 'heuristic',
      unlockedAt: '2026-05-10T20:00:00.000Z',
    });
    expect(body.items[1]).toMatchObject({ isHidden: true, isStory: true });
    expect(body.items[2]).toMatchObject({ isStory: false });
  });

  it('keeps the user classification when syncing again', async () => {
    const { entryId, runId } = await addDarkSouls();
    await call('POST', `/api/library/${entryId}/achievements/sync`);
    const list = () =>
      call<AchievementListResponse>('GET', `/api/playthroughs/${runId}/achievements`);
    const weapons = (await list()).body.items.find((item) => item.name === "Knight's Honor");

    await call('PATCH', `/api/achievements/${weapons?.id}`, { isMissable: true, isNgPlus: true });
    const bell = (await list()).body.items[0];
    await call('PATCH', `/api/achievements/${bell?.id}`, { isStory: false });

    await call('POST', `/api/library/${entryId}/achievements/sync`);
    const after = (await list()).body.items;
    expect(after.find((item) => item.id === weapons?.id)).toMatchObject({
      isMissable: true,
      isNgPlus: true,
      classifiedBy: 'user',
    });
    expect(after.find((item) => item.id === bell?.id)).toMatchObject({
      isStory: false,
      classifiedBy: 'user',
    });
    expect(after).toHaveLength(3);
  });

  it('credits each Steam unlock to the run that was in progress at the time', async () => {
    const { entryId, runId } = await addDarkSouls();
    await call('PATCH', `/api/playthroughs/${runId}`, { startedOn: '2026-05-01' });
    const ngPlus = await call<{ id: string }>('POST', `/api/library/${entryId}/playthroughs`, {
      type: 'ng_plus',
      goal: 'all_achievements',
    });
    await call('PATCH', `/api/playthroughs/${ngPlus.body.id}`, { startedOn: '2026-09-15' });
    t.sources.playerAchievements[DARK_SOULS] = [
      { apiName: 'BELL_1', isUnlocked: true, unlockedAt: new Date('2026-05-10T20:00:00.000Z') },
      { apiName: 'WEAPONS', isUnlocked: true, unlockedAt: new Date('2026-10-02T20:00:00.000Z') },
    ];

    await call('POST', `/api/library/${entryId}/achievements/sync`);
    const unlockedIn = async (id: string) =>
      (
        await call<AchievementListResponse>('GET', `/api/playthroughs/${id}/achievements`)
      ).body.items
        .filter((item) => item.isUnlocked)
        .map((item) => item.name);

    expect(await unlockedIn(runId)).toEqual(['Ring the Bell (Undead Church)']);
    expect(await unlockedIn(ngPlus.body.id)).toEqual(["Knight's Honor"]);
  });

  it('still loads the catalog when the profile is private', async () => {
    t.sources.playerAchievements[DARK_SOULS] = null;
    const { entryId, runId } = await addDarkSouls();
    const sync = await call('POST', `/api/library/${entryId}/achievements/sync`);
    expect(sync.body).toEqual({ total: 3, unlocked: 0, playerDataAvailable: false });

    const { body } = await call<AchievementListResponse>(
      'GET',
      `/api/playthroughs/${runId}/achievements`,
    );
    expect(body.items).toHaveLength(3);
  });

  it('lets the user tick an achievement by hand', async () => {
    const { entryId, runId } = await addDarkSouls();
    await call('POST', `/api/library/${entryId}/achievements/sync`);
    const list = () =>
      call<AchievementListResponse>('GET', `/api/playthroughs/${runId}/achievements`);
    const ending = (await list()).body.items.find((item) => item.name === 'To Link the Fire');

    await call('PUT', `/api/playthroughs/${runId}/achievements/${ending?.id}`, {
      isUnlocked: true,
    });
    expect((await list()).body.items.find((item) => item.id === ending?.id)).toMatchObject({
      isUnlocked: true,
      unlockedAt: '2026-11-10T12:00:00.000Z',
    });

    await call('PUT', `/api/playthroughs/${runId}/achievements/${ending?.id}`, {
      isUnlocked: false,
    });
    expect((await list()).body.items.find((item) => item.id === ending?.id)).toMatchObject({
      isUnlocked: false,
      unlockedAt: null,
    });
  });

  it('answers 409 for a game without a Steam app', async () => {
    const { body } = await call<{ libraryEntryId: string }>('POST', '/api/library', {
      status: 'playing',
      game: { kind: 'manual', title: 'Console Exclusive' },
    });
    const sync = await call('POST', `/api/library/${body.libraryEntryId}/achievements/sync`);
    expect(sync).toMatchObject({ status: 409, body: { error: 'no_steam_app' } });
  });
});

describe('abandonment funnel', () => {
  it('estimates how many players who got this far finished, and the time left', async () => {
    t.sources.times['Dark Souls: Remastered'] = {
      externalId: '1',
      title: 'Dark Souls: Remastered',
      mainMinutes: 1800,
      mainExtraMinutes: 2760,
      completionistMinutes: 4200,
      url: 'https://howlongtobeat.com/game/1',
    };
    const { entryId, runId } = await addDarkSouls();
    await flushBackgroundWork();
    await call('PATCH', `/api/playthroughs/${runId}`, { playtimeMinutes: 540 });
    await call('POST', `/api/library/${entryId}/achievements/sync`);

    const { body } = await call<FunnelResponse>('GET', `/api/playthroughs/${runId}/funnel`);
    expect(body).toMatchObject({
      available: true,
      percentFinished: 40, // 24 / 60
      remainingMinutes: 1260,
      remainingBasis: 'main',
    });
    expect(body.milestones.map((milestone) => milestone.name)).toEqual([
      'Ring the Bell (Undead Church)',
      'To Link the Fire',
    ]);
  });

  it('follows the user corrections to what counts as story', async () => {
    const { entryId, runId } = await addDarkSouls();
    await call('POST', `/api/library/${entryId}/achievements/sync`);
    const items = (
      await call<AchievementListResponse>('GET', `/api/playthroughs/${runId}/achievements`)
    ).body.items;
    for (const item of items) {
      await call('PATCH', `/api/achievements/${item.id}`, { isStory: false });
    }
    const { body } = await call<FunnelResponse>('GET', `/api/playthroughs/${runId}/funnel`);
    expect(body).toMatchObject({ available: false, reason: 'no_story_achievements' });
  });

  it('is unavailable, with a reason, for games without achievements', async () => {
    const { body: added } = await call<{ libraryEntryId: string }>('POST', '/api/library', {
      status: 'playing',
      game: { kind: 'manual', title: 'Console Exclusive' },
    });
    const detail = (await call<GameDetailResponse>('GET', `/api/library/${added.libraryEntryId}`))
      .body;
    const { body } = await call<FunnelResponse>(
      'GET',
      `/api/playthroughs/${detail.playthroughs[0]?.id}/funnel`,
    );
    expect(body).toMatchObject({ available: false, reason: 'no_achievements' });
  });
});

describe('Steam library import', () => {
  it('previews the library with catalog matches and suggested statuses, writing nothing', async () => {
    const { body } = await call<SteamImportPreviewResponse>('POST', '/api/steam/import/preview');
    expect(body.catalogAvailable).toBe(true);
    // Most played first.
    expect(body.items.map((item) => item.appId)).toEqual([DARK_SOULS, '367520', '999']);
    expect(body.items[0]).toMatchObject({
      name: 'DARK SOULS™: REMASTERED',
      playtimeMinutes: 3660,
      playedRecently: true,
      suggestedStatus: 'playing',
      match: { externalId: '81085', title: 'Dark Souls: Remastered', releaseYear: 2018 },
      libraryEntryId: null,
    });
    expect(body.items[1]).toMatchObject({ suggestedStatus: 'backlog', playedRecently: false });
    expect(body.items[2]).toMatchObject({ match: null });
    expect((await call<{ items: unknown[] }>('GET', '/api/library')).body.items).toHaveLength(0);
  });

  it('imports the chosen games with their hours', async () => {
    const result = await call('POST', '/api/steam/import', {
      items: [
        { appId: DARK_SOULS, status: 'playing' },
        { appId: '999', status: 'backlog' },
        { appId: '424242', status: 'backlog' },
      ],
    });
    expect(result.body).toEqual({ imported: 2, updated: 0, skipped: 1 });

    const library = (
      await call<{
        items: { id: string; status: string; platform: string; game: { title: string } }[];
      }>('GET', '/api/library')
    ).body.items;
    expect(library.map((item) => item.game.title).sort()).toEqual([
      'Dark Souls: Remastered',
      'Obscure Tool',
    ]);
    const darkSouls = library.find((item) => item.game.title === 'Dark Souls: Remastered');
    expect(darkSouls).toMatchObject({ status: 'playing', platform: 'PC' });

    const detail = (await call<GameDetailResponse>('GET', `/api/library/${darkSouls?.id}`)).body;
    expect(detail.playthroughs[0]).toMatchObject({ playtimeMinutes: 3660, status: 'playing' });
    expect(detail.externalIds.map((link) => link.source).sort()).toEqual(['igdb', 'steam']);
    expect(detail.game.origin).toBe('igdb');
  });

  it('does not duplicate a game that is already in the library', async () => {
    const { entryId } = await addDarkSouls();
    const preview = await call<SteamImportPreviewResponse>('POST', '/api/steam/import/preview');
    expect(preview.body.items[0]?.libraryEntryId).toBe(entryId);

    const result = await call('POST', '/api/steam/import', {
      items: [{ appId: DARK_SOULS, status: 'backlog' }],
    });
    expect(result.body).toEqual({ imported: 0, updated: 1, skipped: 0 });

    const detail = (await call<GameDetailResponse>('GET', `/api/library/${entryId}`)).body;
    expect(detail.entry.status).toBe('playing');
    expect(detail.playthroughs[0]?.playtimeMinutes).toBe(3660);
    expect((await call<{ items: unknown[] }>('GET', '/api/library')).body.items).toHaveLength(1);
  });

  it('imports with Steam names when the catalog is not configured', async () => {
    t.sources.catalogConfigured = false;
    const preview = await call<SteamImportPreviewResponse>('POST', '/api/steam/import/preview');
    expect(preview.body.catalogAvailable).toBe(false);
    expect(preview.body.items.every((item) => item.match === null)).toBe(true);

    await call('POST', '/api/steam/import', { items: [{ appId: DARK_SOULS, status: 'backlog' }] });
    const library = (await call<{ items: { game: { title: string } }[] }>('GET', '/api/library'))
      .body;
    expect(library.items[0]?.game.title).toBe('DARK SOULS: REMASTERED');
  });

  it('explains a private profile and a missing configuration', async () => {
    t.sources.steamProfilePrivate = true;
    expect(await call('POST', '/api/steam/import/preview')).toMatchObject({
      status: 409,
      body: { error: 'source_profile_private' },
    });

    t.sources.steamProfilePrivate = false;
    t.sources.steamConfigured = false;
    expect(await call('POST', '/api/steam/import/preview')).toMatchObject({
      status: 409,
      body: { error: 'source_not_configured' },
    });
  });
});

describe('Steam playtime sync', () => {
  const setPlaytime = (minutes: number) => {
    t.sources.ownedGames = t.sources.ownedGames.map((game) =>
      game.appId === DARK_SOULS ? { ...game, playtimeMinutes: minutes } : game,
    );
  };
  const sessionsOf = async (entryId: string) =>
    (
      await call<{ items: { durationMinutes: number; origin: string; playthroughId: string }[] }>(
        'GET',
        `/api/library/${entryId}/sessions`,
      )
    ).body.items;

  it('turns the growth in Steam hours into an automatic session', async () => {
    await call('POST', '/api/steam/import', { items: [{ appId: DARK_SOULS, status: 'playing' }] });
    const entryId = (await call<{ items: { id: string }[] }>('GET', '/api/library')).body.items[0]
      ?.id as string;

    // Nothing changed since the import: no session.
    expect((await call('POST', '/api/steam/sync')).body).toMatchObject({ sessionsCreated: 0 });
    expect(await sessionsOf(entryId)).toHaveLength(0);

    setPlaytime(3660 + 95);
    t.setNow('2026-11-12T22:00:00.000Z');
    expect((await call('POST', '/api/steam/sync')).body).toEqual({
      sessionsCreated: 1,
      syncedAt: '2026-11-12T22:00:00.000Z',
    });

    const detail = (await call<GameDetailResponse>('GET', `/api/library/${entryId}`)).body;
    expect(await sessionsOf(entryId)).toEqual([
      expect.objectContaining({
        durationMinutes: 95,
        origin: 'steam',
        playthroughId: detail.playthroughs[0]?.id,
      }),
    ]);
    expect(detail.playthroughs[0]?.playtimeMinutes).toBe(3755);

    // Syncing again without playing creates nothing new.
    expect((await call('POST', '/api/steam/sync')).body).toMatchObject({ sessionsCreated: 0 });
    expect((await call('GET', '/api/app/state')).body).toMatchObject({
      steamLastSyncAt: '2026-11-12T22:00:00.000Z',
    });
  });

  it('takes the first sync of a game as the baseline instead of logging all its hours', async () => {
    const { entryId } = await addDarkSouls();
    expect((await call('POST', '/api/steam/sync')).body).toMatchObject({ sessionsCreated: 0 });
    expect(await sessionsOf(entryId)).toHaveLength(0);

    setPlaytime(3660 + 30);
    expect((await call('POST', '/api/steam/sync')).body).toMatchObject({ sessionsCreated: 1 });
  });

  it('logs the session against the run in progress', async () => {
    const { entryId, runId } = await addDarkSouls();
    await call('PATCH', `/api/playthroughs/${runId}`, { status: 'completed' });
    const ngPlus = await call<{ id: string }>('POST', `/api/library/${entryId}/playthroughs`, {
      type: 'ng_plus',
      goal: 'finish',
    });
    await call('PATCH', `/api/playthroughs/${ngPlus.body.id}`, { status: 'playing' });

    await call('POST', '/api/steam/sync');
    setPlaytime(3660 + 60);
    await call('POST', '/api/steam/sync');
    expect((await sessionsOf(entryId))[0]?.playthroughId).toBe(ngPlus.body.id);
  });
});
