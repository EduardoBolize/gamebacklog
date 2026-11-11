import type { AchievementShape } from '@gamebacklog/shared';
import type { GameFeatures } from './profile.ts';

/** How alike two games are, from what the catalog says about them. No AI involved. */

const normalize = (value: string) => value.trim().toLowerCase();

/** Shared items over the geometric mean of both sizes: 1 for identical lists, 0 for disjoint. */
function overlap(a: string[], b: string[]): { score: number; shared: string[] } | null {
  if (a.length === 0 || b.length === 0) return null;
  const other = new Set(b.map(normalize));
  const seen = new Set<string>();
  const shared = a.filter((value) => {
    const key = normalize(value);
    if (!other.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sizeA = new Set(a.map(normalize)).size;
  return { score: shared.length / Math.sqrt(sizeA * other.size), shared };
}

const FEATURE_WEIGHTS = { genres: 0.35, themes: 0.2, tags: 0.45 } as const;
const FRANCHISE_SHARE = 0.15;
const MAX_SHARED_TAGS = 5;

/**
 * Similarity of two games by genre, theme and mechanics, from 0 to 1. Only what both games
 * have data for is compared: a missing list is "unknown", not "different". Being in the same
 * franchise adds on top.
 */
export function featureSimilarity(
  a: GameFeatures,
  b: GameFeatures,
): { similarity: number; shared: string[] } {
  let weighted = 0;
  let weights = 0;
  const shared: string[] = [];

  for (const key of ['genres', 'themes', 'tags'] as const) {
    const result = overlap(a[key], b[key]);
    if (!result) continue;
    weighted += FEATURE_WEIGHTS[key] * result.score;
    weights += FEATURE_WEIGHTS[key];
    shared.push(...(key === 'tags' ? result.shared.slice(0, MAX_SHARED_TAGS) : result.shared));
  }
  const base = weights === 0 ? 0 : weighted / weights;

  const sameFranchise =
    a.franchise !== null &&
    b.franchise !== null &&
    normalize(a.franchise) === normalize(b.franchise);
  if (sameFranchise && a.franchise) shared.unshift(a.franchise);

  return {
    similarity: Math.min(1, base * (1 - FRANCHISE_SHARE) + (sameFranchise ? FRANCHISE_SHARE : 0)),
    shared,
  };
}

// --- Achievement lists ---------------------------------------------------------

const RARE_BELOW_PERCENT = 10;

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Sums up an achievement list: how long it is and how hard its tail gets. `percents` holds one
 * entry per achievement — the share of players who have it, or null when unknown.
 */
export function achievementShape(
  percents: (number | null)[],
  times?: { mainMinutes: number | null; completionistMinutes: number | null } | null,
): AchievementShape | null {
  if (percents.length === 0) return null;
  const known = percents.filter((value): value is number => value !== null).sort((a, b) => a - b);
  const ratio =
    times?.mainMinutes && times.completionistMinutes
      ? Math.round((times.completionistMinutes / times.mainMinutes) * 100) / 100
      : null;
  return {
    count: percents.length,
    medianPercent: known.length ? round1(median(known)) : null,
    rarestPercent: known.length ? round1(known[0] ?? 0) : null,
    rareShare: known.length
      ? Math.round(
          (known.filter((value) => value < RARE_BELOW_PERCENT).length / known.length) * 100,
        ) / 100
      : null,
    completionRatio: ratio,
  };
}

/**
 * How alike two achievement lists are, from 0 to 1: similar size, similar difficulty in the
 * middle and at the rare end, and a similar amount of extra time to finish everything. Each
 * measure is compared only when both games have it.
 */
export function shapeSimilarity(a: AchievementShape, b: AchievementShape): number {
  const distances: number[] = [
    // Ten times more (or fewer) achievements is as different as it gets.
    Math.min(1, Math.abs(Math.log(a.count) - Math.log(b.count)) / Math.log(10)),
  ];
  const compare = (x: number | null, y: number | null, span: number) => {
    if (x !== null && y !== null) distances.push(Math.min(1, Math.abs(x - y) / span));
  };
  compare(a.medianPercent, b.medianPercent, 50);
  compare(a.rarestPercent, b.rarestPercent, 25);
  compare(a.rareShare, b.rareShare, 0.5);
  if (a.completionRatio !== null && b.completionRatio !== null) {
    distances.push(
      Math.min(
        1,
        Math.abs(Math.log(a.completionRatio) - Math.log(b.completionRatio)) / Math.log(4),
      ),
    );
  }
  return 1 - distances.reduce((sum, value) => sum + value, 0) / distances.length;
}
