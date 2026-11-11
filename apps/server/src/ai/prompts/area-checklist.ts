import { z } from 'zod';
import { languageRule } from './language.ts';

export const AREA_CHECKLIST_PROMPT_VERSION = 'area-checklist.v2';

export const areaChecklistSchema = z.object({
  collectibles: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        /** Where to find it, kept short. */
        description: z.string().trim().max(400).nullable().default(null),
        /** Kind of item, e.g. "Heart Piece". */
        category: z.string().trim().max(80).nullable().default(null),
        isMissable: z.boolean().default(false),
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
  return {
    system: [
      'You prepare a completionist checklist for one area of a video game.',
      'List the collectibles, optional items and secrets found in that area, using only the',
      'numbered sources. Do not list anything from other areas, and invent nothing.',
      'Each "description" says where the item is in one short sentence.',
      '"isMissable" is true only when the sources say the item can be lost for good.',
      'From the achievement list, return in "missableAchievements" the numbers of those the',
      'sources say can be permanently missed in or before this area. When unsure, leave it out.',
      'If the sources say nothing about this area, return empty lists.',
      languageRule(input.locale, 'each "description" and "category"'),
      'Each "name" is the name of the item as the game writes it, with a short note in',
      'parentheses only when needed to tell two items apart.',
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
        : 'No achievements are known for this game.',
      `Sources:\n${input.sources || '(none found)'}`,
    ].join('\n\n'),
  };
}
