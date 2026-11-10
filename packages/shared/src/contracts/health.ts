import { z } from 'zod';

/** Response of `GET /api/health`. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  app: z.string(),
  version: z.string(),
  schemaVersion: z.number().int().positive(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
