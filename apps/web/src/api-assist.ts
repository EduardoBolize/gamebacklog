import {
  aiModelsResponseSchema,
  aiOverviewResponseSchema,
  aiTestResponseSchema,
  aiUsageResponseSchema,
  areaChecklistResponseSchema,
  chapterMapResponseSchema,
  funnelEstimateResponseSchema,
  gameAssistResponseSchema,
  hintResponseSchema,
  reportProgressResponseSchema,
  revealedHintsResponseSchema,
  webSearchSettingsSchema,
  type AiProviderId,
  type HintRequest,
  type ReportProgressRequest,
  type SaveAiProviderRequest,
  type SaveAiSettingsRequest,
  type SaveCheckpointsRequest,
  type SaveWebSearchRequest,
} from '@gamebacklog/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from './api.ts';

/** Client for the AI-assisted features: connecting an AI, the chapter map, hints and 100% mode. */

const anything = z.unknown();
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
  generateMap: (entryId: string, force: boolean) =>
    request('POST', `/api/library/${entryId}/map/generate`, anything, { force }),
  saveMap: (entryId: string, body: SaveCheckpointsRequest) =>
    request('PUT', `/api/library/${entryId}/map`, anything, body),
  setWiki: (entryId: string, wikiUrl: string | null) =>
    request('PUT', `/api/library/${entryId}/wiki`, wikiResponse, { wikiUrl }),

  reportProgress: (runId: string, body: ReportProgressRequest) =>
    request('POST', `/api/playthroughs/${runId}/progress`, reportProgressResponseSchema, body),

  hints: (runId: string) =>
    request('GET', `/api/playthroughs/${runId}/hints`, revealedHintsResponseSchema),
  requestHint: (runId: string, body: HintRequest) =>
    request('POST', `/api/playthroughs/${runId}/hints`, hintResponseSchema, body),

  checklist: (runId: string, checkpointId: string | null) =>
    request(
      'GET',
      `/api/playthroughs/${runId}/checklist${checkpointId ? `?checkpointId=${encodeURIComponent(checkpointId)}` : ''}`,
      areaChecklistResponseSchema,
    ),
  generateChecklist: (runId: string, checkpointId: string | null) =>
    request(
      'POST',
      `/api/playthroughs/${runId}/checklist/generate${checkpointId ? `?checkpointId=${encodeURIComponent(checkpointId)}` : ''}`,
      areaChecklistResponseSchema,
    ),
  setCollected: (runId: string, collectibleId: string, isCollected: boolean) =>
    request('PUT', `/api/playthroughs/${runId}/collectibles/${collectibleId}`, anything, {
      isCollected,
    }),

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
  hints: (runId: string) => ['hints', runId] as const,
  checklist: (runId: string, checkpointId: string | null) =>
    ['checklist', runId, checkpointId] as const,
  assist: (runId: string) => ['assist', runId] as const,
};

export const useAi = () => useQuery({ queryKey: assistKeys.ai, queryFn: assistApi.ai });
export const useAiUsage = () =>
  useQuery({ queryKey: assistKeys.aiUsage, queryFn: assistApi.aiUsage });
export const useWebSearch = () =>
  useQuery({ queryKey: assistKeys.webSearch, queryFn: assistApi.webSearch });
export const useMap = (runId: string) =>
  useQuery({ queryKey: assistKeys.map(runId), queryFn: () => assistApi.map(runId) });
export const useHints = (runId: string) =>
  useQuery({ queryKey: assistKeys.hints(runId), queryFn: () => assistApi.hints(runId) });
export const useChecklist = (runId: string, checkpointId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: assistKeys.checklist(runId, checkpointId),
    queryFn: () => assistApi.checklist(runId, checkpointId),
    enabled,
    retry: false,
  });
export const useAssist = (runId: string) =>
  useQuery({ queryKey: assistKeys.assist(runId), queryFn: () => assistApi.assist(runId) });
