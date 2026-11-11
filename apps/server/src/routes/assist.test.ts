import type {
  AiUsageResponse,
  AreaChecklistResponse,
  ChapterMapResponse,
  FunnelEstimateResponse,
  GameAssistResponse,
  GameDetailResponse,
  HintResponse,
  ProgressListResponse,
  ReportProgressResponse,
  RevealedHintsResponse,
} from '@gamebacklog/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchCheckpointLocally } from '../assist/progress.ts';
import { renderSources, wikiCandidates } from '../assist/wiki.ts';
import { achievements, checkpoints, collectibles } from '../db/schema/index.ts';
import { catalogGame, createTestApp, type TestApp } from '../test/context.ts';

let t: TestApp;

async function call<T = unknown>(method: string, url: string, payload?: unknown) {
  const response = await t.app.inject({
    method: method as 'GET',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json<T>(), raw: response.body };
}

const MAP_ANSWER = {
  checkpoints: [
    { name: 'Kokiri Forest', aliases: [], isPointOfNoReturn: false, bossName: null },
    {
      name: 'Inside the Deku Tree',
      aliases: ['Deku Tree', 'Great Deku Tree'],
      isPointOfNoReturn: false,
      bossName: 'Queen Gohma',
    },
    { name: "Dodongo's Cavern", aliases: [], isPointOfNoReturn: false, bossName: 'King Dodongo' },
  ],
};

async function addOcarina() {
  const added = await call<{ libraryEntryId: string }>('POST', '/api/library', {
    status: 'playing',
    game: { kind: 'igdb', externalId: '1029' },
  });
  const entryId = added.body.libraryEntryId;
  const detail = (await call<GameDetailResponse>('GET', `/api/library/${entryId}`)).body;
  const runId = detail.playthroughs[0]?.id ?? '';
  return { entryId, runId, gameId: detail.game.id };
}

const mapOf = async (runId: string) =>
  (await call<ChapterMapResponse>('GET', `/api/playthroughs/${runId}/map`)).body;

beforeEach(async () => {
  t = await createTestApp();
  t.sources.catalog = [
    catalogGame({
      externalId: '1029',
      title: 'The Legend of Zelda: Ocarina of Time',
      franchise: 'The Legend of Zelda',
      releaseYear: 1998,
      platforms: ['Nintendo 64'],
      genres: ['Adventure'],
    }),
  ];
  t.sources.wikiHosts = ['zelda.fandom.com', 'en.wikipedia.org'];
  t.sources.wikiPages = {
    'Ocarina of Time Walkthrough': [
      { heading: '', text: 'Walkthrough of The Legend of Zelda: Ocarina of Time.' },
      { heading: 'Dungeons', text: "- Inside the Deku Tree\n- Dodongo's Cavern" },
    ],
    'Inside the Deku Tree': [
      { heading: '', text: 'The first dungeon. Its boss is Queen Gohma.' },
      {
        heading: 'Web on the floor',
        text: 'Climb to the top floor and jump down to break the web.',
      },
      { heading: 'Gold Skulltulas', text: '- On the vines in the main room.\n- In the basement.' },
    ],
    'Queen Gohma': [
      { heading: 'Strategy', text: 'Stun her eye with the slingshot when it turns red.' },
    ],
  };
});

afterEach(() => t.close());

describe('acceptance flow: Ocarina of Time, 100% goal, hints', () => {
  it('builds the map, places the player, lists the area and climbs the hint ladder — then repeats it for zero tokens', async () => {
    t.ai.connected = true;
    const { entryId, runId } = await addOcarina();
    await call('PATCH', `/api/playthroughs/${runId}`, { goal: 'full_100' });

    // --- "I just entered the Deku Tree", typed in Portuguese ---
    t.ai.answers = [MAP_ANSWER, { checkpoint: 2, alias: 'Árvore Deku' }];
    const progress = await call<ReportProgressResponse>(
      'POST',
      `/api/playthroughs/${runId}/progress`,
      {
        rawText: 'acabei de entrar na Árvore Deku',
      },
    );
    expect(progress.status).toBe(201);
    expect(progress.body).toMatchObject({
      saved: true,
      resolvedBy: 'ai',
      checkpoint: { name: 'Inside the Deku Tree', bossName: 'Queen Gohma' },
      warning: null,
    });

    // The map was built from the wiki on that first report, and it cites the wiki.
    const map = await mapOf(runId);
    expect(map.map?.checkpoints.map((checkpoint) => checkpoint.name)).toEqual([
      'Kokiri Forest',
      'Inside the Deku Tree',
      "Dodongo's Cavern",
    ]);
    expect(map.map).toMatchObject({ origin: 'ai', isUserEdited: false });
    expect(map.map?.sources[0]).toMatchObject({ origin: 'wiki' });
    expect(map.wikiUrl).toBe('https://zelda.fandom.com/wiki/');
    expect(map.currentCheckpointId).toBe(map.map?.checkpoints[1]?.id);
    expect(t.ai.requests[0]?.prompt).toContain('Inside the Deku Tree');
    expect(t.ai.requests).toHaveLength(2);

    // The alias the AI reported makes the next mention a local match: no AI call.
    t.setNow('2026-11-10T12:05:00.000Z');
    const again = await call<ReportProgressResponse>(
      'POST',
      `/api/playthroughs/${runId}/progress`,
      {
        rawText: 'ainda na árvore deku, procurando o chefe',
      },
    );
    expect(again.body).toMatchObject({
      resolvedBy: 'local_match',
      checkpoint: { name: 'Inside the Deku Tree' },
    });
    expect(t.ai.requests).toHaveLength(2);

    const history = await call<ProgressListResponse>('GET', `/api/playthroughs/${runId}/progress`);
    expect(history.body.items[0]).toMatchObject({
      rawText: 'ainda na árvore deku, procurando o chefe',
      checkpointName: 'Inside the Deku Tree',
    });

    // --- 100% mode: collectibles and missables of the area ---
    const before = await call<AreaChecklistResponse>('GET', `/api/playthroughs/${runId}/checklist`);
    expect(before.body).toMatchObject({ generated: false, collectibles: [] });

    t.ai.answers = [
      {
        collectibles: [
          {
            name: 'Gold Skulltula (vines)',
            description: 'On the vines in the main room.',
            category: 'Gold Skulltula',
            isMissable: false,
          },
          {
            name: 'Gold Skulltula (basement)',
            description: 'In the basement.',
            category: 'Gold Skulltula',
            isMissable: true,
          },
        ],
        missableAchievements: [],
      },
    ];
    const checklist = await call<AreaChecklistResponse>(
      'POST',
      `/api/playthroughs/${runId}/checklist/generate`,
    );
    expect(checklist.body).toMatchObject({
      generated: true,
      cached: false,
      checkpoint: { name: 'Inside the Deku Tree' },
    });
    expect(
      checklist.body.collectibles.map((item) => [item.name, item.isMissable, item.isCollected]),
    ).toEqual([
      ['Gold Skulltula (vines)', false, false],
      ['Gold Skulltula (basement)', true, false],
    ]);
    expect(checklist.body.sources[0]?.url).toContain('zelda.fandom.com/wiki/');
    expect(t.ai.requests.at(-1)?.prompt).toContain('On the vines in the main room.');

    // The answer is asked for in the language of the interface, names left as the game has them.
    expect(t.ai.requests.at(-1)?.system).toContain(
      'Write each "description" and "category" in Brazilian Portuguese',
    );
    expect(t.ai.requests.at(-1)?.system).toContain('do not translate them');

    const firstItem = checklist.body.collectibles[0]?.id;
    await call('PUT', `/api/playthroughs/${runId}/collectibles/${firstItem}`, {
      isCollected: true,
    });

    // In another language the list counts as not generated yet; asking again rewrites the
    // descriptions the AI wrote, keeps the items and what was ticked, and adds nothing twice.
    const english = await call<AreaChecklistResponse>(
      'GET',
      `/api/playthroughs/${runId}/checklist?locale=en`,
    );
    expect(english.body.generated).toBe(false);
    expect(english.body.collectibles).toHaveLength(2);
    t.ai.answers = [
      {
        collectibles: [
          {
            name: 'Gold Skulltula (vines)',
            description: 'Climb the vines in the main room.',
            category: 'Gold Skulltula',
            isMissable: false,
          },
        ],
        missableAchievements: [],
      },
    ];
    const rewritten = await call<AreaChecklistResponse>(
      'POST',
      `/api/playthroughs/${runId}/checklist/generate?locale=en`,
    );
    expect(t.ai.requests.at(-1)?.system).toContain('in English');
    expect(rewritten.body.generated).toBe(true);
    expect(
      rewritten.body.collectibles.map((item) => [item.id, item.description, item.isCollected]),
    ).toEqual([
      [firstItem, 'Climb the vines in the main room.', true],
      [checklist.body.collectibles[1]?.id, 'In the basement.', false],
    ]);
    const ticked = await call<AreaChecklistResponse>('GET', `/api/playthroughs/${runId}/checklist`);
    expect(ticked.body.collectibles.map((item) => item.isCollected)).toEqual([true, false]);

    // --- Hint level 1, then level 2 ---
    t.ai.answers = [
      { hint: 'Repare no que existe acima de você nesta sala.', sources: [1] },
      { hint: 'Suba até o último andar e olhe para baixo.', sources: [1] },
    ];
    const ask = (level: number) =>
      call<HintResponse>('POST', `/api/playthroughs/${runId}/hints`, {
        kind: 'general',
        level,
        stuckOn: 'teia no chão',
      });
    const level1 = await ask(1);
    expect(level1.body).toMatchObject({
      level: 1,
      text: 'Repare no que existe acima de você nesta sala.',
      cached: false,
    });
    expect(level1.body.sources[0]).toMatchObject({
      origin: 'wiki',
      url: 'https://zelda.fandom.com/wiki/Inside_the_Deku_Tree',
    });
    const hintRequest = t.ai.requests.at(-1);
    expect(hintRequest?.system).toContain('Level 1, a nudge');
    expect(hintRequest?.system).toContain('Brazilian Portuguese');
    expect(hintRequest?.prompt).toContain('Where the player is: Inside the Deku Tree');
    expect(hintRequest?.prompt).toContain('jump down to break the web');

    const level2 = await ask(2);
    expect(level2.body).toMatchObject({ level: 2, cached: false });
    expect(t.ai.requests.at(-1)?.system).toContain('Level 2, a direction');

    // --- The same session again: everything from the cache, zero tokens ---
    const requestsSoFar = t.ai.requests.length;
    const wikiCallsSoFar = t.sources.wikiCalls.length;
    t.ai.answers = [];

    expect((await call('POST', `/api/library/${entryId}/map/generate`)).status).toBe(200);
    expect(
      (await call<AreaChecklistResponse>('POST', `/api/playthroughs/${runId}/checklist/generate`))
        .body.cached,
    ).toBe(true);
    const cached1 = await ask(1);
    const cached2 = await ask(2);
    expect(cached1.body).toMatchObject({ cached: true, text: level1.body.text });
    expect(cached1.body.sources).toEqual(level1.body.sources);
    expect(cached2.body).toMatchObject({ cached: true, text: level2.body.text });

    expect(t.ai.requests).toHaveLength(requestsSoFar);
    expect(t.sources.wikiCalls).toHaveLength(wikiCallsSoFar);

    // The usage log shows it: the repeats are cache hits that cost nothing.
    const usage = (await call<AiUsageResponse>('GET', '/api/ai/usage')).body;
    const repeats = usage.items.slice(0, 3);
    expect(repeats.map((item) => item.feature).sort()).toEqual(['area_checklist', 'hint', 'hint']);
    for (const item of repeats) {
      expect(item).toMatchObject({
        cacheHit: true,
        inputTokensEstimated: 0,
        outputTokensEstimated: 0,
      });
    }
    expect(usage.totals.cacheHits).toBe(3);
    expect(
      usage.items.every((item) => item.gameTitle === 'The Legend of Zelda: Ocarina of Time'),
    ).toBe(true);

    const revealed = await call<RevealedHintsResponse>('GET', `/api/playthroughs/${runId}/hints`);
    expect(revealed.body.items.map((item) => item.level)).toEqual([1, 2]);
  });
});

describe('without an AI', () => {
  it('still records progress and explains what needs an AI', async () => {
    const { runId } = await addOcarina();
    const progress = await call<ReportProgressResponse>(
      'POST',
      `/api/playthroughs/${runId}/progress`,
      {
        rawText: 'acabei de entrar na Árvore Deku',
      },
    );
    expect(progress.body).toMatchObject({ saved: true, checkpoint: null, resolvedBy: null });
    expect(await mapOf(runId)).toMatchObject({ map: null, aiConnected: false });

    expect(
      await call('POST', `/api/playthroughs/${runId}/hints`, { kind: 'general', level: 1 }),
    ).toMatchObject({ status: 409, body: { error: 'ai_not_connected' } });
    expect((await call('GET', `/api/playthroughs/${runId}/checklist`)).body).toMatchObject({
      error: 'no_chapter_map',
    });
    expect(t.ai.requests).toHaveLength(0);
  });

  it('lets the user write the map by hand and matches text to it locally', async () => {
    const { entryId, runId } = await addOcarina();
    await call('PUT', `/api/library/${entryId}/map`, {
      checkpoints: [
        {
          name: 'Kokiri Forest',
          aliases: ['Floresta Kokiri'],
          isPointOfNoReturn: false,
          bossName: null,
        },
        {
          name: 'Inside the Deku Tree',
          aliases: ['Árvore Deku'],
          isPointOfNoReturn: false,
          bossName: 'Queen Gohma',
        },
      ],
    });
    const map = await mapOf(runId);
    expect(map.map).toMatchObject({ origin: 'manual', isUserEdited: true });

    const progress = await call<ReportProgressResponse>(
      'POST',
      `/api/playthroughs/${runId}/progress`,
      {
        rawText: 'Entrei na ARVORE DEKU agora',
      },
    );
    expect(progress.body).toMatchObject({
      resolvedBy: 'local_match',
      checkpoint: { name: 'Inside the Deku Tree' },
    });

    // Editing keeps the IDs of what stayed, so the player's position survives a reorder.
    const [first, second] = map.map?.checkpoints ?? [];
    await call('PUT', `/api/library/${entryId}/map`, {
      checkpoints: [
        {
          id: second?.id,
          name: 'Great Deku Tree',
          aliases: [],
          isPointOfNoReturn: true,
          bossName: null,
        },
        {
          id: first?.id,
          name: 'Kokiri Forest',
          aliases: [],
          isPointOfNoReturn: false,
          bossName: null,
        },
        { name: 'Hyrule Field', aliases: [], isPointOfNoReturn: false, bossName: null },
      ],
    });
    const edited = await mapOf(runId);
    expect(
      edited.map?.checkpoints.map((checkpoint) => [
        checkpoint.id,
        checkpoint.name,
        checkpoint.position,
      ]),
    ).toEqual([
      [second?.id, 'Great Deku Tree', 1],
      [first?.id, 'Kokiri Forest', 2],
      [expect.any(String), 'Hyrule Field', 3],
    ]);
    expect(edited.currentCheckpointId).toBe(second?.id);
  });
});

describe('point of no return', () => {
  async function setup() {
    const { entryId, runId, gameId } = await addOcarina();
    await call('PUT', `/api/library/${entryId}/map`, {
      checkpoints: [
        { name: 'Young Link', aliases: [], isPointOfNoReturn: false, bossName: null },
        { name: 'Temple of Time', aliases: [], isPointOfNoReturn: true, bossName: null },
        { name: 'Adult Link', aliases: [], isPointOfNoReturn: false, bossName: null },
      ],
    });
    const rows = (await mapOf(runId)).map?.checkpoints ?? [];
    const [young, temple, adult] = rows;
    if (!young || !temple || !adult) throw new Error('map not created');

    t.ctx.db
      .insert(achievements)
      .values([
        {
          id: 'a-missable',
          gameId,
          origin: 'manual',
          name: 'Child Collector',
          isMissable: true,
          checkpointId: young.id,
        },
        {
          id: 'a-later',
          gameId,
          origin: 'manual',
          name: 'Adult Only',
          isMissable: true,
          checkpointId: adult.id,
        },
        { id: 'a-normal', gameId, origin: 'manual', name: 'Not Missable', checkpointId: young.id },
      ])
      .run();
    t.ctx.db
      .insert(collectibles)
      .values({
        id: 'c-missable',
        gameId,
        checkpointId: young.id,
        name: 'Child-only Mask',
        isMissable: true,
        origin: 'manual',
      })
      .run();
    await call('POST', `/api/playthroughs/${runId}/progress`, { checkpointId: young.id });
    return { runId, young, temple, adult };
  }

  it('warns before recording a move past it, listing what would be lost', async () => {
    const { runId, young, temple, adult } = await setup();
    const held = await call<ReportProgressResponse>('POST', `/api/playthroughs/${runId}/progress`, {
      checkpointId: adult.id,
    });
    expect(held.status).toBe(200);
    expect(held.body).toMatchObject({
      saved: false,
      checkpoint: { id: adult.id },
      warning: {
        pointOfNoReturn: { id: temple.id, name: 'Temple of Time' },
        missableAchievements: [{ id: 'a-missable', name: 'Child Collector' }],
        missableCollectibles: [{ id: 'c-missable', name: 'Child-only Mask' }],
      },
    });
    // Nothing moved yet.
    expect((await mapOf(runId)).currentCheckpointId).toBe(young.id);

    const confirmed = await call<ReportProgressResponse>(
      'POST',
      `/api/playthroughs/${runId}/progress`,
      {
        checkpointId: adult.id,
        confirmPointOfNoReturn: true,
      },
    );
    expect(confirmed).toMatchObject({ status: 201, body: { saved: true, warning: null } });
    expect((await mapOf(runId)).currentCheckpointId).toBe(adult.id);
  });

  it('leaves out what was already unlocked or collected, and does not warn again once past', async () => {
    const { runId, adult } = await setup();
    await call('PUT', `/api/playthroughs/${runId}/achievements/a-missable`, { isUnlocked: true });
    await call('PUT', `/api/playthroughs/${runId}/collectibles/c-missable`, { isCollected: true });

    const held = await call<ReportProgressResponse>('POST', `/api/playthroughs/${runId}/progress`, {
      rawText: 'now playing as Adult Link',
    });
    expect(held.body).toMatchObject({
      saved: false,
      resolvedBy: 'local_match',
      warning: { missableAchievements: [], missableCollectibles: [] },
    });

    await call('POST', `/api/playthroughs/${runId}/progress`, {
      checkpointId: adult.id,
      confirmPointOfNoReturn: true,
    });
    const stay = await call<ReportProgressResponse>('POST', `/api/playthroughs/${runId}/progress`, {
      checkpointId: adult.id,
    });
    expect(stay.body).toMatchObject({ saved: true, warning: null });
  });

  it('surfaces the pending missables as a proactive question', async () => {
    const { runId } = await setup();
    const assist = await call<GameAssistResponse>('GET', `/api/playthroughs/${runId}/assist`);
    expect(assist.body.questions).toContainEqual({
      kind: 'missables',
      subject: 'Temple of Time',
      count: 1,
    });
    expect(assist.body.questions).toContainEqual({
      kind: 'collectibles',
      subject: 'Young Link',
      count: 1,
    });
  });
});

describe('hint ladder rules', () => {
  async function inDekuTree() {
    t.ai.connected = true;
    const { entryId, runId } = await addOcarina();
    await call('PUT', `/api/library/${entryId}/map`, {
      checkpoints: [
        {
          name: 'Inside the Deku Tree',
          aliases: [],
          isPointOfNoReturn: false,
          bossName: 'Queen Gohma',
        },
      ],
    });
    const checkpointId = (await mapOf(runId)).map?.checkpoints[0]?.id;
    await call('POST', `/api/playthroughs/${runId}/progress`, { checkpointId });
    return runId;
  }
  const hint = (runId: string, body: object) =>
    call<HintResponse>('POST', `/api/playthroughs/${runId}/hints`, body);

  it('makes puzzles be climbed one level at a time', async () => {
    const runId = await inDekuTree();
    t.ai.answers = [
      { hint: 'nudge', sources: [] },
      { hint: 'direction', sources: [] },
    ];

    expect(await hint(runId, { kind: 'puzzle', level: 2, stuckOn: 'torches' })).toMatchObject({
      status: 409,
      body: { error: 'hint_level_locked' },
    });
    expect(t.ai.requests).toHaveLength(0);

    expect((await hint(runId, { kind: 'puzzle', level: 1, stuckOn: 'torches' })).status).toBe(200);
    expect((await hint(runId, { kind: 'puzzle', level: 2, stuckOn: 'torches' })).status).toBe(200);
    // Level 4 is still two steps away.
    expect((await hint(runId, { kind: 'puzzle', level: 4, stuckOn: 'torches' })).status).toBe(409);
    expect(t.ai.requests[0]?.system).toContain('Protect the "aha" moment');
  });

  it('lets a boss open straight at strategy, using the boss page', async () => {
    const runId = await inDekuTree();
    t.ai.answers = [{ hint: 'Acerte o olho quando ficar vermelho.', sources: [1] }];
    const response = await hint(runId, { kind: 'boss', level: 3, locale: 'pt-BR' });
    expect(response.status).toBe(200);
    expect(response.body.sources[0]?.url).toBe('https://zelda.fandom.com/wiki/Queen_Gohma');
    expect(t.ai.requests[0]?.system).toContain('attack patterns');
    expect(t.ai.requests[0]?.prompt).toContain('Boss: Queen Gohma');
    expect(t.ai.requests[0]?.prompt).toContain('Stun her eye with the slingshot');
  });

  it('treats a different "stuck on", level or language as a different hint', async () => {
    const runId = await inDekuTree();
    t.ai.answers = [{ hint: 'a', sources: [] }];
    await hint(runId, { kind: 'general', level: 1, stuckOn: 'web' });
    await hint(runId, { kind: 'general', level: 1, stuckOn: 'WEB ' });
    expect(t.ai.requests).toHaveLength(1);
    await hint(runId, { kind: 'general', level: 1, stuckOn: 'door' });
    await hint(runId, { kind: 'general', level: 1, stuckOn: 'web', locale: 'en' });
    expect(t.ai.requests).toHaveLength(3);
    expect(t.ai.requests.at(-1)?.system).toContain('in English');
  });

  it('adds web search results as attributed sources when a provider is configured', async () => {
    const runId = await inDekuTree();
    t.sources.webSearchConfigured = true;
    t.sources.webResults = [
      {
        title: 'Deku Tree guide',
        url: 'https://guides.example/deku',
        snippet: 'Burn the web with a Deku Stick.',
      },
    ];
    // No source named by the model: every source it was given is shown.
    t.ai.answers = [{ hint: 'Use fogo.', sources: [] }];
    const response = await hint(runId, { kind: 'general', level: 3, stuckOn: 'web' });
    expect(t.ai.requests[0]?.prompt).toContain('Burn the web with a Deku Stick.');
    expect(response.body.sources).toContainEqual(
      expect.objectContaining({ origin: 'web_search', url: 'https://guides.example/deku' }),
    );
    expect(response.body.sources).toContainEqual(expect.objectContaining({ origin: 'wiki' }));
  });

  it('gives a clear error when the AI keeps answering with invalid JSON', async () => {
    const runId = await inDekuTree();
    t.ai.answers = ['Sorry, here is a hint in prose.', '{"hint": 12}'];
    expect(await hint(runId, { kind: 'general', level: 1 })).toMatchObject({
      status: 502,
      body: { error: 'ai_invalid_response' },
    });
    expect(t.ai.requests).toHaveLength(2);
    expect(
      (await call<RevealedHintsResponse>('GET', `/api/playthroughs/${runId}/hints`)).body.items,
    ).toEqual([]);
  });

  it('asks about the boss of the area without spending an AI call', async () => {
    const runId = await inDekuTree();
    const assist = await call<GameAssistResponse>('GET', `/api/playthroughs/${runId}/assist`);
    expect(assist.body.questions).toEqual([
      { kind: 'boss_hint', subject: 'Queen Gohma', count: null },
    ]);
    expect(t.ai.requests).toHaveLength(0);
  });
});

describe('area checklist', () => {
  it('flags the achievements the sources call missable, but not the ones the user classified', async () => {
    t.ai.connected = true;
    const { entryId, runId, gameId } = await addOcarina();
    await call('PUT', `/api/library/${entryId}/map`, {
      checkpoints: [
        { name: 'Inside the Deku Tree', aliases: [], isPointOfNoReturn: false, bossName: null },
      ],
    });
    t.ctx.db
      .insert(achievements)
      .values([
        { id: 'a1', gameId, origin: 'manual', name: 'Deku Scholar', sortOrder: 1 },
        {
          id: 'a2',
          gameId,
          origin: 'manual',
          name: 'User Says No',
          sortOrder: 2,
          classifiedBy: 'user',
        },
      ])
      .run();
    t.ai.answers = [{ collectibles: [], missableAchievements: [1, 2, 9] }];

    const { body } = await call<AreaChecklistResponse>(
      'POST',
      `/api/playthroughs/${runId}/checklist/generate`,
    );
    expect(body.missableAchievements).toEqual([
      { id: 'a1', name: 'Deku Scholar', description: null },
    ]);
    expect(body.generated).toBe(true);
    expect(t.ai.requests[0]?.prompt).toContain('1. Deku Scholar');

    const rows = t.ctx.db.select().from(achievements).all();
    expect(rows.find((row) => row.id === 'a1')).toMatchObject({
      isMissable: true,
      classifiedBy: 'ai',
    });
    expect(rows.find((row) => row.id === 'a2')).toMatchObject({
      isMissable: false,
      classifiedBy: 'user',
    });
    const checkpointId = t.ctx.db.select().from(checkpoints).get()?.id;
    expect(rows.find((row) => row.id === 'a1')?.checkpointId).toBe(checkpointId);
  });
});

describe('"where I left off"', () => {
  it('shows a recap only after the run has been quiet for a while', async () => {
    const { entryId, runId } = await addOcarina();
    await call('PUT', `/api/library/${entryId}/map`, {
      checkpoints: [
        { name: 'Kokiri Forest', aliases: [], isPointOfNoReturn: false, bossName: null },
        { name: 'Inside the Deku Tree', aliases: [], isPointOfNoReturn: false, bossName: null },
      ],
    });
    await call('POST', `/api/playthroughs/${runId}/progress`, {
      rawText: 'saindo de Kokiri Forest',
    });
    await call('POST', `/api/library/${entryId}/sessions`, {
      playthroughId: runId,
      startedAt: '2026-11-10T11:00:00.000Z',
      durationMinutes: 45,
      note: 'Peguei a espada Kokiri.',
    });
    const assist = () => call<GameAssistResponse>('GET', `/api/playthroughs/${runId}/assist`);

    expect((await assist()).body.recap).toBeNull();

    t.setNow('2026-11-23T12:00:00.000Z');
    expect((await assist()).body.recap).toBeNull(); // 13 days

    t.setNow('2026-11-25T12:00:00.000Z');
    expect((await assist()).body.recap).toEqual({
      daysIdle: 15,
      lastProgress: { rawText: 'saindo de Kokiri Forest', occurredAt: '2026-11-10T12:00:00.000Z' },
      currentCheckpoint: 'Kokiri Forest',
      nextCheckpoint: 'Inside the Deku Tree',
      lastNotes: [{ note: 'Peguei a espada Kokiri.', startedAt: '2026-11-10T11:00:00.000Z' }],
    });

    // A finished run needs no reminder.
    await call('PATCH', `/api/playthroughs/${runId}`, { status: 'completed' });
    expect((await assist()).body.recap).toBeNull();
  });
});

describe('estimated abandonment funnel', () => {
  it('estimates from search results, says so, and is cached', async () => {
    t.ai.connected = true;
    t.sources.webSearchConfigured = true;
    t.sources.webResults = [
      {
        title: 'Stats',
        url: 'https://stats.example/oot',
        snippet: 'Around 40% of players finish Ocarina of Time.',
      },
    ];
    const { runId } = await addOcarina();
    t.ai.answers = [
      { percentFinished: 40.04, rationale: 'Com base em uma estatística citada na fonte 1.' },
    ];

    const estimate = () =>
      call<FunnelEstimateResponse>('POST', `/api/playthroughs/${runId}/funnel/estimate`, {
        locale: 'pt-BR',
      });
    const first = await estimate();
    expect(first.body).toEqual({
      percentFinished: 40,
      rationale: 'Com base em uma estatística citada na fonte 1.',
      sources: [{ origin: 'web_search', url: 'https://stats.example/oot' }],
      cached: false,
    });
    expect(t.ai.requests[0]?.prompt).toContain('Around 40% of players finish');

    expect((await estimate()).body.cached).toBe(true);
    expect(t.ai.requests).toHaveLength(1);
  });
});

describe('wiki of a game', () => {
  it('lets the user choose the wiki, rejecting addresses that are not one', async () => {
    const { entryId, runId } = await addOcarina();
    expect(
      await call('PUT', `/api/library/${entryId}/wiki`, {
        wikiUrl: 'https://example.com/not-a-wiki',
      }),
    ).toMatchObject({ status: 400, body: { error: 'wiki_not_found' } });

    const set = await call('PUT', `/api/library/${entryId}/wiki`, {
      wikiUrl: 'https://en.wikipedia.org/wiki/Ocarina_of_Time',
    });
    expect(set.body).toEqual({ wikiUrl: 'https://en.wikipedia.org/wiki/' });
    expect((await mapOf(runId)).wikiUrl).toBe('https://en.wikipedia.org/wiki/');

    await call('PUT', `/api/library/${entryId}/wiki`, { wikiUrl: null });
    expect((await mapOf(runId)).wikiUrl).toBeNull();
  });

  it('guesses Fandom wikis from the franchise and the title', () => {
    expect(
      wikiCandidates({
        title: 'The Legend of Zelda: Ocarina of Time',
        franchise: 'The Legend of Zelda',
      }),
    ).toEqual(expect.arrayContaining(['zelda', 'legendofzelda']));
    expect(wikiCandidates({ title: 'Dark Souls: Remastered', franchise: 'Dark Souls' })).toContain(
      'darksouls',
    );
    expect(wikiCandidates({ title: 'Pokémon Émeraude', franchise: null })).toContain(
      'pokemonemeraude',
    );
  });
});

describe('local matching and context trimming', () => {
  const row = (name: string, aliases: string[] = []) =>
    ({ id: name, name, aliases, position: 1 }) as unknown as Parameters<
      typeof matchCheckpointLocally
    >[1][number];

  it('matches names and aliases as whole words, ignoring case and accents', () => {
    const rows = [
      row('Deku Tree'),
      row('Inside the Deku Tree', ['Árvore Deku']),
      row('Fire Temple', ['Templo do Fogo']),
    ];
    expect(matchCheckpointLocally('i am INSIDE THE DEKU TREE', rows)?.name).toBe(
      'Inside the Deku Tree',
    );
    expect(matchCheckpointLocally('at the deku tree entrance', rows)?.name).toBe('Deku Tree');
    expect(matchCheckpointLocally('cheguei na arvore deku', rows)?.name).toBe(
      'Inside the Deku Tree',
    );
    expect(matchCheckpointLocally('entrei no templo do fogo', rows)?.name).toBe('Fire Temple');
    expect(matchCheckpointLocally('temple of fire, finally', rows)?.name).toBe('Fire Temple');
    expect(matchCheckpointLocally('somewhere in a firetemple', rows)).toBeNull();
    expect(matchCheckpointLocally('no idea where I am', rows)).toBeNull();
  });

  it('keeps the sections that mention the keywords when the budget is tight', () => {
    const doc = {
      title: 'Big Page',
      url: 'https://wiki.test/Big_Page',
      sections: [
        { heading: '', text: 'Intro paragraph.' },
        { heading: 'History', text: 'x'.repeat(4000) },
        { heading: 'Gold Skulltulas', text: 'On the vines.' },
      ],
    };
    const text = renderSources([doc], ['skulltula'], 300);
    expect(text).toContain('[1] Big Page — https://wiki.test/Big_Page');
    expect(text).toContain('Intro paragraph.');
    expect(text).toContain('On the vines.');
    expect(text).not.toContain('xxxx');
    expect(renderSources([], ['x'], 100)).toBe('');
  });
});

describe('web search settings', () => {
  it('stores provider keys without returning them', async () => {
    const saved = await call('PUT', '/api/search', { provider: 'brave', braveKey: 'BRAVE-SECRET' });
    expect(saved.raw).not.toContain('BRAVE-SECRET');
    expect(saved.body).toEqual({
      provider: 'brave',
      searxngUrl: null,
      hasBraveKey: true,
      hasTavilyKey: false,
    });
    expect((await call('PUT', '/api/search', { provider: 'nope' })).status).toBe(400);
  });
});
