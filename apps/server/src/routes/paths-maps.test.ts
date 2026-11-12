import type {
  ChapterMapResponse,
  GameDetailResponse,
  GameMapsResponse,
  InteractiveMap,
  PathsResponse,
  ReportProgressResponse,
} from '@gamebacklog/shared';
import {
  gameMapsResponseSchema,
  interactiveMapSchema,
  pathsResponseSchema,
} from '@gamebacklog/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiProviderError } from '../ai/provider.ts';
import { readProgressLocally } from '../assist/progress.ts';
import { achievements, type checkpoints } from '../db/schema/index.ts';
import { catalogGame, createTestApp, type TestApp } from '../test/context.ts';
import type { WikiInteractiveMap } from '../sources/wiki/index.ts';
import { parseDataMap, parseFandomMap, plainText } from '../sources/wiki/interactive-map.ts';

let t: TestApp;

async function call<T = unknown>(method: string, url: string, payload?: unknown) {
  const response = await t.app.inject({
    method: method as 'GET',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json<T>() };
}

/** Dark Souls II's opening, branching the way the real game does. */
const ROUTE_ANSWER = {
  checkpoints: [
    { name: 'Majula', aliases: [], leadsTo: [2, 4, 5] },
    {
      name: 'Forest of Fallen Giants',
      aliases: ['Floresta dos Gigantes Caídos', 'Floresta dos Gigantes'],
      leadsTo: [3],
      bossName: 'The Last Giant',
    },
    {
      name: 'The Lost Bastille',
      aliases: ['Bastilha Perdida'],
      leadsTo: [6],
      bossName: 'Ruin Sentinels',
    },
    {
      name: "Heide's Tower of Flame",
      aliases: ['Torre da Chama de Heide', 'Heide'],
      leadsTo: [7],
    },
    { name: 'The Pit', aliases: ['Poço'], leadsTo: [], requirement: null },
    { name: "Sinners' Rise", aliases: [], leadsTo: [] },
    { name: 'No-man’s Wharf', aliases: [], leadsTo: [] },
    { name: 'The Gutter', aliases: [], leadsTo: [], requirement: 'Fragrant Branch of Yore' },
  ],
};

async function addDarkSouls() {
  const added = await call<{ libraryEntryId: string }>('POST', '/api/library', {
    status: 'playing',
    game: { kind: 'igdb', externalId: '1958' },
  });
  const entryId = added.body.libraryEntryId;
  const detail = (await call<GameDetailResponse>('GET', `/api/library/${entryId}`)).body;
  return { entryId, runId: detail.playthroughs[0]?.id ?? '', gameId: detail.game.id };
}

const mapOf = async (runId: string) =>
  (await call<ChapterMapResponse>('GET', `/api/playthroughs/${runId}/map`)).body;
const nameOf = (map: ChapterMapResponse, id: string | null) =>
  map.map?.checkpoints.find((checkpoint) => checkpoint.id === id)?.name;

beforeEach(async () => {
  t = await createTestApp();
  t.sources.catalog = [
    catalogGame({
      externalId: '1958',
      title: 'Dark Souls II',
      franchise: 'Dark Souls',
      releaseYear: 2014,
      platforms: ['PC (Microsoft Windows)'],
      genres: ['Role-playing (RPG)'],
    }),
  ];
  t.sources.wikiHosts = ['darksouls.fandom.com'];
  t.sources.wikiPages = {
    'Dark Souls II': [{ heading: '', text: 'Dark Souls II areas: Majula, The Lost Bastille.' }],
    'The Lost Bastille': [
      { heading: '', text: 'The Lost Bastille. Leads to Sinners Rise. Lucatiel is here.' },
    ],
  };
});

afterEach(() => t.close());

describe('"where am I?" on a branching route', () => {
  it('reads "I finished X and Y, I am at Z" without AI, in Portuguese', async () => {
    t.ai.connected = true;
    const { entryId, runId } = await addDarkSouls();
    t.ai.answers = [ROUTE_ANSWER];
    await call('POST', `/api/library/${entryId}/map/generate`, { locale: 'pt-BR' });
    expect(t.ai.requests[0]?.system).toContain('Brazilian Portuguese');
    expect(t.ai.requests).toHaveLength(1);

    const report = await call<ReportProgressResponse>(
      'POST',
      `/api/playthroughs/${runId}/progress`,
      { rawText: 'Terminei floresta dos gigantes e heide, estou na bastilha perdida' },
    );
    expect(report.status).toBe(201);
    expect(report.body).toMatchObject({
      saved: true,
      resolvedBy: 'local_match',
      checkpoint: { name: 'The Lost Bastille' },
      notPlaced: null,
      aiError: null,
    });
    expect(report.body.completed.map((checkpoint) => checkpoint.name)).toEqual([
      'Forest of Fallen Giants',
      "Heide's Tower of Flame",
    ]);
    // No AI was needed to read it.
    expect(t.ai.requests).toHaveLength(1);

    const map = await mapOf(runId);
    expect(nameOf(map, map.currentCheckpointId)).toBe('The Lost Bastille');
    expect(map.completedCheckpointIds.map((id) => nameOf(map, id))).toEqual([
      'Forest of Fallen Giants',
      "Heide's Tower of Flame",
    ]);
    // Branches point at checkpoint IDs; the requirement is kept as the game names it.
    const majula = map.map?.checkpoints[0];
    expect(majula?.leadsTo.map((id) => nameOf(map, id))).toEqual([
      'Forest of Fallen Giants',
      "Heide's Tower of Flame",
      'The Pit',
    ]);
    expect(map.map?.checkpoints.at(-1)?.requirement).toBe('Fragrant Branch of Yore');
  });

  it('lets a checkpoint be ticked and unticked by hand', async () => {
    const { entryId, runId } = await addDarkSouls();
    await call('PUT', `/api/library/${entryId}/map`, {
      checkpoints: [
        { name: 'Majula', aliases: [], isPointOfNoReturn: false, bossName: null },
        { name: 'The Pit', aliases: [], isPointOfNoReturn: false, bossName: null },
      ],
    });
    const pit = (await mapOf(runId)).map?.checkpoints[1]?.id ?? '';
    const done = `/api/playthroughs/${runId}/checkpoints/${pit}/done`;
    expect((await call('PUT', done, { done: true })).status).toBe(200);
    expect((await mapOf(runId)).completedCheckpointIds).toEqual([pit]);
    await call('PUT', done, { done: false });
    expect((await mapOf(runId)).completedCheckpointIds).toEqual([]);
    expect(
      (await call('PUT', `/api/playthroughs/${runId}/checkpoints/nope/done`, { done: true }))
        .status,
    ).toBe(400);
  });

  it('says why the text was not placed when the AI ran out of quota', async () => {
    t.ai.connected = true;
    const { runId } = await addDarkSouls();
    t.ai.answers = [
      new AiProviderError('ollama', 'usage_limit', 'Fake AI reached its usage limit'),
    ];
    const report = await call<ReportProgressResponse>(
      'POST',
      `/api/playthroughs/${runId}/progress`,
      { rawText: 'estou na bastilha perdida' },
    );
    expect(report.status).toBe(201);
    expect(report.body).toMatchObject({
      saved: true,
      checkpoint: null,
      notPlaced: 'no_map',
      aiError: 'ai_usage_limit',
    });

    // The same failure, asked directly, is a clear error code.
    const generate = await call<{ error: string }>(
      'POST',
      `/api/library/${(await call<{ items: { id: string }[] }>('GET', '/api/library')).body.items[0]?.id ?? ''}/map/generate`,
      {},
    );
    expect(generate.status).toBe(502);
    expect(generate.body.error).toBe('ai_usage_limit');
  });

  it('keeps the run in place when the route is rebuilt with the same names', async () => {
    t.ai.connected = true;
    const { entryId, runId } = await addDarkSouls();
    t.ai.answers = [ROUTE_ANSWER];
    await call('POST', `/api/library/${entryId}/map/generate`, {});
    await call('POST', `/api/playthroughs/${runId}/progress`, {
      rawText: 'terminei a floresta dos gigantes, agora estou na bastilha perdida',
    });

    t.ai.answers = [{ ...ROUTE_ANSWER, checkpoints: ROUTE_ANSWER.checkpoints.slice(0, 4) }];
    await call('POST', `/api/library/${entryId}/map/generate`, { force: true });
    const map = await mapOf(runId);
    expect(map.map?.checkpoints).toHaveLength(4);
    expect(nameOf(map, map.currentCheckpointId)).toBe('The Lost Bastille');
    expect(map.completedCheckpointIds.map((id) => nameOf(map, id))).toEqual([
      'Forest of Fallen Giants',
    ]);
    // A branch towards a place that is no longer on the route is dropped.
    expect(map.map?.checkpoints[2]?.leadsTo).toEqual([]);
  });

  it('prefers the place marked with "I am at", wherever it is in the sentence', () => {
    const row = (id: string, name: string, aliases: string[] = []) =>
      ({ id, name, aliases }) as unknown as typeof checkpoints.$inferSelect;
    const rows = [
      row('a', 'Forest of Fallen Giants', ['Floresta dos Gigantes']),
      row('b', 'The Lost Bastille', ['Bastilha Perdida']),
      row('c', 'Majula'),
    ];
    expect(
      readProgressLocally('estou na bastilha perdida, terminei a floresta dos gigantes', rows),
    ).toMatchObject({ current: { id: 'b' }, completed: [{ id: 'a' }] });
    expect(readProgressLocally('Majula', rows)).toMatchObject({
      current: { id: 'c' },
      completed: [],
    });
    expect(readProgressLocally('nowhere known', rows)).toBeNull();
  });
});

describe('paths ahead', () => {
  async function setUp() {
    t.ai.connected = true;
    const { entryId, runId, gameId } = await addDarkSouls();
    t.ai.answers = [ROUTE_ANSWER];
    await call('POST', `/api/library/${entryId}/map/generate`, {});
    t.ctx.db
      .insert(achievements)
      .values([
        {
          id: 'ach-lucatiel',
          gameId,
          origin: 'manual',
          name: 'Lucatiel of Mirrah',
          description: 'Complete Lucatiel’s questline.',
        },
        { id: 'ach-other', gameId, origin: 'manual', name: 'Last Giant' },
      ])
      .run();
    await call('POST', `/api/playthroughs/${runId}/progress`, {
      rawText: 'estou na bastilha perdida',
    });
    return runId;
  }

  it('lists where the run can go next for free, and the AI reading only on request', async () => {
    const runId = await setUp();
    const before = t.ai.requests.length;
    const free = await call<PathsResponse>('GET', `/api/playthroughs/${runId}/paths?locale=pt-BR`);
    expect(pathsResponseSchema.parse(free.body)).toMatchObject({
      current: { name: 'The Lost Bastille' },
      options: [{ name: "Sinners' Rise" }],
      analysis: null,
      aiConnected: true,
    });
    expect(t.ai.requests).toHaveLength(before);

    t.ai.answers = [
      {
        beforeLeaving: [
          {
            kind: 'npc',
            name: 'Lucatiel of Mirrah',
            detail: 'Fale com ela antes do chefe.',
            achievement: 1,
          },
        ],
        paths: [
          {
            option: 1,
            howToGetThere: 'Pelo elevador depois da fogueira.',
            warnings: [
              { kind: 'item', name: 'Pharros’ Lockstone', detail: 'Use antes de seguir.' },
            ],
          },
          // An option that does not exist is dropped.
          { option: 9, howToGetThere: 'x', warnings: [] },
        ],
      },
    ];
    const analyzed = await call<PathsResponse>(
      'POST',
      `/api/playthroughs/${runId}/paths/analyze?locale=pt-BR`,
    );
    expect(analyzed.status).toBe(200);
    expect(analyzed.body.analysis).toMatchObject({
      beforeLeaving: [{ kind: 'achievement', achievementId: 'ach-lucatiel' }],
      paths: [{ howToGetThere: 'Pelo elevador depois da fogueira.', warnings: [{ kind: 'item' }] }],
      cached: false,
    });
    expect(analyzed.body.analysis?.paths).toHaveLength(1);
    const prompt = t.ai.requests.at(-1);
    expect(prompt?.system).toContain('Brazilian Portuguese');
    expect(prompt?.prompt).toContain("1. Sinners' Rise");
    expect(prompt?.prompt).toContain('Lucatiel of Mirrah');

    // Reopening costs nothing: the reading comes back from the cache.
    const reopened = await call<PathsResponse>(
      'GET',
      `/api/playthroughs/${runId}/paths?locale=pt-BR`,
    );
    expect(reopened.body.analysis?.beforeLeaving[0]?.achievementId).toBe('ach-lucatiel');
    const requests = t.ai.requests.length;
    await call('POST', `/api/playthroughs/${runId}/paths/analyze?locale=pt-BR`);
    expect(t.ai.requests).toHaveLength(requests);
  });

  it('needs a position before asking the AI', async () => {
    const { runId } = await addDarkSouls();
    t.ai.connected = true;
    const result = await call<{ error: string }>(
      'POST',
      `/api/playthroughs/${runId}/paths/analyze`,
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('no_position');
  });
});

describe('maps from the wikis', () => {
  const eldenMap = (): WikiInteractiveMap => ({
    title: 'Dark Souls II World',
    pageUrl: 'https://darksouls.wiki.gg/wiki/Map:Dark_Souls_II_World',
    kind: 'datamaps',
    layers: [
      {
        id: 'main',
        name: 'Drangleic',
        imageUrl: 'https://darksouls.wiki.gg/images/map.jpg',
        width: 4096,
        height: 4096,
      },
    ],
    categories: [{ id: 'area', name: 'Area', color: '#c00', iconUrl: null, count: 2 }],
    markers: [
      {
        id: 'm1',
        categoryId: 'area',
        layerId: 'main',
        x: 0.5,
        y: 0.5,
        title: 'The Lost Bastille',
        description: 'A prison fortress.',
        imageUrl: null,
        link: 'https://darksouls.wiki.gg/wiki/The_Lost_Bastille',
      },
      {
        id: 'm2',
        categoryId: 'area',
        layerId: 'main',
        x: 0.6,
        y: 0.4,
        title: "Sinners' Rise",
        description: null,
        imageUrl: null,
        link: null,
      },
    ],
  });

  it('gathers interactive maps and map images from several wikis of the game', async () => {
    t.sources.wikiHosts = ['darksouls.fandom.com', 'darksouls.wiki.gg'];
    t.sources.wikiMaps = { 'darksouls.wiki.gg': [eldenMap()] };
    t.sources.wikiImages = [
      {
        title: 'Dark Souls II World Map',
        thumbUrl: 'https://static.example/map.jpg',
        pageUrl: 'https://darksouls.fandom.com/wiki/File:Map.jpg',
        width: 1600,
        height: 1200,
      },
    ];
    t.ai.connected = true;
    const { entryId, runId } = await addDarkSouls();
    t.ai.answers = [ROUTE_ANSWER];
    await call('POST', `/api/library/${entryId}/map/generate`, {});
    await call('POST', `/api/playthroughs/${runId}/progress`, { rawText: 'bastilha perdida' });

    const maps = await call<GameMapsResponse>('GET', `/api/playthroughs/${runId}/maps`);
    expect(maps.status).toBe(200);
    const body = gameMapsResponseSchema.parse(maps.body);
    expect(body.wikis.map((wiki) => wiki.url)).toEqual([
      'https://darksouls.fandom.com/wiki/',
      'https://darksouls.wiki.gg/wiki/',
    ]);
    expect(body.interactive).toEqual([
      expect.objectContaining({
        title: 'Dark Souls II World',
        page: 'Dark Souls II World',
        wikiUrl: 'https://darksouls.wiki.gg/wiki/',
        kind: 'datamaps',
      }),
    ]);
    expect(body.images[0]).toMatchObject({ title: 'Dark Souls II World Map' });
    expect(body.currentCheckpoint).toBe('The Lost Bastille');

    const query = new URLSearchParams({
      wiki: 'https://darksouls.wiki.gg/wiki/',
      title: 'Map:Dark Souls II World',
    });
    const map = await call<InteractiveMap>(
      'GET',
      `/api/playthroughs/${runId}/maps/interactive?${query.toString()}`,
    );
    expect(map.status).toBe(200);
    expect(interactiveMapSchema.parse(map.body)).toMatchObject({
      wikiName: 'darksouls.wiki.gg',
      // Where the run is, and where it can go next, are pointed out on the map.
      highlights: { here: ['m1'], next: ['m2'] },
      provenance: { origin: 'wiki', url: 'https://darksouls.wiki.gg/wiki/Map:Dark_Souls_II_World' },
    });
  });

  it('only reads maps from the wikis of the game', async () => {
    const { runId } = await addDarkSouls();
    const query = new URLSearchParams({ wiki: 'https://evil.example/wiki/', title: 'Map:X' });
    const result = await call<{ error: string }>(
      'GET',
      `/api/playthroughs/${runId}/maps/interactive?${query.toString()}`,
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('wiki_not_found');
  });
});

describe('interactive map formats', () => {
  it('reads a Fandom map: x/y order, origin at the bottom', () => {
    const draft = parseFandomMap(
      {
        mapImage: 'Plateau Map.jpg',
        mapBounds: [
          [0, 0],
          [700, 500],
        ],
        coordinateOrder: 'xy',
        origin: 'bottom-left',
        categories: [{ id: '1', name: 'Shrines', color: '#1f943c' }],
        markers: [
          {
            id: '2',
            categoryId: '1',
            position: [350, 100],
            popup: {
              title: 'Keh Namut Shrine',
              description: "A '''shrine'''",
              link: { url: 'Keh Namut Shrine' },
            },
          },
          { id: '3', categoryId: '1', position: [9000, 9000], popup: { title: 'Off the map' } },
          'garbage',
        ],
      },
      'Great Plateau',
    );
    expect(draft?.layers).toEqual([{ id: 'main', name: 'Great Plateau', file: 'Plateau Map.jpg' }]);
    expect(draft?.markers).toEqual([
      {
        id: '2',
        categoryId: '1',
        layerId: null,
        x: 0.5,
        y: 0.8,
        title: 'Keh Namut Shrine',
        description: 'A shrine',
        imageUrl: null,
        link: 'Keh Namut Shrine',
      },
    ]);
  });

  it('reads a DataMaps map: legacy corners, backgrounds and marker layers', () => {
    const draft = parseDataMap(
      {
        crs: { order: 'xy', topLeft: [9645, 9119], bottomRight: [0, 0] },
        backgrounds: [
          { name: 'The Lands Between', image: 'ER Map.webp', associatedLayer: 'Layer_TLB' },
          { name: 'Underground', image: 'ER Under.webp', associatedLayer: 'Layer_GUGR' },
        ],
        groups: {
          Region: { name: 'Region', icon: 'File:Region icon.png' },
        },
      },
      {
        'Region bg:Layer_TLB': [
          [
            2188,
            2550,
            {
              uid: '100001',
              label: 'Limgrave',
              desc: '<p>The first region.</p>',
              image: ['/images/thumb/Limgrave.png/288px-Limgrave.png', 1, 1],
              article: 'Limgrave',
            },
          ],
        ],
        'Region bg:Layer_GUGR': [[0, 0, { label: 'Corner', desc: '<p>INSERTDESCRIPTIONHERE</p>' }]],
      },
      'ELDEN RING',
      'https://eldenring.wiki.gg',
    );
    expect(draft?.layers.map((layer) => layer.id)).toEqual(['Layer_TLB', 'Layer_GUGR']);
    expect(draft?.categories).toEqual([
      { id: 'Region', name: 'Region', color: null, iconFile: 'Region icon.png' },
    ]);
    const [limgrave, corner] = draft?.markers ?? [];
    // The origin is at the bottom: y grows upwards, so a low y is near the bottom of the image.
    expect(limgrave).toMatchObject({
      id: '100001',
      layerId: 'Layer_TLB',
      title: 'Limgrave',
      description: 'The first region.',
      imageUrl: 'https://eldenring.wiki.gg/images/thumb/Limgrave.png/288px-Limgrave.png',
      link: 'Limgrave',
    });
    expect(limgrave?.x).toBeCloseTo(2550 / 9645, 5);
    expect(limgrave?.y).toBeCloseTo(1 - 2188 / 9119, 5);
    expect(corner).toMatchObject({ x: 0, y: 1, description: null, layerId: 'Layer_GUGR' });
  });

  it('turns marker markup into plain text', () => {
    expect(plainText('<p>Line<br/>[[Page|Shown]] &amp; more</p>')).toBe('Line\nShown & more');
    expect(plainText('   ')).toBeNull();
  });
});
