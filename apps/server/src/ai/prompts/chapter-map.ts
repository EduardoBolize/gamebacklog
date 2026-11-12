import { z } from 'zod';
import { languageName } from './language.ts';

/** Bump when the wording or the schema changes: cached maps from older versions are ignored. */
export const CHAPTER_MAP_PROMPT_VERSION = 'chapter-map.v3';

export const chapterMapSchema = z.object({
  checkpoints: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        aliases: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
        isPointOfNoReturn: z.boolean().default(false),
        bossName: z.string().trim().min(1).max(120).nullable().default(null),
        /** 1-based numbers of the checkpoints reachable straight from this one. */
        leadsTo: z.array(z.number().int().min(1)).max(12).default([]),
        requirement: z.string().trim().min(1).max(120).nullable().default(null),
      }),
    )
    .min(1)
    .max(80),
});
export type ChapterMapOutput = z.infer<typeof chapterMapSchema>;

export function buildChapterMapPrompt(input: {
  title: string;
  locale: string;
  storyAchievements: string[];
  sources: string;
}): { system: string; prompt: string } {
  const language = languageName(input.locale);
  return {
    system: [
      'You organize the places of a video game (chapters, areas, levels or dungeons) into a',
      'list for a progress tracker, in the order a typical first playthrough meets them.',
      'Use the source material first. When it does not list the places, complete the list',
      'from well-established knowledge of the game, with the official place names; never',
      'invent a place, and leave out anything you are not sure exists.',
      'Cover the whole game, optional areas and DLC areas included.',
      'Names must be the short official English names of the places, as the sources write them.',
      '"aliases" are other names for the same place, so a player can be understood when they',
      'write in their own words: short forms players use (a single distinctive word such as',
      'a character or landmark the place is named after) and common nicknames.',
      ...(input.locale === 'en'
        ? []
        : [
            `The player writes in ${language}, so every place must also have at least one alias`,
            `in ${language}: its official name in that language when the game was localized,`,
            'otherwise the natural translation players use (for example "Lost Bastille" →',
            '"Bastilha Perdida").',
          ]),
      'Games with open structure branch: "leadsTo" lists the numbers of the checkpoints that',
      'can be reached directly from this one, including optional areas. Leave it empty when',
      'the way on is simply the next checkpoint in the list.',
      '"requirement" is the item, key, ability or event that opens the way INTO this',
      'checkpoint, named as the game names it, or null when nothing special is needed.',
      '"isPointOfNoReturn" is true only when the sources say that after this point earlier',
      'content can no longer be reached.',
      '"bossName" is the main boss fought there, or null.',
      'Write no plot details: names only.',
    ].join(' '),
    prompt: [
      `Game: ${input.title}`,
      input.storyAchievements.length > 0
        ? `Story achievements, from most to least common (earlier ones come first in the game):\n${input.storyAchievements.map((name) => `- ${name}`).join('\n')}`
        : 'No story achievements are known for this game.',
      `Source material:\n${input.sources || '(none found)'}`,
    ].join('\n\n'),
  };
}
