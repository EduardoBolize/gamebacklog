import type { HintKind, HintLevel } from '@gamebacklog/shared';
import { z } from 'zod';
import { languageRule } from './language.ts';

export const HINT_PROMPT_VERSION = 'hint.v2';

export const hintSchema = z.object({
  hint: z.string().trim().min(1).max(4000),
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
    'The player is stuck on a puzzle. Protect the "aha" moment: prefer a question or an observation over an instruction whenever the level allows.',
  boss: 'The player is stuck on a boss. Useful help is strategy: attack patterns to watch for, weaknesses, and recommended preparation.',
};

export function buildHintPrompt(input: {
  title: string;
  checkpoint: string | null;
  bossName: string | null;
  kind: HintKind;
  level: HintLevel;
  stuckOn: string | null;
  locale: string;
  sources: string;
}): { system: string; prompt: string } {
  return {
    system: [
      'You give spoiler-safe hints for video games, on a ladder of four levels.',
      KIND_RULES[input.kind],
      LEVEL_RULES[input.level],
      'Base the hint only on the numbered sources. If they do not cover the situation, say so plainly instead of guessing.',
      'Never mention anything that happens later in the game than where the player is.',
      'Address the player directly.',
      'In "sources", list the numbers of the sources you actually used.',
      languageRule(input.locale, 'the hint'),
    ].join(' '),
    prompt: [
      `Game: ${input.title}`,
      `Where the player is: ${input.checkpoint ?? 'unknown'}`,
      input.kind === 'boss' && input.bossName ? `Boss: ${input.bossName}` : null,
      `What they are stuck on: ${input.stuckOn ?? 'not specified'}`,
      `Sources:\n${input.sources || '(none found)'}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
