import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AiProviderId } from '@gamebacklog/shared';
import { APICallError, generateText, type LanguageModel } from 'ai';
import type { FetchLike } from '../../sources/http.ts';
import {
  AiProviderError,
  type AiHealth,
  type AiProviderCore,
  type AiTextResult,
} from '../provider.ts';

/**
 * Pay-per-use APIs and local servers, all through the Vercel AI SDK so one code path serves
 * every one of them. OpenRouter, Ollama and LM Studio speak the OpenAI-compatible protocol.
 */

/**
 * Room for the answer plus the reasoning some models do before it. Only tokens actually
 * generated are billed; a low cap just risks an answer cut in the middle.
 */
const MIN_OUTPUT_TOKENS = 8000;

/** Shown as suggestions; Anthropic's list is curated because its current IDs are stable. */
const ANTHROPIC_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-2',
];

interface ApiSpec {
  id: AiProviderId;
  displayName: string;
  kind: 'api' | 'local';
  defaultModel: string | null;
  defaultBaseUrl: string | null;
  /** Builds the SDK model. `apiKey` is null for local servers. */
  model(options: {
    apiKey: string | null;
    baseUrl: string | null;
    model: string;
    fetch: FetchLike;
  }): LanguageModel;
  /** Lists model IDs, when the service has an endpoint for it. */
  listModels?(options: {
    apiKey: string | null;
    baseUrl: string | null;
    fetch: FetchLike;
  }): Promise<string[]>;
}

async function openAiStyleModels(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey: string | null,
): Promise<string[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
}

const compatible = (name: string) => (options: Parameters<ApiSpec['model']>[0]) =>
  createOpenAICompatible({
    name,
    baseURL: options.baseUrl ?? '',
    apiKey: options.apiKey ?? undefined,
    fetch: options.fetch as typeof fetch,
  })(options.model);

