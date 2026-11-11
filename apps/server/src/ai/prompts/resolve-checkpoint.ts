import { z } from 'zod';

export const RESOLVE_CHECKPOINT_PROMPT_VERSION = 'resolve-checkpoint.v1';

export const resolveCheckpointSchema = z.object({
  /** 1-based number of the checkpoint in the list, or null when none fits. */
  checkpoint: z.number().int().min(1).nullable(),
  /** The place name as the player wrote it, to recognise it without AI next time. */
  alias: z.string().trim().min(1).max(120).nullable().default(null),
});

export function buildResolveCheckpointPrompt(input: {
  title: string;
  checkpoints: { name: string; aliases: string[] }[];
  text: string;
}): { system: string; prompt: string } {
  return {
    system: [
      'A player describes, in their own words and possibly in another language, where they are',
      'in a video game. Pick the checkpoint from the list that matches.',
      'Answer with its number, or null when you cannot tell. Never pick by guessing.',
      '"alias" is the place name exactly as the player wrote it, or null.',
    ].join(' '),
    prompt: [
      `Game: ${input.title}`,
      `Checkpoints:\n${input.checkpoints
        .map(
          (checkpoint, index) =>
            `${index + 1}. ${checkpoint.name}${checkpoint.aliases.length > 0 ? ` (also: ${checkpoint.aliases.join(', ')})` : ''}`,
        )
        .join('\n')}`,
      `The player wrote: "${input.text}"`,
    ].join('\n\n'),
  };
}
