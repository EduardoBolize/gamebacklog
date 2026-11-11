import { z } from 'zod';

/** Bump when the wording or the schema changes: cached maps from older versions are ignored. */
export const CHAPTER_MAP_PROMPT_VERSION = 'chapter-map.v1';

export const chapterMapSchema = z.object({
  checkpoints: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        aliases: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
        isPointOfNoReturn: z.boolean().default(false),
        bossName: z.string().trim().min(1).max(120).nullable().default(null),
      }),
    )
    .min(1)
    .max(80),
});
export type ChapterMapOutput = z.infer<typeof chapterMapSchema>;

export function buildChapterMapPrompt(input: {
  title: string;
  storyAchievements: string[];
  sources: string;
}): { system: string; prompt: string } {
  return {
    system: [
      'You organize the main path of a video game into an ordered list of checkpoints',
      '(chapters, areas or dungeons) for a progress tracker.',
      'Use only the source material given. Do not invent places; when the sources are thin,',
      'return fewer checkpoints rather than guessing.',
      'Names must be the short official names of the places, in play order.',
      '"aliases" are other names players use for the same place.',
      '"isPointOfNoReturn" is true only when the sources say that after this point earlier',
      'content can no longer be reached.',
      '"bossName" is the boss fought there, or null.',
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
