import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DATA_SCHEMA_VERSION,
  exportFileSchema,
  type ExportFile,
  type GameDetailResponse,
  type ImportPreviewResponse,
  type ImportResultResponse,
  type LibraryListResponse,
} from '@gamebacklog/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../db/seed.ts';
import { SETTINGS, getSetting, setSetting } from '../settings/store.ts';
import { SourceCache } from '../sources/cache.ts';
import { catalogGame, createTestApp, flushBackgroundWork, type TestApp } from '../test/context.ts';
import { runBackupIfDue } from '../transfer/backup.ts';
import { migrateExport } from '../transfer/export.ts';

const apps: TestApp[] = [];
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-transfer-'));
  tempDirs.push(dir);
  return dir;
}

const CATALOG = [
  ['1029', 'The Legend of Zelda: Ocarina of Time', 'Nintendo 64', 1998],
  ['14593', 'Hollow Knight', 'PC', 2017],
  ['81085', 'Dark Souls: Remastered', 'PlayStation 4', 2018],
  ['26226', 'Celeste', 'Nintendo Switch', 2018],
  ['113112', 'Hades', 'PlayStation 5', 2020],
  ['1877', 'Chrono Trigger', 'Super Nintendo', 1995],
  ['7346', 'Breath of the Wild', 'Wii U', 2017],
  ['551', 'God of War III', 'PlayStation 3', 2010],
  ['1942', 'The Witcher 3: Wild Hunt', 'Xbox One', 2015],
] as const;

async function newApp(): Promise<TestApp> {
  const app = await createTestApp(tempDir());
  app.sources.catalog = CATALOG.map(([externalId, title, platform, releaseYear]) =>
    catalogGame({
      externalId,
      title,
      platforms: [platform],
      releaseYear,
      steamAppIds: externalId === '81085' ? ['570940'] : [],
    }),
  );
  apps.push(app);
  return app;
}

