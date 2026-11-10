import type { FunnelResponse, GameTimes, PlaythroughGoal } from '@gamebacklog/shared';

export interface FunnelAchievement {
  id: string;
  name: string;
  globalPercent: number | null;
  isStory: boolean;
  isUnlocked: boolean;
}

export interface FunnelInput {
  achievements: FunnelAchievement[];
  goal: PlaythroughGoal;
  times: GameTimes | null;
  playtimeMinutes: number | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Abandonment funnel from global achievement percentages.
 *
 * Story achievements sorted from most to least common form the path through the game: the rarest
 * one stands for "finished". If 60% of players reached the milestone you are at and 23% reached
 * the last one, then about 38% of the players who got this far finished.
 */
export function computeFunnel(input: FunnelInput): FunnelResponse {
  const basis = input.goal === 'finish' ? ('main' as const) : ('completionist' as const);
  const target = basis === 'main' ? input.times?.mainMinutes : input.times?.completionistMinutes;
  const remainingMinutes =
    target === null || target === undefined
      ? null
      : Math.max(0, target - (input.playtimeMinutes ?? 0));

  const empty: FunnelResponse = {
    available: false,
    reason: null,
    percentFinished: null,
    remainingMinutes,
    remainingBasis: remainingMinutes === null ? null : basis,
    currentMilestoneId: null,
    finalMilestoneId: null,
    milestones: [],
  };

  const withPercent = input.achievements.filter(
    (achievement) => achievement.globalPercent !== null && achievement.globalPercent > 0,
  );
  if (withPercent.length === 0) return { ...empty, reason: 'no_achievements' };

  const story = withPercent
    .filter((achievement) => achievement.isStory)
    .sort((a, b) => (b.globalPercent ?? 0) - (a.globalPercent ?? 0));
  if (story.length === 0) return { ...empty, reason: 'no_story_achievements' };

  const milestones = story.map((achievement) => ({
    achievementId: achievement.id,
    name: achievement.name,
    globalPercent: achievement.globalPercent ?? 0,
    isUnlocked: achievement.isUnlocked,
  }));
  const final = milestones.at(-1);
  // The furthest point reached is the rarest story milestone already unlocked.
  const current = milestones.findLast((milestone) => milestone.isUnlocked);
  if (!final || !current) {
    return {
      ...empty,
      reason: 'no_position',
      milestones,
      finalMilestoneId: final?.achievementId ?? null,
    };
  }

  const finished = current.achievementId === final.achievementId;
  return {
    ...empty,
    available: true,
    percentFinished: finished
      ? 100
      : Math.min(100, round1((final.globalPercent / current.globalPercent) * 100)),
    remainingMinutes: finished && basis === 'main' ? 0 : remainingMinutes,
    remainingBasis: finished && basis === 'main' ? basis : empty.remainingBasis,
    currentMilestoneId: current.achievementId,
    finalMilestoneId: final.achievementId,
    milestones,
  };
}
