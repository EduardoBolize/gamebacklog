import { z } from 'zod';
import { dataOriginSchema } from './enums.ts';

/** Where a piece of displayed data came from. The UI shows this discreetly next to the data. */
export const provenanceSchema = z.object({
  origin: dataOriginSchema,
  url: z.url().optional(),
  fetchedAt: z.iso.datetime().optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;
