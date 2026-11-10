import type { HowLongToBeatEntry } from 'howlongtobeat-ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../../db/client.ts';
import { createTestDatabase } from '../../test/helpers.ts';
import { SourceCache } from '../cache.ts';
import { cleanTitle, createHltbSource, type HltbClient } from './index.ts';

const hours = (value: number) => value * 3600;

function entry(overrides: Partial<HowLongToBeatEntry>): HowLongToBeatEntry {
  return {
    id: 1,
    name: 'Game',
    alias: '',
    type: 'game',
    reviewScore: 80,
    platforms: [],
    similarity: 1,
    releaseYear: 2000,
    raw: {} as HowLongToBeatEntry['raw'],
    ...overrides,
  };
}

const residentEvil4 = [
  entry({
    id: 7720,
    name: 'Resident Evil 4',
    releaseYear: 2005,
    mainTime: hours(16),
    mainExtraTime: hours(19.5),
    completionistTime: hours(32),
  }),
  entry({
    id: 108881,
    name: 'Resident Evil 4',
    releaseYear: 2023,
    mainTime: hours(16.5),
    mainExtraTime: hours(20),
    completionistTime: hours(31),
  }),
  entry({ id: 5, name: 'Resident Evil 4: Separate Ways', similarity: 0.6, releaseYear: 2023 }),
];

let handle: DatabaseHandle;
let enabled: boolean;
let searches: string[];

function createSource(respond: HltbClient['search']) {
  const client: HltbClient = {
    search: (title) => {
      searches.push(title);
      return respond(title);
    },
  };
  return createHltbSource({ cache: new SourceCache(handle.db), isEnabled: () => enabled, client });
}

const found = (data: HowLongToBeatEntry[]) => () =>
  Promise.resolve({ success: true as const, data });

beforeEach(() => {
  handle = createTestDatabase();
  enabled = true;
  searches = [];
});

afterEach(() => handle.close());

describe('HowLongToBeat source', () => {
  it('converts times to minutes and links the game page', async () => {
    const source = createSource(found(residentEvil4));
    const result = await source.findTimes({ title: 'Resident Evil 4', releaseYear: 2005 });

    expect(result?.data).toEqual({
      externalId: '7720',
      title: 'Resident Evil 4',
      mainMinutes: 960,
      mainExtraMinutes: 1170,
      completionistMinutes: 1920,
      url: 'https://howlongtobeat.com/game/7720',
    });
    expect(result?.provenance).toMatchObject({
      origin: 'hltb',
      url: 'https://howlongtobeat.com/game/7720',
    });
  });

  it('uses the release year to tell a remake from the original', async () => {
    const source = createSource(found(residentEvil4));
    const remake = await source.findTimes({ title: 'Resident Evil 4', releaseYear: 2023 });
    expect(remake?.data.externalId).toBe('108881');
  });

  it('ignores results that are not similar enough', async () => {
    const source = createSource(found([entry({ name: 'Something Else', similarity: 0.5 })]));
    expect(await source.findTimes({ title: 'Resident Evil 4' })).toBeNull();
  });

  it('falls back to alternative titles', async () => {
    const source = createSource((title) =>
      Promise.resolve({
        success: true as const,
        data: title === 'Biohazard 4' ? [entry({ id: 7720, name: 'Resident Evil 4' })] : [],
      }),
    );
    const result = await source.findTimes({
      title: 'Resident Evil 4™',
      alternativeTitles: ['Biohazard 4'],
    });
    expect(searches).toEqual(['Resident Evil 4', 'Biohazard 4']);
    expect(result?.data.externalId).toBe('7720');
  });

  it('caches both hits and misses, so the site is asked once', async () => {
    const hit = createSource(found(residentEvil4));
    await hit.findTimes({ title: 'Resident Evil 4', releaseYear: 2005 });
    const cached = await hit.findTimes({ title: 'Resident Evil 4', releaseYear: 2005 });
    expect(cached?.fromCache).toBe(true);
    expect(searches).toHaveLength(1);

    const miss = createSource(found([]));
    expect(await miss.findTimes({ title: 'Unknown Game' })).toBeNull();
    expect(await miss.findTimes({ title: 'Unknown Game' })).toBeNull();
    expect(searches).toHaveLength(2);
  });

  it('treats missing times as unknown, not zero', async () => {
    const source = createSource(found([entry({ name: 'Short Demo', mainTime: 0 })]));
    const result = await source.findTimes({ title: 'Short Demo' });
    expect(result?.data).toMatchObject({ mainMinutes: null, completionistMinutes: null });
  });

  it('fails with a SourceError instead of breaking, and does not cache the failure', async () => {
    let fail = true;
    const source = createSource(() =>
      fail
        ? Promise.resolve({ success: false as const, error: 'boom', kind: 'transport' })
        : Promise.resolve({ success: true as const, data: residentEvil4 }),
    );
    await expect(source.findTimes({ title: 'Resident Evil 4' })).rejects.toMatchObject({
      source: 'hltb',
      code: 'unreachable',
    });

    fail = false;
    expect(await source.findTimes({ title: 'Resident Evil 4' })).not.toBeNull();
  });

  it('maps a changed site to invalid_response and a 429 to rate_limited', async () => {
    const changed = createSource(() =>
      Promise.resolve({ success: false as const, error: 'x', kind: 'parse' }),
    );
    await expect(changed.findTimes({ title: 'A' })).rejects.toMatchObject({
      code: 'invalid_response',
    });

    const limited = createSource(() =>
      Promise.resolve({ success: false as const, error: 'x', kind: 'http', status: 429 }),
    );
    await expect(limited.findTimes({ title: 'B' })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('makes no request when the user turned the source off', async () => {
    enabled = false;
    const source = createSource(found(residentEvil4));
    await expect(source.findTimes({ title: 'Resident Evil 4' })).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(searches).toHaveLength(0);
  });
});

describe('cleanTitle', () => {
  it('removes trademark signs and extra spaces', () => {
    expect(cleanTitle('DARK SOULS™:  REMASTERED®')).toBe('DARK SOULS: REMASTERED');
  });
});