async function call<T = unknown>(app: TestApp, method: string, url: string, payload?: unknown) {
  const response = await app.app.inject({
    method: method as 'GET',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json<T>(), raw: response.body };
}

async function addGame(app: TestApp, externalId: string, status = 'backlog') {
  const { body } = await call<{ libraryEntryId: string }>(app, 'POST', '/api/library', {
    status,
    game: { kind: 'igdb', externalId },
  });
  const detail = (await call<GameDetailResponse>(app, 'GET', `/api/library/${body.libraryEntryId}`))
    .body;
  return { entryId: body.libraryEntryId, runId: detail.playthroughs[0]?.id ?? '', detail };
}

const review = (playthroughId: string | null, score: number) => ({
  playthroughId,
  score,
  difficultyScore: 9,
  storyScore: 8,
  gameplayScore: 9,
  levelDesignScore: 9.5,
  soundtrackScore: 8,
  visualsScore: 7.5,
  perceivedLengthScore: 8.5,
  body: 'A primeira metade tem o melhor level design que já joguei.',
  pros: ['Mundo interconectado'],
  cons: ['Segunda metade irregular'],
  hasSpoilers: true,
  timeToBeatMinutes: 3120,
});

const exportOf = async (app: TestApp, includeCaches = false) =>
  (await call<ExportFile>(app, 'GET', `/api/export?includeCaches=${includeCaches}`)).body;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('export → wipe → import round trip', () => {
  it('restores a library of 10 games on different platforms, an NG+ run and a review, identically', async () => {
    const original = await newApp();

    // Ten games: nine from the catalog, one added by hand.
    const statuses = ['playing', 'backlog', 'completed', 'paused', 'wishlist', 'dropped'];
    const added = [];
    for (const [index, [externalId]] of CATALOG.entries()) {
      added.push(await addGame(original, externalId, statuses[index % statuses.length]));
    }
    await call(original, 'POST', '/api/library', {
      status: 'completed_100',
      platform: 'Game Boy Advance',
      game: { kind: 'manual', title: 'Metroid Fusion', releaseYear: 2002 },
    });

    // Dark Souls: a finished first run, an NG+ run, reviews, diary, progress and achievements.
    const darkSouls = added[2];
    if (!darkSouls) throw new Error('missing game');
    const ngPlus = await call<{ id: string }>(
      original,
      'POST',
      `/api/library/${darkSouls.entryId}/playthroughs`,
      { type: 'ng_plus', goal: 'all_achievements' },
    );
    await call(original, 'PATCH', `/api/playthroughs/${ngPlus.body.id}`, {
      status: 'playing',
      startedOn: '2026-09-15',
    });
    await call(
      original,
      'PUT',
      `/api/library/${darkSouls.entryId}/reviews`,
      review(darkSouls.runId, 9),
    );
    await call(original, 'PUT', `/api/library/${darkSouls.entryId}/reviews`, review(null, 9.5));
    await call(original, 'POST', `/api/library/${darkSouls.entryId}/sessions`, {
      playthroughId: ngPlus.body.id,
      startedAt: '2026-09-15T19:00:00.000Z',
      durationMinutes: 120,
      note: 'Toquei o primeiro sino de novo.',
    });
    await call(original, 'POST', `/api/playthroughs/${ngPlus.body.id}/progress`, {
      rawText: 'cheguei em Anor Londo',
    });
    await call(original, 'PATCH', `/api/library/${darkSouls.entryId}`, {
      isFavorite: true,
      tags: ['soulslike', 'favoritos'],
    });
    await call(original, 'PUT', `/api/library/${darkSouls.entryId}/times`, {
      mainMinutes: 1800,
      mainExtraMinutes: 2760,
      completionistMinutes: 4200,
    });
    original.sources.achievementSchemas['570940'] = [
      {
        apiName: 'BELL',
        name: 'Ring the Bell',
        description: 'Defeat the gargoyles.',
        iconUrl: null,
        isHidden: false,
      },
    ];
    original.sources.globalPercentages['570940'] = { BELL: 60 };
    original.sources.playerAchievements['570940'] = [
      { apiName: 'BELL', isUnlocked: true, unlockedAt: new Date('2026-05-10T20:00:00.000Z') },
    ];
    await call(original, 'POST', `/api/library/${darkSouls.entryId}/achievements/sync`);

    // The seed fills the tables no Phase 1 screen writes to yet (chapter maps, collectibles…).
    seedDatabase(original.ctx.db);
    await call(original, 'PUT', '/api/sources', {
      id: 'steam',
      apiKey: 'K',
      steamId: '76561198000000000',
    });
    await call(original, 'POST', '/api/app/setup-completed');
    new SourceCache(original.ctx.db).set('igdb', 'search:zelda', [{ id: 1 }], { ttlMs: 60_000 });
    await flushBackgroundWork();

    const exported = await call<ExportFile>(original, 'GET', '/api/export?includeCaches=true');
    expect(exported.status).toBe(200);
    const file = exportFileSchema.parse(exported.body);
    expect(file.data.libraryEntries).toHaveLength(10 + 27);
    expect(
      new Set(file.data.libraryEntries.map((entry) => entry.platform)).size,
    ).toBeGreaterThanOrEqual(10);
    expect(file.caches?.sourceCache).toHaveLength(1);
    // Every table that holds user data is exercised by this test.
    for (const [table, rows] of Object.entries(file.data)) {
      expect(rows.length, table).toBeGreaterThan(0);
    }

    // "Delete the database": a brand-new, empty install.
    const restored = await newApp();
    expect(
      (await call<LibraryListResponse>(restored, 'GET', '/api/library')).body.items,
    ).toHaveLength(0);

    const imported = await call<ImportResultResponse>(restored, 'POST', '/api/import', {
      mode: 'replace',
      file: exported.body,
    });
    expect(imported.status).toBe(200);
    expect(imported.body.library).toEqual({ added: 37, updated: 0, unchanged: 0, removed: 0 });

    const roundTripped = await exportOf(restored, true);
    expect(roundTripped.data).toEqual(file.data);
    expect(roundTripped.caches).toEqual(file.caches);

    // And the app shows the same thing, not just the same rows.
    const libraryOf = async (app: TestApp) =>
      (await call<LibraryListResponse>(app, 'GET', '/api/library')).body.items.sort((a, b) =>
        a.id.localeCompare(b.id),
      );
    expect(await libraryOf(restored)).toEqual(await libraryOf(original));
    for (const url of [
      `/api/library/${darkSouls.entryId}`,
      `/api/library/${darkSouls.entryId}/reviews`,
      `/api/library/${darkSouls.entryId}/sessions`,
      `/api/playthroughs/${ngPlus.body.id}/progress`,
      `/api/playthroughs/${darkSouls.runId}/achievements`,
      `/api/playthroughs/${ngPlus.body.id}/funnel`,
    ]) {
      expect((await call(restored, 'GET', url)).body, url).toEqual(
        (await call(original, 'GET', url)).body,
      );
    }
    expect((await call(restored, 'GET', '/api/app/state')).body).toMatchObject({
      setupCompleted: true,
    });
  });
});

describe('export', () => {
  it('never contains secrets', async () => {
    const app = await newApp();
    await call(app, 'PUT', '/api/sources', {
      id: 'steam',
      apiKey: 'STEAMSECRETKEY',
      steamId: '76561198000000000',
    });
    await call(app, 'PUT', '/api/sources', {
      id: 'igdb',
      clientId: 'TWITCHCLIENTID',
      clientSecret: 'TWITCHSECRET',
    });
    // Even a secret-looking key written to settings by mistake is left out.
    setSetting(
      app.ctx.db,
      { key: 'steam.api_key', schema: SETTINGS.steamId.schema, fallback: null },
      'LEAKED',
    );

    const { raw, body } = await call<ExportFile>(app, 'GET', '/api/export?includeCaches=true');
    for (const secret of ['STEAMSECRETKEY', 'TWITCHCLIENTID', 'TWITCHSECRET', 'LEAKED']) {
      expect(raw).not.toContain(secret);
    }
    expect(body.data.settings.map((row) => row.key)).toContain('steam.steam_id');
  });

  it('leaves the caches out unless asked', async () => {
    const app = await newApp();
    expect(await exportOf(app)).not.toHaveProperty('caches');
    expect(await exportOf(app, true)).toHaveProperty('caches');
  });

  it('is offered as a dated download', async () => {
    const app = await newApp();
    const response = await app.app.inject({ method: 'GET', url: '/api/export' });
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="gamebacklog-export-2026-11-10.json"',
    );
  });
});

