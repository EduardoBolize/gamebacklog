import { z } from 'zod';
import { languageName, languageRule } from './language.ts';

export const AREA_CHECKLIST_PROMPT_VERSION = 'area-checklist.v3';

export const areaChecklistSchema = z.object({
  collectibles: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        /** The name exactly as the English sources write it; the same in every language. */
        sourceName: z.string().trim().min(1).max(160).nullable().default(null),
        /** Where to find it, kept short. */
        description: z.string().trim().max(400).nullable().default(null),
        /** Kind of item, e.g. "Heart Piece". */
        category: z.string().trim().max(80).nullable().default(null),
        isMissable: z.boolean().default(false),
        /** Number of the listed achievement the item counts towards, when it is listed. */
        achievement: z.number().int().min(1).nullable().default(null),
        /** Name of the achievement or trophy it counts towards, as the game names it. */
        achievementName: z.string().trim().min(1).max(160).nullable().default(null),
      }),
    )
    .max(80),
  /** Numbers of the listed achievements that can be lost for good in or around this area. */
  missableAchievements: z.array(z.number().int().min(1)).max(50).default([]),
});

export function buildAreaChecklistPrompt(input: {
  title: string;
  checkpoint: string;
  achievements: { name: string; description: string | null }[];
  locale: string;
  sources: string;
}): { system: string; prompt: string } {
  const language = languageName(input.locale);
  return {
    system: [
      'You prepare a completionist checklist for one area of a video game.',
      'List what is worth getting in that area: collectibles, optional items, secrets,',
      'optional bosses and optional fights, using the numbered sources. Do not list anything',
      'from other areas, and invent nothing.',
      'Each "description" says where the item is in one short sentence.',
      '"isMissable" is true only when the sources say the item can be lost for good.',
      'For each item, decide whether it counts towards an achievement or trophy, directly or',
      'as part of a "collect all" or "defeat all" achievement. When it does, set',
      '"achievementName" to that achievement as the game names it, and "achievement" to its',
      'number when it is in the achievement list. Use the sources and well-established',
      'knowledge of the game; when you are not sure, leave both null. Currency, crafting',
      'materials and consumables that no achievement counts get null.',
      'From the achievement list, return in "missableAchievements" the numbers of those the',
      'sources say can be permanently missed in or before this area. When unsure, leave it out.',
      'If the sources say nothing about this area, return empty lists.',
      languageRule(input.locale, 'each "description" and "category"'),
      `"name" keeps the item's proper name exactly as the game writes it, but every other word`,
      `in it is in ${language}: generic words (pile, chest, optional fight) and the short note`,
      'in parentheses that tells two items with the same name apart.',
      '"sourceName" is the same item named exactly as the English sources write it, with the',
      'note in parentheses in English: it must not depend on the language of the answer.',
    ].join(' '),
    prompt: [
      `Game: ${input.title}`,
      `Area: ${input.checkpoint}`,
      input.achievements.length > 0
        ? `Achievements:\n${input.achievements
            .map(
              (achievement, index) =>
                `${index + 1}. ${achievement.name}${achievement.description ? ` — ${achievement.description}` : ''}`,
            )
            .join('\n')}`
        : 'No achievement list is stored for this game; name achievements from what you know.',
      `Sources:\n${input.sources || '(none found)'}`,
    ].join('\n\n'),
  };
}
