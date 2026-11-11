import { z } from 'zod';
import { languageRule } from './language.ts';

export const FUNNEL_ESTIMATE_PROMPT_VERSION = 'funnel-estimate.v2';

export const funnelEstimateSchema = z.object({
  /** Share of players who start the game and finish the main story, 0–100. */
  percentFinished: z.number().min(0).max(100),
  /** One or two sentences on what the estimate is based on. */
  rationale: z.string().trim().min(1).max(600),
});

export function buildFunnelEstimatePrompt(input: {
  title: string;
  releaseYear: number | null;
  genres: string[];
  mainHours: number | null;
  locale: string;
  sources: string;
}): { system: string; prompt: string } {
  return {
    system: [
      'There is no achievement data for this game, so you estimate what share of the players',
      'who start it finish the main story.',
      "Prefer figures stated in the sources. Without them, reason from the game's length and",
      'genre against typical completion rates, and say that this is what you did.',
      'This is an estimate and will be shown as one: give a single number, not a range.',
      languageRule(input.locale, 'the rationale'),
    ].join(' '),
    prompt: [
      `Game: ${input.title}${input.releaseYear ? ` (${input.releaseYear})` : ''}`,
      `Genres: ${input.genres.join(', ') || 'unknown'}`,
      `Main story length: ${input.mainHours === null ? 'unknown' : `${input.mainHours} hours`}`,
      `Sources:\n${input.sources || '(none found)'}`,
    ].join('\n\n'),
  };
}
