import { z } from 'zod';

export const RESOLVE_CHECKPOINT_PROMPT_VERSION = 'resolve-checkpoint.v2';

export const resolveCheckpointSchema = z.object({
  /** 1-based number of the checkpoint the player is at now, or null when none fits. */
  checkpoint: z.number().int().min(1).nullable(),
  /** Numbers of the checkpoints the player says they already finished. */
  completed: z.array(z.number().int().min(1)).max(40).default([]),
  /** The current place's name as the player wrote it, to recognise it without AI next time. */
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
      'in a video game, and sometimes which places they already finished',
      '("I beat X and Y, now I am at Z"). Match what they wrote to the numbered checkpoints.',
      '"checkpoint" is the number of the place they are at now, or null when you cannot tell.',
      '"completed" lists the numbers of the places they say they finished; empty when none.',
      'Never pick by guessing: a place must be named or clearly described.',
      '"alias" is the name of the current place exactly as the player wrote it, or null.',
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
