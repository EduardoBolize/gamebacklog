/**
 * The language every AI answer is written in: the one the interface is in. The sources are
 * almost always in English, so the rule has to say so explicitly or the model follows them.
 */

const LANGUAGE: Record<string, string> = { 'pt-BR': 'Brazilian Portuguese', en: 'English' };

export const languageName = (locale: string) => LANGUAGE[locale] ?? 'English';

/**
 * One instruction for the system prompt. `what` names the text it applies to, e.g. "the hint".
 * Proper names stay as the game writes them, so the player can match them to what is on screen.
 */
export function languageRule(locale: string, what: string): string {
  return [
    `Write ${what} in ${languageName(locale)}, whatever language the sources are in.`,
    'Keep proper names (places, items, characters, bosses, achievements) exactly as they',
    'appear in the sources; do not translate them.',
  ].join(' ');
}
