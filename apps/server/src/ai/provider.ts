import type { AiCostHint, AiHealthStatus, AiProviderId, AiProviderKind } from '@gamebacklog/shared';
import { z } from 'zod';

/**
 * Contract every AI provider implements, so each feature works the same with any of them:
 * a CLI using the user's subscription, a pay-per-use API key, or a local model.
 *
 * A provider only has to turn a system prompt and a user prompt into text (`generate`).
 * Structured output is layered on top, the same way for all of them (`complete` with a schema):
 * the model is asked for JSON, the answer is parsed and validated with Zod.
 */

export interface AiCapabilities {
  /** Whether the provider can be constrained natively to a JSON schema. Not relied upon. */
  structuredOutput: boolean;
  maxContextTokens: number;
  costHint: AiCostHint;
}

export interface AiHealth {
  status: AiHealthStatus;
  /** Short explanation for logs. Must never contain keys or tokens. */
  message: string;
}

export interface AiTextRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  /** Lets the caller cancel a request in flight (e.g. kill a CLI process). */
  signal?: AbortSignal;
}

export interface AiUsage {
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  durationMs: number;
}

export interface AiTextResult {
  text: string;
  model: string;
  /** Token counts when the provider reports them; estimated from the text otherwise. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AiCompletion<T> {
  output: T;
  model: string;
  usage: AiUsage;
}

/** What each adapter implements. */
export interface AiProviderCore {
  readonly id: AiProviderId;
  readonly displayName: string;
  readonly kind: AiProviderKind;
  readonly capabilities: AiCapabilities;

  /** Cheap check that spends no tokens: installed and logged in, key stored, server up. */
  detect(): Promise<AiHealth>;
  /** Models the user can pick from, when the provider can list them. */
  listModels?(): Promise<string[]>;
  generate(request: AiTextRequest): Promise<AiTextResult>;
}

export interface AiCompletionRequest extends AiTextRequest {
  /** Not sent to providers that reject it; kept for the ones that accept it. */
  temperature?: number;
}

export interface AiStructuredRequest<T> extends AiCompletionRequest {
  /** When present, the provider returns an object validated against this schema. */
  schema: z.ZodType<T>;
}

export interface AiProvider extends AiProviderCore {
  /** Real round trip with a tiny prompt. Never throws. */
  healthCheck(): Promise<AiHealth>;

  /** Plain text when no schema is given; a validated object when one is. */
  complete(request: AiCompletionRequest): Promise<AiCompletion<string>>;
  complete<T>(request: AiStructuredRequest<T>): Promise<AiCompletion<T>>;
}

export type AiErrorCode =
  | 'unavailable'
  | 'not_authenticated'
  | 'timeout'
  | 'cancelled'
  | 'invalid_response'
  /** The subscription or the key ran out of quota for now (HTTP 429 and the like). */
  | 'usage_limit'
  | 'provider_error';

/** Error thrown by providers. `message` must be safe to show and log: no keys, no tokens. */
export class AiProviderError extends Error {
  readonly providerId: string;
  readonly code: AiErrorCode;
  /** For `invalid_response`: what was wrong, to hand back to the model on the retry. */
  readonly detail: string | undefined;

  constructor(
    providerId: string,
    code: AiErrorCode,
    message: string,
    options?: ErrorOptions & { detail?: string },
  ) {
    super(message, options);
    this.name = 'AiProviderError';
    this.providerId = providerId;
    this.code = code;
    this.detail = options?.detail;
  }
}

/** Rough token count for budgeting and for usage when the provider reports none. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Pulls the JSON value out of a model answer. Models wrap JSON in code fences or add a sentence
 * before it no matter how they are asked, so this looks for the outermost object or array.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[{[]/);
  if (start === -1) throw new SyntaxError('No JSON object or array in the answer');
  const open = candidate[start];
  const end = candidate.lastIndexOf(open === '{' ? '}' : ']');
  if (end <= start) throw new SyntaxError('The JSON in the answer is not closed');
  return JSON.parse(candidate.slice(start, end + 1));
}

function jsonInstructions(schema: z.ZodType): string {
  return [
    'Answer with a single JSON value and nothing else: no code fences, no commentary.',
    'It must validate against this JSON Schema:',
    JSON.stringify(z.toJSONSchema(schema)),
  ].join('\n');
}

/** Turns an adapter into a full provider: adds the health check and schema-validated output. */
export function defineProvider(core: AiProviderCore): AiProvider {
  async function complete<T>(
    request: AiCompletionRequest & { schema?: z.ZodType<T> },
  ): Promise<AiCompletion<T | string>> {
    const startedAt = Date.now();
    const system = request.schema
      ? `${request.system}\n\n${jsonInstructions(request.schema)}`
      : request.system;
    const result = await core.generate({
      system,
      prompt: request.prompt,
      maxTokens: request.maxTokens,
      signal: request.signal,
    });
    const usage: AiUsage = {
      inputTokensEstimated: result.usage?.inputTokens ?? estimateTokens(system + request.prompt),
      outputTokensEstimated: result.usage?.outputTokens ?? estimateTokens(result.text),
      durationMs: Date.now() - startedAt,
    };
    if (!request.schema) return { output: result.text, model: result.model, usage };

    let parsed: unknown;
    try {
      parsed = extractJson(result.text);
    } catch (error) {
      throw new AiProviderError(core.id, 'invalid_response', 'The AI did not answer with JSON', {
        detail: error instanceof Error ? error.message : 'Invalid JSON',
      });
    }
    const validated = request.schema.safeParse(parsed);
    if (!validated.success) {
      throw new AiProviderError(
        core.id,
        'invalid_response',
        'The AI answered with JSON in the wrong shape',
        { detail: z.prettifyError(validated.error) },
      );
    }
    return { output: validated.data, model: result.model, usage };
  }

  return {
    ...core,
    detect: () => core.detect(),
    listModels: core.listModels ? () => core.listModels?.() ?? Promise.resolve([]) : undefined,
    generate: (request) => core.generate(request),
    complete: complete,

    async healthCheck(): Promise<AiHealth> {
      const detected = await core.detect();
      if (detected.status !== 'ok') return detected;
      try {
        await core.generate({
          system: 'You are a connection test.',
          prompt: 'Reply with the single word: OK',
          maxTokens: 64,
          signal: AbortSignal.timeout(60_000),
        });
        return { status: 'ok', message: `${core.displayName} answered` };
      } catch (error) {
        if (error instanceof AiProviderError) {
          const status: AiHealthStatus =
            error.code === 'not_authenticated'
              ? 'not_authenticated'
              : error.code === 'unavailable' || error.code === 'timeout'
                ? 'unreachable'
                : 'error';
          return { status, message: error.message };
        }
        return { status: 'error', message: 'Unexpected error' };
      }
    },
  };
}
