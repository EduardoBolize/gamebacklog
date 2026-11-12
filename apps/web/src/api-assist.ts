import {
  aiModelsResponseSchema,
  aiOverviewResponseSchema,
  aiTestResponseSchema,
  aiUsageResponseSchema,
  areaChecklistResponseSchema,
  areaMediaResponseSchema,
  chapterMapResponseSchema,
  funnelEstimateResponseSchema,
  gameAssistResponseSchema,
  gameMapsResponseSchema,
  hintResponseSchema,
  interactiveMapSchema,
  pathsResponseSchema,
  reportProgressResponseSchema,
  revealedHintsResponseSchema,
  webSearchSettingsSchema,
  type AiProviderId,
  type HintRequest,
  type InteractiveMapRef,
  type ReportProgressRequest,
  type SaveAiProviderRequest,
  type SaveAiSettingsRequest,
  type SaveCheckpointsRequest,
  type SaveWebSearchRequest,
} from '@gamebacklog/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from './api.ts';
import type { Locale } from './i18n/index.tsx';

/** Client for the AI-assisted features: connecting an AI, the chapter map, hints and 100% mode. */

const anything = z.unknown();
/** Query string naming an area (the current one when null) and the language of the texts. */
const areaQuery = (checkpointId: string | null, locale: Locale) =>
  new URLSearchParams({ locale, ...(checkpointId ? { checkpointId } : {}) }).toString();
const wikiResponse = z.object({ wikiUrl: z.string().nullable() });

export const assistApi = {
  ai: () => request('GET', '/api/ai', aiOverviewResponseSchema),
  saveAiSettings: (body: SaveAiSettingsRequest) =>
    request('PUT', '/api/ai/settings', aiOverviewResponseSchema, body),
  saveAiProvider: (id: AiProviderId, body: SaveAiProviderRequest) =>
    request('PUT', `/api/ai/providers/${id}`, aiOverviewResponseSchema, body),
  removeAiKey: (id: AiProviderId) =>
    request('DELETE', `/api/ai/providers/${id}/key`, aiOverviewResponseSchema),
  testAi: (id: AiProviderId) =>
    request('POST', `/api/ai/providers/${id}/test`, aiTestResponseSchema),
  aiModels: (id: AiProviderId) =>
    request('GET', `/api/ai/providers/${id}/models`, aiModelsResponseSchema),
  aiUsage: () => request('GET', '/api/ai/usage?limit=200', aiUsageResponseSchema),

  webSearch: () => request('GET', '/api/search', webSearchSettingsSchema),
  saveWebSearch: (body: SaveWebSearchRequest) =>
    request('PUT', '/api/search', webSearchSettingsSchema, body),

  map: (runId: string) =>
    request('GET', `/api/playthroughs/${runId}/map`, chapterMapResponseSchema),
  generateMap: (entryId: string, force: boolean, locale: Locale) =>
    request('POST', `/api/library/${entryId}/map/generate`, anything, { force, locale }),
  setCheckpointDone: (runId: string, checkpointId: string, done: boolean) =>
    request('PUT', `/api/playthroughs/${runId}/checkpoints/${checkpointId}/done`, anything, {
      done,
    }),

  paths: (runId: string, locale: Locale) =>
    request('GET', `/api/playthroughs/${runId}/paths?locale=${locale}`, pathsResponseSchema),
  analyzePaths: (runId: string, locale: Locale) =>
    request(
      'POST',
      `/api/playthroughs/${runId}/paths/analyze?locale=${locale}`,
      pathsResponseSchema,
      {},
    ),

  maps: (runId: string) =>
    request('GET', `/api/playthroughs/${runId}/maps`, gameMapsResponseSchema),
  interactiveMap: (runId: string, ref: Pick<InteractiveMapRef, 'wikiUrl' | 'page'>) =>
    request(
      'GET',
      `/api/playthroughs/${runId}/maps/interactive?${new URLSearchParams({ wiki: ref.wikiUrl, title: ref.page }).toString()}`,
      interactiveMapSchema,
    ),
  saveMap: (entryId: string, body: SaveCheckpointsRequest) =>
    request('PUT', `/api/library/${entryId}/map`, anything, body),
  setWiki: (entryId: string, wikiUrl: string | null) =>
    request('PUT', `/api/library/${entryId}/wiki`, wikiResponse, { wikiUrl }),

  reportProgress: (runId: string, body: ReportProgressRequest) =>
    request('POST', `/api/playthroughs/${runId}/progress`, reportProgressResponseSchema, body),

  hints: (runId: string, locale: Locale) =>
    request(
      'GET',
      `/api/playthroughs/${runId}/hints?locale=${locale}`,
      revealedHintsResponseSchema,
    ),
  requestHint: (runId: string, body: HintRequest) =>
    request('POST', `/api/playthroughs/${runId}/hints`, hintResponseSchema, body),

  checklist: (runId: string, checkpointId: string | null, locale: Locale) =>
    request(
      'GET',
      `/api/playthroughs/${runId}/checklist?${areaQuery(checkpointId, locale)}`,
      areaChecklistResponseSchema,
    ),
  generateChecklist: (runId: string, checkpointId: string | null, locale: Locale) =>
    request(
      'POST',
      `/api/playthroughs/${runId}/checklist/generate?${areaQuery(checkpointId, locale)}`,
      areaChecklistResponseSchema,
    ),
  setCollected: (runId: string, collectibleId: string, isCollected: boolean) =>
    request('PUT', `/api/playthroughs/${runId}/collectibles/${collectibleId}`, anything, {
      isCollected,
    }),

  media: (runId: string, checkpointId: string | null, locale: Locale) =>
    request(
      'GET',
      `/api/playthroughs/${runId}/media?${areaQuery(checkpointId, locale)}`,
      areaMediaResponseSchema,
    ),

  assist: (runId: string) =>
    request('GET', `/api/playthroughs/${runId}/assist`, gameAssistResponseSchema),
  estimateFunnel: (runId: string, locale: 'pt-BR' | 'en') =>
    request('POST', `/api/playthroughs/${runId}/funnel/estimate`, funnelEstimateResponseSchema, {
      locale,
    }),
};

