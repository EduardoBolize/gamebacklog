import type {
  LibraryStatus,
  RecommendationReason,
  TasteDimension,
  TasteFeature,
} from '@gamebacklog/shared';

/**
 * The taste profile: what the library says the user likes, computed locally with no AI.
 *
 * Every game the user has an opinion on gets a weight (loved, liked, neutral, disliked) from
 * its review score and its status. Each genre, theme, franchise, platform and mechanic then
 * gets the average weight of the games carrying it, pulled towards zero while there are few of
 * them. A candidate game is scored by how its own features sit in that profile.
 */

export interface GameFeatures {
  genres: string[];
  themes: string[];
  /** Mechanics / keywords of the game, not the user's own tags. */
  tags: string[];
  franchise: string | null;
  /** Platforms the game exists on. */
  platforms: string[];
}

/** A library entry as the profile sees it. */
export interface TasteSignal extends GameFeatures {
  entryId: string;
  title: string;
  status: LibraryStatus;
  isFavorite: boolean;
  /** Review score, 0–10, or null when not rated. */
  score: number | null;
  /** Platform the user plays it on. */
  platform: string | null;
}

interface Contribution {
  entryId: string;
  title: string;
  weight: number;
}

interface FeatureStat {
  dimension: TasteDimension;
  value: string;
  contributions: Contribution[];
}

export interface TasteProfile {
  features: Map<string, FeatureStat>;
  ratedGames: number;
  signalGames: number;
}

/** A score of 6 says nothing either way; 10 is a full "loved it". */
const NEUTRAL_SCORE = 6;
const MAX_WEIGHT = 1.5;
/**
 * Pseudo-games with weight zero added to every average, so that one loved game does not make
 * its genre look as safe a bet as ten liked ones.
 */
const PRIOR_GAMES = 1.5;
const FAVORITE_BONUS = 0.25;

/** How much the status says, for rated games (`factor`) and unrated ones (`unrated`). */
const STATUS_SIGNAL: Partial<Record<LibraryStatus, { factor: number; unrated: number }>> = {
  completed_100: { factor: 1.25, unrated: 0.7 },
  completed: { factor: 1, unrated: 0.5 },
  playing: { factor: 0.7, unrated: 0.3 },
  paused: { factor: 0.6, unrated: 0.1 },
};
const DROPPED_UNRATED = -0.6;
/** Dropping a game counts against it even when the score given was kind. */
const DROPPED_PENALTY = 0.7;

