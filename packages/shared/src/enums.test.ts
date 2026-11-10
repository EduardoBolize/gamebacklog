import { describe, expect, it } from 'vitest';
import {
  DATA_ORIGINS,
  EXTERNAL_ID_SOURCES,
  SOURCE_IDS,
  healthResponseSchema,
  libraryStatusSchema,
  provenanceSchema,
} from './index.ts';

describe('shared enums', () => {
  it('accepts every library status from the spec and rejects unknown ones', () => {
    for (const status of [
      'playing',
      'backlog',
      'wishlist',
      'completed',
      'completed_100',
      'paused',
      'dropped',
    ]) {
      expect(libraryStatusSchema.parse(status)).toBe(status);
    }
    expect(libraryStatusSchema.safeParse('abandoned').success).toBe(false);
  });

  it('treats every source as a valid data origin, plus ai and manual', () => {
    expect(DATA_ORIGINS).toEqual([...SOURCE_IDS, 'ai', 'manual']);
  });

  it('only cross-references IDs from known sources', () => {
    for (const source of EXTERNAL_ID_SOURCES) {
      expect(SOURCE_IDS).toContain(source);
    }
  });
});

describe('shared contracts', () => {
  it('validates provenance', () => {
    expect(
      provenanceSchema.safeParse({
        origin: 'steam',
        url: 'https://store.steampowered.com/app/367520',
        fetchedAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(provenanceSchema.safeParse({ origin: 'gamefaqs' }).success).toBe(false);
  });

  it('validates the health response', () => {
    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        app: 'GameBacklog',
        version: '0.0.0',
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(healthResponseSchema.safeParse({ status: 'down' }).success).toBe(false);
  });
});