export const assistKeys = {
  ai: ['ai'] as const,
  aiUsage: ['aiUsage'] as const,
  webSearch: ['webSearch'] as const,
  map: (runId: string) => ['map', runId] as const,
  paths: (runId: string, locale: Locale) => ['paths', runId, locale] as const,
  maps: (runId: string) => ['maps', runId] as const,
  interactiveMap: (runId: string, wikiUrl: string, title: string) =>
    ['interactiveMap', runId, wikiUrl, title] as const,
  hints: (runId: string, locale: Locale) => ['hints', runId, locale] as const,
  checklist: (runId: string, checkpointId: string | null, locale: Locale) =>
    ['checklist', runId, checkpointId, locale] as const,
  assist: (runId: string) => ['assist', runId] as const,
  media: (runId: string, checkpointId: string | null, locale: Locale) =>
    ['media', runId, checkpointId, locale] as const,
};

export const useAi = () => useQuery({ queryKey: assistKeys.ai, queryFn: assistApi.ai });
export const useAiUsage = () =>
  useQuery({ queryKey: assistKeys.aiUsage, queryFn: assistApi.aiUsage });
export const useWebSearch = () =>
  useQuery({ queryKey: assistKeys.webSearch, queryFn: assistApi.webSearch });
export const useMap = (runId: string) =>
  useQuery({ queryKey: assistKeys.map(runId), queryFn: () => assistApi.map(runId) });
export const usePaths = (runId: string, locale: Locale) =>
  useQuery({
    queryKey: assistKeys.paths(runId, locale),
    queryFn: () => assistApi.paths(runId, locale),
  });
export const useGameMaps = (runId: string) =>
  useQuery({
    queryKey: assistKeys.maps(runId),
    queryFn: () => assistApi.maps(runId),
    // Looking through the wikis takes a few seconds the first time; keep the answer a while.
    staleTime: 10 * 60_000,
    retry: false,
  });
export const useInteractiveMap = (
  runId: string,
  ref: Pick<InteractiveMapRef, 'wikiUrl' | 'page'> | null,
) =>
  useQuery({
    queryKey: assistKeys.interactiveMap(runId, ref?.wikiUrl ?? '', ref?.page ?? ''),
    queryFn: () => assistApi.interactiveMap(runId, ref ?? { wikiUrl: '', page: '' }),
    enabled: ref !== null,
    staleTime: 10 * 60_000,
    retry: false,
  });
export const useHints = (runId: string, locale: Locale) =>
  useQuery({
    queryKey: assistKeys.hints(runId, locale),
    queryFn: () => assistApi.hints(runId, locale),
  });
export const useChecklist = (
  runId: string,
  checkpointId: string | null,
  locale: Locale,
  enabled: boolean,
) =>
  useQuery({
    queryKey: assistKeys.checklist(runId, checkpointId, locale),
    queryFn: () => assistApi.checklist(runId, checkpointId, locale),
    enabled,
    retry: false,
  });
export const useAreaMedia = (
  runId: string,
  checkpointId: string | null,
  locale: Locale,
  enabled: boolean,
) =>
  useQuery({
    queryKey: assistKeys.media(runId, checkpointId, locale),
    queryFn: () => assistApi.media(runId, checkpointId, locale),
    enabled,
    // Maps and videos of an area do not change while the page is open.
    staleTime: 10 * 60_000,
    retry: false,
  });
export const useAssist = (runId: string) =>
  useQuery({ queryKey: assistKeys.assist(runId), queryFn: () => assistApi.assist(runId) });
