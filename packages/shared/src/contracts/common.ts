import { z } from 'zod';

/** ISO 8601 instant, e.g. `2026-11-10T14:25:07.000Z`. */
export const isoDateTimeSchema = z.iso.datetime();

/** Calendar date, `YYYY-MM-DD`. */
export const isoDateSchema = z.iso.date();

/** Score from 0 to 10 in half-point steps. */
export const scoreSchema = z
  .number()
  .min(0)
  .max(10)
  .refine((value) => Number.isInteger(value * 2), 'Score must be a multiple of 0.5');

export const minutesSchema = z.number().int().min(0);

/** Shape of every error response from the API. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;
