import type { HintKind, HintLevel } from '@gamebacklog/shared';
import { z } from 'zod';
import { languageRule } from './language.ts';

export const HINT_PROMPT_VERSION = 'hint.v3';

export const hintSchema = z.object({
  hint: z.string().trim().min(1).max(4000),
  /** Where the hint comes from: the numbered sources, or what the model knows of the game. */
  basis: z.enum(['sources', 'knowledge']).default('sources'),
  /** Numbers of the sources the hint is based on. */
  sources: z.array(z.number().int().min(1)).max(10).default([]),
});

/** What each rung of the ladder may reveal. The model must not say more than its level allows. */
const LEVEL_RULES: Record<HintLevel, string> = {
  1: "Level 1, a nudge: one or two sentences that point the player's attention in the right direction without naming the solution, the item or the exact place. Reveal nothing about the story.",
  2: 'Level 2, a direction: say where to look or what kind of thing to try, still without the exact steps. No story reveals.',
  3: 'Level 3, a specific hint: name the item, mechanic or spot involved and the key idea, but leave the execution to the player.',
  4: 'Level 4, the full solution: clear numbered steps from the current situation to the goal.',
};

const KIND_RULES: Record<HintKind, string> = {
  general: 'The player is stuck on how to progress.',
  puzzle:
    'The player is stuck on a puzzle. Work out which puzzle it is from where they are and what they wrote (for example, "the first room of chapter X" is the first puzzle of that chapter in this game). Protect the "aha" moment: prefer a question or an observation over an instruction whenever the level allows.',
  boss: 'The player is stuck on a boss. Useful help is strategy: attack patterns to watch for, weaknesses, and recommended preparation.',
};

export interface HintGame {
  title: string;
  releaseYear: number | null;
  /** Other names, such as "Resident Evil 4 Remake": they tell versions apart. */
  alternativeTitles: string[];
  /** Platform the player uses, when known. */
  platform: string | null;
}

export function buildHintPrompt(input: {
  game: HintGame;
  checkpoint: string | null;
  /** Other names of the place, from the game's route. */
  checkpointAliases: string[];
  bossName: string | null;
  kind: HintKind;
  level: HintLevel;
  stuckOn: string | null;
  /** Lower rungs already shown to the player, so this one goes a step further. */
  previous: { level: HintLevel; text: string }[];
  locale: string;
  sources: string;
}): { system: string; prompt: string } {
  const { game } = input;
  return {
    system: [
      'You give spoiler-safe hints for video games, on a ladder of four levels.',
      KIND_RULES[input.kind],
      LEVEL_RULES[input.level],
      'The game block identifies the exact game and version the player has open (release year, other names, platform). Never ask which version, edition or remake they play.',
      'Use the numbered sources first; ignore any source that is about something else with a similar name.',
      'When the sources do not cover the situation, answer from well-established knowledge of this game, which is the normal case for well-known games. Never invent rooms, items, mechanics or steps you are not sure exist in this game.',
      'Only if you truly do not recognise the situation, say so in one short sentence and still give the most useful advice you can for that part of the game; do not ask the player for anything the prompt already tells you.',
      'Set "basis" to "sources" when the hint rests on the sources and to "knowledge" when it rests on what you know of the game.',
      input.previous.length > 0
        ? 'The player has already read the lower levels listed below: go one step further than them, without repeating them.'
        : null,
      'Never mention anything that happens later in the game than where the player is.',
      'Address the player directly.',
      'In "sources", list the numbers of the sources you actually used (none when the basis is knowledge).',
      languageRule(input.locale, 'the hint'),
    ]
      .filter(Boolean)
      .join(' '),
    prompt: [
      [
        `Game: ${game.title}${game.releaseYear ? ` (${game.releaseYear})` : ''}`,
        game.alternativeTitles.length > 0
          ? `Also known as: ${game.alternativeTitles.slice(0, 6).join(', ')}`
          : null,
        game.platform ? `Platform: ${game.platform}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      `Where the player is: ${input.checkpoint ?? 'unknown'}${
        input.checkpointAliases.length > 0
          ? ` (also called ${input.checkpointAliases.join(', ')})`
          : ''
      }`,
      input.kind === 'boss' && input.bossName ? `Boss: ${input.bossName}` : null,
      `What they are stuck on: ${input.stuckOn ?? 'not specified'}`,
      input.previous.length > 0
        ? `Already shown:\n${input.previous.map((item) => `Level ${item.level}: ${item.text}`).join('\n')}`
        : null,
      `Sources:\n${input.sources || '(none found)'}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