/** Share of the final score each dimension decides. */
export const DIMENSION_WEIGHTS: Record<TasteDimension, number> = {
  genre: 0.35,
  tag: 0.25,
  theme: 0.15,
  franchise: 0.15,
  platform: 0.1,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const featureKey = (dimension: TasteDimension, value: string) =>
  `${dimension}:${value.trim().toLowerCase()}`;

/**
 * What one library entry says about taste, from -1.5 to 1.5, or null when it says nothing
 * (backlog and wishlist games have not been played).
 */
export function entryWeight(
  entry: Pick<TasteSignal, 'status' | 'score' | 'isFavorite'>,
): number | null {
  const rating = entry.score === null ? null : (entry.score - NEUTRAL_SCORE) / (10 - NEUTRAL_SCORE);

  let weight: number;
  if (entry.status === 'dropped') {
    weight = rating === null ? DROPPED_UNRATED : Math.min(-0.1, rating - DROPPED_PENALTY);
  } else {
    const signal = STATUS_SIGNAL[entry.status];
    if (!signal) return null;
    if (rating === null) weight = signal.unrated;
    // Finishing a game makes a good score count for more; it does not make a bad one worse.
    else weight = rating > 0 ? rating * signal.factor : rating;
  }
  if (entry.isFavorite && weight > 0) weight += FAVORITE_BONUS;
  return clamp(weight, -MAX_WEIGHT, MAX_WEIGHT);
}

function featuresOf(game: GameFeatures & { platform?: string | null }): [TasteDimension, string][] {
  const pairs: [TasteDimension, string][] = [
    ...game.genres.map((value): [TasteDimension, string] => ['genre', value]),
    ...game.themes.map((value): [TasteDimension, string] => ['theme', value]),
    ...game.tags.map((value): [TasteDimension, string] => ['tag', value]),
  ];
  if (game.franchise) pairs.push(['franchise', game.franchise]);
  return pairs;
}

export function buildTasteProfile(signals: TasteSignal[]): TasteProfile {
  const features = new Map<string, FeatureStat>();
  let ratedGames = 0;
  let signalGames = 0;

  // Sorted so that ties between equally weighted games always resolve the same way.
  for (const signal of [...signals].sort((a, b) => a.entryId.localeCompare(b.entryId))) {
    if (signal.score !== null) ratedGames++;
    const weight = entryWeight(signal);
    if (weight === null) continue;
    signalGames++;

    const pairs = featuresOf(signal);
    // Only the platform the user actually played on says something about platforms.
    if (signal.platform) pairs.push(['platform', signal.platform]);
    const seen = new Set<string>();
    for (const [dimension, value] of pairs) {
      const key = featureKey(dimension, value);
      if (!value.trim() || seen.has(key)) continue;
      seen.add(key);
      const stat = features.get(key) ?? { dimension, value: value.trim(), contributions: [] };
      stat.contributions.push({ entryId: signal.entryId, title: signal.title, weight });
      features.set(key, stat);
    }
  }
  return { features, ratedGames, signalGames };
}

/** Average weight of the games carrying a feature, shrunk towards zero. Null when unknown. */
function affinityOf(stat: FeatureStat | undefined, excludeEntryId?: string): number | null {
  if (!stat) return null;
  const used = excludeEntryId
    ? stat.contributions.filter((item) => item.entryId !== excludeEntryId)
    : stat.contributions;
  if (used.length === 0) return null;
  return used.reduce((sum, item) => sum + item.weight, 0) / (used.length + PRIOR_GAMES);
}

/** The games behind an affinity, strongest first, on the same side as the affinity itself. */
function becauseOf(stat: FeatureStat, affinity: number, excludeEntryId?: string): string[] {
  const direction = affinity >= 0 ? 1 : -1;
  return stat.contributions
    .filter((item) => item.entryId !== excludeEntryId && item.weight * direction > 0)
    .sort((a, b) => (b.weight - a.weight) * direction || a.title.localeCompare(b.title))
    .slice(0, 3)
    .map((item) => item.title);
}

export interface GameScore {
  /** -1 (everything the user avoids) to 1 (everything the user loves). */
  score: number;
  /** 0–100, with 50 as neutral. */
  affinity: number;
  reasons: RecommendationReason[];
}

const MAX_POSITIVE_REASONS = 3;
const MIN_REASON_WEIGHT = 0.08;

/**
 * Scores a game against the profile.
 *
 * Per dimension, the score is the average affinity of the features the profile knows, scaled
 * down by how much of the game it does not know (a game with thirty keywords of which two are
 * known is weaker evidence than one with two genres, both known). `excludeEntryId` leaves a
 * library game's own vote out, so a game is never recommended for resembling itself.
 */
export function scoreGame(
  profile: TasteProfile,
  game: GameFeatures & { platform?: string | null },
  options: { excludeEntryId?: string } = {},
): GameScore {
  const { excludeEntryId } = options;
  const known: { dimension: TasteDimension; stat: FeatureStat; affinity: number }[] = [];
  const perDimension = new Map<TasteDimension, { total: number; sum: number; known: number }>();

  for (const [dimension, value] of featuresOf(game)) {
    const bucket = perDimension.get(dimension) ?? { total: 0, sum: 0, known: 0 };
    bucket.total++;
    const stat = profile.features.get(featureKey(dimension, value));
    const affinity = affinityOf(stat, excludeEntryId);
    if (stat && affinity !== null) {
      bucket.sum += affinity;
      bucket.known++;
      known.push({ dimension, stat, affinity });
    }
    perDimension.set(dimension, bucket);
  }

  let score = 0;
  for (const [dimension, bucket] of perDimension) {
    if (bucket.known === 0) continue;
    const coverage = Math.sqrt(bucket.known / bucket.total);
    score += DIMENSION_WEIGHTS[dimension] * (bucket.sum / bucket.known) * coverage;
  }

  // Platform: can it be played somewhere the user enjoys playing?
  let bestPlatform: (typeof known)[number] | null = null;
  for (const value of game.platform ? [game.platform] : game.platforms) {
    const stat = profile.features.get(featureKey('platform', value));
    const affinity = affinityOf(stat, excludeEntryId);
    if (stat && affinity !== null && (!bestPlatform || affinity > bestPlatform.affinity)) {
      bestPlatform = { dimension: 'platform', stat, affinity };
    }
  }
  if (bestPlatform) {
    score += DIMENSION_WEIGHTS.platform * bestPlatform.affinity;
    known.push(bestPlatform);
  }

  const ranked = known
    .filter((item) => Math.abs(item.affinity) >= MIN_REASON_WEIGHT)
    .map((item) => ({ ...item, pull: DIMENSION_WEIGHTS[item.dimension] * item.affinity }))
    .sort(
      (a, b) => Math.abs(b.pull) - Math.abs(a.pull) || a.stat.value.localeCompare(b.stat.value),
    );
  const chosen = [
    ...ranked.filter((item) => item.pull > 0).slice(0, MAX_POSITIVE_REASONS),
    ...ranked.filter((item) => item.pull < 0).slice(0, 1),
  ];

  const bounded = clamp(score, -1, 1);
  return {
    score: bounded,
    affinity: Math.round(50 + 50 * bounded),
    reasons: chosen.map((item) => ({
      dimension: item.dimension,
      value: item.stat.value,
      weight: Math.round(item.affinity * 100) / 100,
      because: becauseOf(item.stat, item.affinity, excludeEntryId),
    })),
  };
}

/** The strongest likes and dislikes of one dimension, for showing the profile to the user. */
export function topFeatures(
  profile: TasteProfile,
  dimension: TasteDimension,
  limits: { liked: number; disliked: number },
): { liked: TasteFeature[]; disliked: TasteFeature[] } {
  const all = [...profile.features.values()]
    .filter((stat) => stat.dimension === dimension)
    .map((stat) => {
      const weight = affinityOf(stat) ?? 0;
      return {
        value: stat.value,
        weight: Math.round(weight * 100) / 100,
        games: stat.contributions.length,
        because: becauseOf(stat, weight),
      };
    });
  const byValue = (a: TasteFeature, b: TasteFeature) => a.value.localeCompare(b.value);
  return {
    liked: all
      .filter((feature) => feature.weight >= MIN_REASON_WEIGHT)
      .sort((a, b) => b.weight - a.weight || byValue(a, b))
      .slice(0, limits.liked),
    disliked: all
      .filter((feature) => feature.weight <= -MIN_REASON_WEIGHT)
      .sort((a, b) => a.weight - b.weight || byValue(a, b))
      .slice(0, limits.disliked),
  };
}
