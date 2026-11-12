import {
  achievementListResponseSchema,
  achievementSyncResponseSchema,
  addGameResponseSchema,
  apiErrorSchema,
  appStateResponseSchema,
  backupRunResponseSchema,
  backupStatusResponseSchema,
  catalogSearchResponseSchema,
  funnelResponseSchema,
  gameDetailResponseSchema,
  gameTimesSchema,
  importPreviewResponseSchema,
  importResultResponseSchema,
  libraryListResponseSchema,
  linkRetroGameResponseSchema,
  nudgeListResponseSchema,
  playthroughSchema,
  progressListResponseSchema,
  reviewListResponseSchema,
  sessionListResponseSchema,
  sourceListResponseSchema,
  sourceTestResponseSchema,
  steamImportPreviewResponseSchema,
  steamImportResponseSchema,
  steamSyncResponseSchema,
  type AddGameRequest,
  type BackupSettings,
  type ClassifyAchievementRequest,
  type ConfigurableSource,
  type ConsoleImportRequest,
  type ConsolePlatform,
  type CreatePlaythroughRequest,
  type CreateSessionRequest,
  type ImportMode,
  type SaveReviewRequest,
  type SaveSourceRequest,
  type SetManualTimesRequest,
  type SteamImportRequest,
  type UpdateLibraryEntryRequest,
  type UpdatePlaythroughRequest,
  type UpdateSessionRequest,
} from '@gamebacklog/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

/** Error from the local server, carrying the machine-readable code the UI translates. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function request<T>(
  method: string,
  url: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiError(parsed.success ? parsed.data.error : 'generic', response.status);
  }
  // Responses are validated too: a server/web mismatch fails loudly instead of rendering garbage.
  return schema.parse(json);
}

const anything = z.unknown();
const timesResponse = z.object({
  times: gameTimesSchema.nullable(),
  sourceFailed: z.boolean().optional(),
});

export const api = {
  appState: () => request('GET', '/api/app/state', appStateResponseSchema),
  completeSetup: () => request('POST', '/api/app/setup-completed', anything),

  library: () => request('GET', '/api/library', libraryListResponseSchema),
  nudges: () => request('GET', '/api/library/nudges', nudgeListResponseSchema),
  searchCatalog: (query: string) =>
    request(
      'GET',
      `/api/catalog/search?q=${encodeURIComponent(query)}`,
      catalogSearchResponseSchema,
    ),
  addGame: (body: AddGameRequest) => request('POST', '/api/library', addGameResponseSchema, body),
  game: (entryId: string) => request('GET', `/api/library/${entryId}`, gameDetailResponseSchema),
  updateEntry: (entryId: string, body: UpdateLibraryEntryRequest) =>
    request('PATCH', `/api/library/${entryId}`, gameDetailResponseSchema, body),
  removeEntry: (entryId: string) => request('DELETE', `/api/library/${entryId}`, anything),

  setTimes: (entryId: string, body: SetManualTimesRequest) =>
    request('PUT', `/api/library/${entryId}/times`, timesResponse, body),
  refreshTimes: (entryId: string) =>
    request('POST', `/api/library/${entryId}/times/refresh`, timesResponse),

  createPlaythrough: (entryId: string, body: CreatePlaythroughRequest) =>
    request('POST', `/api/library/${entryId}/playthroughs`, playthroughSchema, body),
  updatePlaythrough: (runId: string, body: UpdatePlaythroughRequest) =>
    request('PATCH', `/api/playthroughs/${runId}`, anything, body),
  deletePlaythrough: (runId: string) => request('DELETE', `/api/playthroughs/${runId}`, anything),

  progress: (runId: string) =>
    request('GET', `/api/playthroughs/${runId}/progress`, progressListResponseSchema),
  addProgress: (runId: string, rawText: string) =>
    request('POST', `/api/playthroughs/${runId}/progress`, anything, { rawText }),
  funnel: (runId: string) =>
    request('GET', `/api/playthroughs/${runId}/funnel`, funnelResponseSchema),

  achievements: (runId: string) =>
    request('GET', `/api/playthroughs/${runId}/achievements`, achievementListResponseSchema),
  syncAchievements: (entryId: string) =>
    request('POST', `/api/library/${entryId}/achievements/sync`, achievementSyncResponseSchema),
  linkRetroGame: (entryId: string, game: string) =>
    request('PUT', `/api/library/${entryId}/retroachievements`, linkRetroGameResponseSchema, {
      game,
    }),
  classifyAchievement: (achievementId: string, body: ClassifyAchievementRequest) =>
    request('PATCH', `/api/achievements/${achievementId}`, anything, body),
  setAchievementUnlocked: (runId: string, achievementId: string, isUnlocked: boolean) =>
    request('PUT', `/api/playthroughs/${runId}/achievements/${achievementId}`, anything, {
      isUnlocked,
    }),

  sessions: (entryId: string) =>
    request('GET', `/api/library/${entryId}/sessions`, sessionListResponseSchema),
  createSession: (entryId: string, body: CreateSessionRequest) =>
    request('POST', `/api/library/${entryId}/sessions`, anything, body),
  updateSession: (sessionId: string, body: UpdateSessionRequest) =>
    request('PATCH', `/api/sessions/${sessionId}`, anything, body),
  deleteSession: (sessionId: string) => request('DELETE', `/api/sessions/${sessionId}`, anything),

  reviews: (entryId: string) =>
    request('GET', `/api/library/${entryId}/reviews`, reviewListResponseSchema),
  saveReview: (entryId: string, body: SaveReviewRequest) =>
    request('PUT', `/api/library/${entryId}/reviews`, anything, body),
  deleteReview: (reviewId: string) => request('DELETE', `/api/reviews/${reviewId}`, anything),

  sources: () => request('GET', '/api/sources', sourceListResponseSchema),
  saveSource: (body: SaveSourceRequest) =>
    request('PUT', '/api/sources', sourceListResponseSchema, body),
  removeSource: (id: ConfigurableSource) =>
    request('DELETE', `/api/sources/${id}`, sourceListResponseSchema),
  testSource: (id: ConfigurableSource) =>
    request('POST', `/api/sources/${id}/test`, sourceTestResponseSchema),

  steamPreview: () =>
    request('POST', '/api/steam/import/preview', steamImportPreviewResponseSchema),
  steamImport: (body: SteamImportRequest) =>
    request('POST', '/api/steam/import', steamImportResponseSchema, body),
  steamSync: () => request('POST', '/api/steam/sync', steamSyncResponseSchema),
  consolePreview: (platform: ConsolePlatform) =>
    request('POST', `/api/consoles/${platform}/import/preview`, steamImportPreviewResponseSchema),
  consoleImport: (platform: ConsolePlatform, body: ConsoleImportRequest) =>
    request('POST', `/api/consoles/${platform}/import`, steamImportResponseSchema, body),

  importPreview: (mode: ImportMode, file: unknown) =>
    request('POST', '/api/import/preview', importPreviewResponseSchema, { mode, file }),
  importFile: (mode: ImportMode, file: unknown) =>
    request('POST', '/api/import', importResultResponseSchema, { mode, file }),

  backup: () => request('GET', '/api/backup', backupStatusResponseSchema),
  saveBackup: (body: BackupSettings) =>
    request('PUT', '/api/backup', backupStatusResponseSchema, body),
  runBackup: () => request('POST', '/api/backup/run', backupRunResponseSchema),
};

/** Query keys, kept in one place so reads and invalidations cannot drift apart. */
export const keys = {
  appState: ['appState'] as const,
  library: ['library'] as const,
  nudges: ['nudges'] as const,
  catalog: (query: string) => ['catalog', query] as const,
  game: (entryId: string) => ['game', entryId] as const,
  progress: (runId: string) => ['progress', runId] as const,
  funnel: (runId: string) => ['funnel', runId] as const,
  achievements: (runId: string) => ['achievements', runId] as const,
  sessions: (entryId: string) => ['sessions', entryId] as const,
  reviews: (entryId: string) => ['reviews', entryId] as const,
  sources: ['sources'] as const,
  importPreview: (source: string) => ['importPreview', source] as const,
  backup: ['backup'] as const,
};

