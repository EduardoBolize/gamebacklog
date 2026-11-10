import type { AiCostHint, AiProviderKind } from '@gamebacklog/shared';
import type { z } from 'zod';

/**
 * Contract every AI provider implements, so each feature works the same with any of them:
 * a CLI using the user's subscription, a pay-per-use API key, or a local model.
 *
 * Skeleton only — the adapters (Claude Code / Codex / Gemini CLIs, Anthropic / OpenAI /
 * Gemini / OpenRouter APIs, Ollama / LM Studio) arrive in Phase 2.
 */

export interface AiCapabilities {
  /** Whether the provider can be constrained to return JSON matching a schema. */
  structuredOutput: boolean;
  maxContextTokens: number;
  costHint: AiCostHint;
}

export type AiHealthStatus =
  'ok' | 'not_installed' | 'not_authenticated' | 'not_configured' | 'unreachable' | 'error';

export interface AiHealth {
  status: AiHealthStatus;
  /** Friendly, user-facing explanation. Must never contain keys or tokens. */
  message: string;
}

export interface AiCompletionRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  /** Lets the caller cancel a request in flight (e.g. kill a CLI process). */
  signal?: AbortSignal;
}

export interface AiStructuredRequest<T> extends AiCompletionRequest {
  /** When present, the provider returns an object validated against this schema. */
  schema: z.ZodType<T>;
}

export interface AiUsage {
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  durationMs: number;
}

export interface AiCompletion<T> {
  output: T;
  model: string;
  usage: AiUsage;
}

export interface AiProvider {
  readonly id: string;
  readonly displayName: string;
  readonly kind: AiProviderKind;
  readonly capabilities: AiCapabilities;

  /** Reports whether the provider is installed, logged in and reachable. Never throws. */
  healthCheck(): Promise<AiHealth>;

  /** Plain text when no schema is given; a validated object when one is. */
  complete(request: AiCompletionRequest): Promise<AiCompletion<string>>;
  complete<T>(request: AiStructuredRequest<T>): Promise<AiCompletion<T>>;
}

export type AiErrorCode =
  'unavailable' | 'timeout' | 'cancelled' | 'invalid_response' | 'provider_error';

/** Error thrown by providers. `message` must be safe to show and log: no keys, no tokens. */
export class AiProviderError extends Error {
  readonly providerId: string;
  readonly code: AiErrorCode;

  constructor(providerId: string, code: AiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiProviderError';
    this.providerId = providerId;
    this.code = code;
  }
}