export const API_SPECS: ApiSpec[] = [
  {
    id: 'anthropic',
    displayName: 'Anthropic (API)',
    kind: 'api',
    defaultModel: 'claude-opus-5-5',
    defaultBaseUrl: null,
    model: ({ apiKey, model, fetch }) =>
      createAnthropic({ apiKey: apiKey ?? undefined, fetch: fetch as typeof globalThis.fetch })(
        model,
      ),
    listModels: () => Promise.resolve(ANTHROPIC_MODELS),
  },
  {
    id: 'openai',
    displayName: 'OpenAI (API)',
    kind: 'api',
    defaultModel: null,
    defaultBaseUrl: 'https://api.openai.com/v1',
    model: ({ apiKey, model, fetch }) =>
      createOpenAI({ apiKey: apiKey ?? undefined, fetch: fetch as typeof globalThis.fetch })(model),
    listModels: ({ apiKey, fetch }) =>
      openAiStyleModels(fetch, 'https://api.openai.com/v1', apiKey),
  },
  {
    id: 'google',
    displayName: 'Google Gemini (API)',
    kind: 'api',
    defaultModel: null,
    defaultBaseUrl: null,
    model: ({ apiKey, model, fetch }) =>
      createGoogleGenerativeAI({
        apiKey: apiKey ?? undefined,
        fetch: fetch as typeof globalThis.fetch,
      })(model),
    async listModels({ apiKey, fetch }) {
      // The key goes in a header, never in the URL.
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey ?? '' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[];
      };
      return (body.models ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
        .map((model) => (model.name ?? '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort();
    },
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter (API)',
    kind: 'api',
    defaultModel: null,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    model: compatible('openrouter'),
    listModels: ({ apiKey, baseUrl, fetch }) =>
      openAiStyleModels(fetch, baseUrl ?? 'https://openrouter.ai/api/v1', apiKey),
  },
  {
    id: 'ollama',
    displayName: 'Ollama (local)',
    kind: 'local',
    defaultModel: null,
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    model: compatible('ollama'),
    listModels: ({ baseUrl, fetch }) =>
      openAiStyleModels(fetch, baseUrl ?? 'http://127.0.0.1:11434/v1', null),
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio (local)',
    kind: 'local',
    defaultModel: null,
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    model: compatible('lmstudio'),
    listModels: ({ baseUrl, fetch }) =>
      openAiStyleModels(fetch, baseUrl ?? 'http://127.0.0.1:1234/v1', null),
  },
];

export interface ApiProviderOptions {
  spec: ApiSpec;
  getApiKey: () => string | null;
  getModel: () => string | null;
  getBaseUrl: () => string | null;
  timeoutMs: () => number;
  fetch: FetchLike;
}

export function createApiProvider(options: ApiProviderOptions): AiProviderCore {
  const { spec } = options;
  const baseUrl = () => options.getBaseUrl() ?? spec.defaultBaseUrl;
  const model = () => options.getModel() ?? spec.defaultModel;
  const connection = () => ({
    apiKey: options.getApiKey(),
    baseUrl: baseUrl(),
    fetch: options.fetch,
  });

  return {
    id: spec.id,
    displayName: spec.displayName,
    kind: spec.kind,
    capabilities: {
      structuredOutput: false,
      maxContextTokens: spec.kind === 'local' ? 8_000 : 100_000,
      costHint: spec.kind === 'local' ? 'free' : 'pay-per-use',
    },

    async detect(): Promise<AiHealth> {
      if (spec.kind === 'api') {
        return options.getApiKey()
          ? { status: 'ok', message: 'API key stored' }
          : { status: 'not_configured', message: 'No API key stored' };
      }
      try {
        await spec.listModels?.(connection());
        return { status: 'ok', message: `${spec.displayName} is running` };
      } catch {
        return { status: 'unreachable', message: `${spec.displayName} is not running` };
      }
    },

    listModels: spec.listModels
      ? () => spec.listModels?.(connection()) ?? Promise.resolve([])
      : undefined,

    async generate(request): Promise<AiTextResult> {
      const modelId = model();
      if (!modelId) {
        throw new AiProviderError(spec.id, 'unavailable', `Choose a model for ${spec.displayName}`);
      }
      if (spec.kind === 'api' && !options.getApiKey()) {
        throw new AiProviderError(
          spec.id,
          'not_authenticated',
          `${spec.displayName} has no API key`,
        );
      }
      try {
        const result = await generateText({
          model: spec.model({ ...connection(), model: modelId }),
          system: request.system,
          prompt: request.prompt,
          // No sampling parameters: current models reject them, and the defaults are fine here.
          maxOutputTokens: Math.max(request.maxTokens, MIN_OUTPUT_TOKENS),
          maxRetries: 1,
          abortSignal: request.signal
            ? AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs())])
            : AbortSignal.timeout(options.timeoutMs()),
        });
        if (result.finishReason === 'content-filter') {
          throw new AiProviderError(spec.id, 'provider_error', 'The model declined to answer');
        }
        if (!result.text.trim()) {
          throw new AiProviderError(spec.id, 'provider_error', 'The model returned no text');
        }
        return {
          text: result.text,
          model: modelId,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        };
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        if (request.signal?.aborted) {
          throw new AiProviderError(spec.id, 'cancelled', 'The request was cancelled');
        }
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new AiProviderError(spec.id, 'timeout', `${spec.displayName} took too long`);
        }
        // Provider messages are not passed on: they can echo request details.
        if (APICallError.isInstance(error)) {
          const status = error.statusCode;
          if (status === 429) {
            throw new AiProviderError(
              spec.id,
              'usage_limit',
              `${spec.displayName} reached its usage limit`,
            );
          }
          if (status === 401 || status === 403) {
            throw new AiProviderError(
              spec.id,
              'not_authenticated',
              `${spec.displayName} rejected the key`,
            );
          }
          throw new AiProviderError(
            spec.id,
            'provider_error',
            `${spec.displayName} answered with status ${String(status)}`,
          );
        }
        throw new AiProviderError(spec.id, 'unavailable', `Could not reach ${spec.displayName}`);
      }
    },
  };
}