export const useAppState = () => useQuery({ queryKey: keys.appState, queryFn: api.appState });
export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: api.library });
export const useNudges = () => useQuery({ queryKey: keys.nudges, queryFn: api.nudges });
export const useGame = (entryId: string) =>
  useQuery({ queryKey: keys.game(entryId), queryFn: () => api.game(entryId) });
export const useProgress = (runId: string) =>
  useQuery({ queryKey: keys.progress(runId), queryFn: () => api.progress(runId) });
export const useFunnel = (runId: string) =>
  useQuery({ queryKey: keys.funnel(runId), queryFn: () => api.funnel(runId) });
export const useAchievements = (runId: string) =>
  useQuery({ queryKey: keys.achievements(runId), queryFn: () => api.achievements(runId) });
export const useSessions = (entryId: string) =>
  useQuery({ queryKey: keys.sessions(entryId), queryFn: () => api.sessions(entryId) });
export const useReviews = (entryId: string) =>
  useQuery({ queryKey: keys.reviews(entryId), queryFn: () => api.reviews(entryId) });
export const useSources = () => useQuery({ queryKey: keys.sources, queryFn: api.sources });
export const useBackup = () => useQuery({ queryKey: keys.backup, queryFn: api.backup });

/**
 * Mutation that refreshes everything on screen when it succeeds. The server is on the same
 * machine and the data is small, so refetching beats tracking which lists each change touches.
 */
export function useApiMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiError, TInput>({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
