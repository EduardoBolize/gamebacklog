import { z } from 'zod';

export const RECOMMENDATION_REASONS_PROMPT_VERSION = 'recommendation-reasons.v2';

export const recommendationReasonsSchema = z.object({
  lines: z
    .array(
      z.object({
        /** Number of the game in the list that was sent, starting at 1. */
        game: z.number().int().min(1),
        line: z.string().trim().min(1).max(240),
      }),
    )
    .max(40),
});
export type RecommendationReasons = z.infer<typeof recommendationReasonsSchema>;

/** What the app already knows about one recommendation. The AI only puts it into words. */
export interface RecommendationFacts {
  title: string;
  genres: string[];
  /** Why it fits the profile: a feature the library favours, and the games behind that. */
  likes: { value: string; because: string[] }[];
  dislikes: string[];
  /** Shared with the reference game, in the "similar" lists. */
  shared: string[];
  status: string | null;
  playedPercent: number | null;
}

const LANGUAGE: Record<string, string> = { 'pt-BR': 'Brazilian Portuguese', en: 'English' };

const CONTEXT: Record<string, string> = {
  play_next: "These games are in the player's backlog, or were paused or dropped.",
  similar: 'These games were picked for being similar to the reference game.',
  completion:
    'These games were picked because completing them 100% is a similar effort to the reference game.',
  genre: "These games belong to the player's favourite genre.",
};

export function buildRecommendationReasonsPrompt(input: {
  list: string;
  /** Title of the reference game, or the genre, when the list has one. */
  reference: string | null;
  locale: string;
  games: RecommendationFacts[];
}): { system: string; prompt: string } {
  const describe = (game: RecommendationFacts, index: number) =>
    [
      `${index + 1}. ${game.title}`,
      game.genres.length ? `   genres: ${game.genres.join(', ')}` : null,
      ...game.likes.map(
        (like) =>
          `   their library favours "${like.value}"${like.because.length ? ` (from ${like.because.join(', ')})` : ''}`,
      ),
      game.dislikes.length ? `   their library counts against: ${game.dislikes.join(', ')}` : null,
      game.shared.length ? `   shared with the reference: ${game.shared.join(', ')}` : null,
      game.status ? `   status in the library: ${game.status}` : null,
      game.playedPercent !== null
        ? `   about ${game.playedPercent}% of the main story already played`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

  return {
    system: [
      'You write one short line per game telling a player why that game was recommended to them.',
      'Use only the facts given for each game. Do not add facts about the games, do not mention',
      'plot, and do not invent opinions the player never expressed.',
      'One sentence per game, at most 25 words, speaking to the player directly.',
      'Name the games from their library that are given as the reason. Those are games they',
      'have played, finished or rated well; do not claim more about them than that.',
      `Write in ${LANGUAGE[input.locale] ?? 'English'}.`,
      'Answer for every game in the list, using its number.',
    ].join(' '),
    prompt: [
      CONTEXT[input.list] ?? '',
      input.reference ? `Reference: ${input.reference}` : null,
      `Games:\n${input.games.map(describe).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
