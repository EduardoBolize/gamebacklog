/**
 * Deterministic guesses about what an achievement means, used when there is no AI and until the
 * user corrects them. Works on the English names and descriptions that Steam returns.
 */

/** Words that usually mark a step of the main story. */
const STORY_WORDS =
  /\b(chapter|act|episode|prologue|epilogue|finale|ending|credits|story|campaign|mission|complete[ds]?|finish(?:ed|es)?|defeat(?:ed|s)?|beat|vanquish(?:ed)?|slay|slain|escape[ds]?)\b/i;

/**
 * Words that point to a challenge, a grind or a collection instead: "defeat 100 enemies",
 * "complete all side quests", "finish the game on hard".
 */
const NOT_STORY_WORDS =
  /\b(all|every|each|\d{2,}|collect\w*|without|no damage|deathless|speedrun|difficulty|hard(?:est)?|nightmare|hardcore|max(?:imum)?|upgrade\w*|co-?op|multiplayer|online|times|side ?quests?|optional|secret)\b/i;

const NG_PLUS_WORDS = /new game\s*(\+|plus)|\bng\s*\+|second playthrough|second journey/i;

export interface AchievementText {
  name: string;
  description: string | null;
}

const fullText = (achievement: AchievementText) =>
  `${achievement.name} ${achievement.description ?? ''}`;

export function looksLikeStory(achievement: AchievementText): boolean {
  const text = fullText(achievement);
  return STORY_WORDS.test(text) && !NOT_STORY_WORDS.test(text);
}

export function looksLikeNewGamePlus(achievement: AchievementText): boolean {
  return NG_PLUS_WORDS.test(fullText(achievement));
}
