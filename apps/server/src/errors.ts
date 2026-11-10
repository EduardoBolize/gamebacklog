import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { SourceError } from './sources/adapter.ts';

/** Error with an HTTP status and a stable machine-readable code the web app can translate. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const badRequest = (code: string, message?: string) => new HttpError(400, code, message);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);

const SOURCE_ERROR_STATUS: Record<SourceError['code'], number> = {
  not_configured: 409,
  invalid_credentials: 409,
  profile_private: 409,
  rate_limited: 503,
  not_found: 404,
  unreachable: 502,
  invalid_response: 502,
};

/**
 * Turns every thrown error into `{ error, message? }`.
 * Unexpected errors are logged but never echoed, so nothing sensitive can leak to the client.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof SourceError) {
      return reply
        .code(SOURCE_ERROR_STATUS[error.code])
        .send({ error: `source_${error.code}`, message: error.message });
    }
    const fastifyError = error as { statusCode?: number; code?: string };
    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
      return reply
        .code(fastifyError.statusCode)
        .send({ error: fastifyError.statusCode === 413 ? 'payload_too_large' : 'invalid_request' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal_error' });
  });
}