describe('import validation', () => {
  it('rejects files that are not exports, are damaged or come from a newer version', async () => {
    const app = await newApp();
    await addGame(app, '14593');
    const good = await exportOf(app);

    const attempt = (file: unknown) => call(app, 'POST', '/api/import', { mode: 'replace', file });
    expect(await attempt({ hello: 'world' })).toMatchObject({
      status: 400,
      body: { error: 'not_an_export' },
    });
    expect(await attempt({ ...good, schemaVersion: 99 })).toMatchObject({
      status: 400,
      body: { error: 'export_too_new' },
    });
    expect(
      await attempt({ ...good, data: { ...good.data, games: [{ id: 'x', title: 42 }] } }),
    ).toMatchObject({ status: 400, body: { error: 'invalid_export' } });

    // Nothing was touched by the failed attempts.
    expect((await call<LibraryListResponse>(app, 'GET', '/api/library')).body.items).toHaveLength(
      1,
    );
  });

  it('imports a version 1 file, written before checkpoints had a boss', async () => {
    const source = await newApp();
    seedDatabase(source.ctx.db);
    const current = await exportOf(source);
    // What the same data looked like in format version 1.
    const versionOne = {
      ...current,
      schemaVersion: 1,
      data: {
        ...current.data,
        checkpoints: current.data.checkpoints.map(
          ({ bossName: _bossName, leadsTo: _leadsTo, requirement: _requirement, ...row }) => row,
        ),
        playthroughs: current.data.playthroughs.map(
          ({ completedCheckpointIds: _completed, ...row }) => row,
        ),
      },
    };

    const target = await newApp();
    const result = await call<ImportResultResponse>(target, 'POST', '/api/import', {
      mode: 'replace',
      file: versionOne,
    });
    expect(result.status).toBe(200);
    expect(result.body.fileSchemaVersion).toBe(1);
    const restored = await exportOf(target);
    expect(restored.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(restored.data.checkpoints).toHaveLength(4);
    expect(restored.data.checkpoints.every((row) => row.bossName === null)).toBe(true);
    expect(restored.data.checkpoints.every((row) => row.leadsTo.length === 0)).toBe(true);
    expect(restored.data.playthroughs.every((row) => row.completedCheckpointIds.length === 0)).toBe(
      true,
    );
  });

  it('upgrades files from older format versions step by step', () => {
    const migrated = migrateExport(
      { app: 'GameBacklog', schemaVersion: 1, data: { games: [{ name: 'Old' }] } },
      {
        1: (file) => ({ ...file, renamed: true }),
        2: (file) => ({ ...file, twice: true }),
      },
      3,
    );
    expect(migrated).toMatchObject({ schemaVersion: 3, renamed: true, twice: true });

    expect(() => migrateExport({ app: 'GameBacklog', schemaVersion: 1 }, {}, 2)).toThrow(/upgrade/);
    expect(() => migrateExport({ app: 'Other', schemaVersion: 1 })).toThrow(
      /not a GameBacklog export/,
    );
  });
});

describe('import: replace', () => {
  it('previews what will be removed, keeps a safety copy and replaces everything', async () => {
    const source = await newApp();
    await addGame(source, '14593', 'completed');
    const file = await exportOf(source);

    const target = await newApp();
    await addGame(target, '1029', 'playing');
    await addGame(target, '26226', 'backlog');
    setSetting(target.ctx.db, SETTINGS.backupKeep, 3);

    const preview = await call<ImportPreviewResponse>(target, 'POST', '/api/import/preview', {
      mode: 'replace',
      file,
    });
    expect(preview.body.library).toEqual({ added: 1, updated: 0, unchanged: 0, removed: 2 });
    expect(preview.body.addedTitles).toEqual(['Hollow Knight']);
    // A preview writes nothing.
    expect(
      (await call<LibraryListResponse>(target, 'GET', '/api/library')).body.items,
    ).toHaveLength(2);

    const result = await call<ImportResultResponse>(target, 'POST', '/api/import', {
      mode: 'replace',
      file,
    });
    const library = (await call<LibraryListResponse>(target, 'GET', '/api/library')).body.items;
    expect(library.map((item) => item.game.title)).toEqual(['Hollow Knight']);

    // The copy taken before replacing holds what was there.
    expect(result.body.backupFile).toContain(path.join(target.ctx.dataDir, 'backups'));
    const safety = exportFileSchema.parse(
      JSON.parse(readFileSync(result.body.backupFile ?? '', 'utf8')),
    );
    expect(safety.data.games.map((game) => game.title).sort()).toEqual([
      'Celeste',
      'The Legend of Zelda: Ocarina of Time',
    ]);
    // Settings that describe this machine survive a replace.
    expect(getSetting(target.ctx.db, SETTINGS.backupKeep)).toBe(3);
  });
});

describe('import: merge', () => {
  it('adds what is new, joins the same game under one entry and removes nothing', async () => {
    // The same game was added on both machines, so it has different IDs on each.
    const desktop = await newApp();
    const local = await addGame(desktop, '14593', 'backlog');
    const onlyLocal = await addGame(desktop, '1029', 'playing');
    setSetting(desktop.ctx.db, SETTINGS.hltbEnabled, false);

    await sleep(10);
    const laptop = await newApp();
    const remote = await addGame(laptop, '14593', 'completed');
    await call(laptop, 'PUT', `/api/library/${remote.entryId}/reviews`, review(remote.runId, 9.5));
    await call(laptop, 'POST', `/api/library/${remote.entryId}/sessions`, {
      playthroughId: remote.runId,
      startedAt: '2026-11-01T20:00:00.000Z',
      durationMinutes: 60,
    });
    await addGame(laptop, '26226', 'wishlist');
    const file = await exportOf(laptop);
    expect(remote.entryId).not.toBe(local.entryId);

    const preview = await call<ImportPreviewResponse>(desktop, 'POST', '/api/import/preview', {
      mode: 'merge',
      file,
    });
    expect(preview.body.library).toEqual({ added: 1, updated: 1, unchanged: 1, removed: 0 });
    expect(preview.body.addedTitles).toEqual(['Celeste']);
    expect(preview.body.updatedTitles).toEqual(['Hollow Knight']);

    expect((await call(desktop, 'POST', '/api/import', { mode: 'merge', file })).status).toBe(200);

    const library = (await call<LibraryListResponse>(desktop, 'GET', '/api/library')).body.items;
    expect(library.map((item) => item.game.title).sort()).toEqual([
      'Celeste',
      'Hollow Knight',
      'The Legend of Zelda: Ocarina of Time',
    ]);
    // Hollow Knight kept the local entry and run, and gained the laptop's newer status and data.
    const hollow = (await call<GameDetailResponse>(desktop, 'GET', `/api/library/${local.entryId}`))
      .body;
    expect(hollow.entry.status).toBe('completed');
    expect(hollow.playthroughs.map((run) => run.id)).toEqual([local.runId]);
    const reviews = await call<{ items: { playthroughId: string; score: number }[] }>(
      desktop,
      'GET',
      `/api/library/${local.entryId}/reviews`,
    );
    expect(reviews.body.items).toEqual([
      expect.objectContaining({ playthroughId: local.runId, score: 9.5 }),
    ]);
    const sessions = await call<{ items: unknown[] }>(
      desktop,
      'GET',
      `/api/library/${local.entryId}/sessions`,
    );
    expect(sessions.body.items).toHaveLength(1);
    expect((await call(desktop, 'GET', `/api/library/${onlyLocal.entryId}`)).status).toBe(200);
    // Local preferences are untouched.
    expect(getSetting(desktop.ctx.db, SETTINGS.hltbEnabled)).toBe(false);

    // Importing the same file again changes nothing.
    const again = await call<ImportPreviewResponse>(desktop, 'POST', '/api/import/preview', {
      mode: 'merge',
      file,
    });
    expect(again.body.library).toEqual({ added: 0, updated: 0, unchanged: 3, removed: 0 });
    expect(
      Object.values(again.body.tables).every((counts) => counts.added + counts.updated === 0),
    ).toBe(true);
  });

  it('keeps the local version when it is the newer one', async () => {
    const laptop = await newApp();
    const remote = await addGame(laptop, '14593', 'backlog');
    const file = await exportOf(laptop);

    // Restore that export here, then change the game locally afterwards.
    const desktop = await newApp();
    await call(desktop, 'POST', '/api/import', { mode: 'replace', file });
    await sleep(10);
    await call(desktop, 'PATCH', `/api/library/${remote.entryId}`, { status: 'dropped' });

    await call(desktop, 'POST', '/api/import', { mode: 'merge', file });
    const detail = (
      await call<GameDetailResponse>(desktop, 'GET', `/api/library/${remote.entryId}`)
    ).body;
    expect(detail.entry.status).toBe('dropped');
  });

  it('joins games added by hand on both sides by title and year', async () => {
    const manual = {
      status: 'backlog',
      game: { kind: 'manual', title: 'Metroid Fusion', releaseYear: 2002 },
    };
    const laptop = await newApp();
    await call(laptop, 'POST', '/api/library', manual);
    const desktop = await newApp();
    await call(desktop, 'POST', '/api/library', manual);

    await call(desktop, 'POST', '/api/import', { mode: 'merge', file: await exportOf(laptop) });
    expect(
      (await call<LibraryListResponse>(desktop, 'GET', '/api/library')).body.items,
    ).toHaveLength(1);
    expect((await exportOf(desktop)).data.games).toHaveLength(1);
  });
});

describe('automatic backup', () => {
  const save = (app: TestApp, settings: unknown) => call(app, 'PUT', '/api/backup', settings);

  it('validates the folder before accepting the settings', async () => {
    const app = await newApp();
    expect(await save(app, { enabled: true, folder: null, keep: 7 })).toMatchObject({
      status: 400,
      body: { error: 'backup_folder_required' },
    });
    expect(await save(app, { enabled: true, folder: 'relative/folder', keep: 7 })).toMatchObject({
      status: 400,
      body: { error: 'backup_folder_not_absolute' },
    });
    const blocked = path.join(tempDir(), 'a-file');
    writeFileSync(blocked, '');
    expect(
      await save(app, { enabled: true, folder: path.join(blocked, 'inside'), keep: 7 }),
    ).toMatchObject({ status: 400, body: { error: 'backup_folder_unusable' } });
  });

  it('writes importable backups and keeps only the newest N, touching no other file', async () => {
    const app = await newApp();
    await addGame(app, '14593');
    const folder = path.join(tempDir(), 'backups');
    expect((await save(app, { enabled: true, folder, keep: 2 })).body).toMatchObject({
      enabled: true,
      folder,
      keep: 2,
      lastRunAt: null,
    });
    writeFileSync(path.join(folder, 'my-notes.txt'), 'keep me');
    writeFileSync(path.join(folder, 'gamebacklog-backup-manual-copy.json'), '{}');

    const files: string[] = [];
    for (const day of ['10', '11', '12']) {
      app.setNow(`2026-11-${day}T09:00:00.000Z`);
      const run = await call<{ file: string; removed: number }>(app, 'POST', '/api/backup/run');
      files.push(run.body.file);
    }

    expect(existsSync(files[0] ?? '')).toBe(false);
    expect(existsSync(files[1] ?? '')).toBe(true);
    expect(existsSync(files[2] ?? '')).toBe(true);
    expect(readdirSync(folder).sort()).toEqual(
      [
        'gamebacklog-backup-manual-copy.json',
        'my-notes.txt',
        path.basename(files[1] ?? ''),
        path.basename(files[2] ?? ''),
      ].sort(),
    );

    const backup = exportFileSchema.parse(JSON.parse(readFileSync(files[2] ?? '', 'utf8')));
    expect(backup.data.games.map((game) => game.title)).toEqual(['Hollow Knight']);
    expect((await call(app, 'GET', '/api/backup')).body).toMatchObject({
      lastRunAt: '2026-11-12T09:00:00.000Z',
      lastError: null,
    });
  });

  it('runs once a day when enabled', async () => {
    const app = await newApp();
    const folder = path.join(tempDir(), 'daily');
    expect(runBackupIfDue(app.ctx)).toBe(false); // disabled

    await save(app, { enabled: true, folder, keep: 7 });
    expect(runBackupIfDue(app.ctx)).toBe(true);
    expect(runBackupIfDue(app.ctx)).toBe(false); // already ran today

    app.setNow('2026-11-11T11:59:00.000Z');
    expect(runBackupIfDue(app.ctx)).toBe(false);
    app.setNow('2026-11-11T12:00:01.000Z');
    expect(runBackupIfDue(app.ctx)).toBe(true);
    expect(readdirSync(folder)).toHaveLength(2);
  });

  it('records a failure instead of crashing the server', async () => {
    const app = await newApp();
    const blocked = path.join(tempDir(), 'a-file');
    writeFileSync(blocked, '');
    setSetting(app.ctx.db, SETTINGS.backupEnabled, true);
    setSetting(app.ctx.db, SETTINGS.backupFolder, path.join(blocked, 'inside'));

    expect(runBackupIfDue(app.ctx)).toBe(false);
    expect(getSetting(app.ctx.db, SETTINGS.backupLastError)).toBeTruthy();
  });
});
