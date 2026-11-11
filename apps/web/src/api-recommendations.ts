import {
  explainRecommendationsResponseSchema,
  favoriteGenreResponseSchema,
  playNextResponseSchema,
  similarCompletionResponseSchema,
  similarGamesResponseSchema,
  tasteProfileResponseSchema,
  type ExplainRecommendationsRequest,
} from '@gamebacklog/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './api.ts';
import type { Locale } from './i18n/index.tsx';

/** Client for the recommendations. Only `explain` can reach the AI. */

const withLocale = (url: string, locale: Locale, extra: Record<string, string> = {}) =>
  `${url}?${new URLSearchParams({ locale, ...extra }).toString()}`;

export const recommendationsApi = {
  profile: () => request('GET', '/api/recommendations/profile', tasteProfileResponseSchema),
  playNext: (locale: Locale) =>
    request('GET', withLocale('/api/recommendations/play-next', locale), playNextResponseSchema),
  similar: (entryId: string, locale: Locale) =>
    request(
      'GET',
      withLocale(`/api/recommendations/similar/${entryId}`, locale),
      similarGamesResponseSchema,
    ),
  completion: (entryId: string, locale: Locale) =>
    request(
      'GET',
      withLocale(`/api/recommendations/completion/${entryId}`, locale),
      similarCompletionResponseSchema,
    ),
  genre: (genre: string, locale: Locale) =>
    request(
      'GET',
      withLocale('/api/recommendations/genre', locale, genre ? { genre } : {}),
      favoriteGenreResponseSchema,
    ),
  explain: (body: ExplainRecommendationsRequest) =>
    request('POST', '/api/recommendations/explain', explainRecommendationsResponseSchema, body),
};

const keys = {
  profile: ['recommendations', 'profile'] as const,
  playNext: (locale: Locale) => ['recommendations', 'playNext', locale] as const,
  similar: (entryId: string, locale: Locale) =>
    ['recommendations', 'similar', entryId, locale] as const,
  completion: (entryId: string, locale: Locale) =>
    ['recommendations', 'completion', entryId, locale] as const,
  genre: (genre: string, locale: Locale) => ['recommendations', 'genre', genre, locale] as const,
};

export const useTasteProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: recommendationsApi.profile });
export const usePlayNext = (locale: Locale) =>
  useQuery({ queryKey: keys.playNext(locale), queryFn: () => recommendationsApi.playNext(locale) });
export const useSimilarGames = (entryId: string, locale: Locale) =>
  useQuery({
    queryKey: keys.similar(entryId, locale),
    queryFn: () => recommendationsApi.similar(entryId, locale),
  });
export const useSimilarCompletion = (entryId: string, locale: Locale) =>
  useQuery({
    queryKey: keys.completion(entryId, locale),
    queryFn: () => recommendationsApi.completion(entryId, locale),
  });
export const useFavoriteGenre = (genre: string, locale: Locale) =>
  useQuery({
    queryKey: keys.genre(genre, locale),
    queryFn: () => recommendationsApi.genre(genre, locale),
    // Keep the previous genre on screen while the next one loads.
    placeholderData: (previous) => previous,
  });
