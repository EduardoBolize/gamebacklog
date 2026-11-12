import { PATH_WARNING_KINDS } from '@gamebacklog/shared';
import { z } from 'zod';
import { languageRule } from './language.ts';

/** Bump when the wording or the schema changes: cached answers from older versions are ignored. */
export const NEXT_PATHS_PROMPT_VERSION = 'next-paths.v1';

const warningSchema = z.object({
  kind: z.enum(PATH_WARNING_KINDS).catch('other'),
  /** Achievement, item or character, as the game names it. */
  name: z.string().trim().min(1).max(160),
  /** Why it matters, in one or two short sentences. */
  detail: z.string().trim().min(1).max(500),
  /** Number of the achievement in the list, when the warning is about one. */
  achievement: z.number().int().min(1).nullable().default(null),
});

export const nextPathsSchema = z.object({
  /** What to do in the current area before leaving it, because it can be lost. */
  beforeLeaving: z.array(warningSchema).max(12).default([]),
  paths: z
    .array(
      z.object({
        /** Number of the option in the list. */
        option: z.number().int().min(1),
        /** How to get there from the current area, in one or two sentences. */
        howToGetThere: z.string().trim().max(500).nullable().default(null),
        warnings: z.array(warningSchema).max(12).default([]),
      }),
    )
    .max(12)
    .default([]),
});
export type NextPathsOutput = z.infer<typeof nextPathsSchema>;

export function buildNextPathsPrompt(input: {
  title: string;
  locale: string;
  current: string;
  completed: string[];
  options: { name: string; requirement: string | null }[];
  achievements: { name: string; description: string | null }[];
  sources: string;
}): { system: string; prompt: string } {
  return {
    system: [
      'You help a player choose where to go next in a video game without losing anything for',
      'good. You get the area they are in, the areas they can go to next, the achievements',
      'they have not unlocked yet, and numbered sources from the game wiki.',
      'For each option, say briefly how to get there from the current area and list warnings:',
      'achievements, items, characters (NPC quests) or events that are lost for good, or',
      'become much harder, by going there now or by going there before something else.',
      '"beforeLeaving" lists what in the current area should be done or picked up before',
      'moving on because it can be missed.',
      'Use the sources and well-established knowledge of the game; when you are not sure a',
      'thing can be missed, leave it out. Prefer few, precise warnings over many vague ones.',
      'When a warning is about an achievement from the list, set "achievement" to its number.',
      'Do not reveal plot twists or story events beyond what the warning needs.',
      languageRule(input.locale, '"howToGetThere" and every "detail"'),
    ].join(' '),
    prompt: [
      `Game: ${input.title}`,
      `The player is at: ${input.current}`,
      input.completed.length > 0
        ? `Areas already finished: ${input.completed.join(', ')}`
        : 'No areas marked as finished.',
      input.options.length > 0
        ? `Options for where to go next:\n${input.options
            .map(
              (option, index) =>
                `${index + 1}. ${option.name}${option.requirement ? ` (needs: ${option.requirement})` : ''}`,
            )
            .join('\n')}`
        : 'No further areas are listed; only check what to do before leaving.',
      input.achievements.length > 0
        ? `Achievements not unlocked yet:\n${input.achievements
            .map(
              (achievement, index) =>
                `${index + 1}. ${achievement.name}${achievement.description ? ` — ${achievement.description}` : ''}`,
            )
            .join('\n')}`
        : 'No achievement data for this game.',
      `Sources:\n${input.sources || '(none found)'}`,
    ].join('\n\n'),
  };
}
