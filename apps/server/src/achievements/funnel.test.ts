import type { GameTimes } from '@gamebacklog/shared';
import { describe, expect, it } from 'vitest';
import { computeFunnel, type FunnelAchievement } from './funnel.ts';
import { looksLikeNewGamePlus, looksLikeStory } from './heuristics.ts';

const achievement = (
  id: string,
  globalPercent: number | null,
  options: { story?: boolean; unlocked?: boolean } = {},
): FunnelAchievement => ({
  id,
  name: id,
  globalPercent,
  isStory: options.story ?? true,
  isUnlocked: options.unlocked ?? false,
});

const times: GameTimes = {
  origin: 'hltb',
  mainMinutes: 30 * 60,
  mainExtraMinutes: 46 * 60,
  completionistMinutes: 70 * 60,
  originUrl: null,
  fetchedAt: null,
};

describe('computeFunnel', () => {
  const darkSouls = [
    achievement('bell-2', 45),
    achievement('ending', 23),
    achievement('bell-1', 60, { unlocked: true }),
    achievement('rare-weapons', 5, { story: false, unlocked: true }),
    achievement('lordvessel', 32),
  ];

  it('tells what share of the players who got this far finished', () => {
    const funnel = computeFunnel({
      achievements: darkSouls,
      goal: 'finish',
      times,
      playtimeMinutes: 9 * 60,
    });
    expect(funnel).toMatchObject({
      available: true,
      reason: null,
      percentFinished: 38.3, // 23 / 60
      remainingMinutes: 21 * 60,
      remainingBasis: 'main',
      currentMilestoneId: 'bell-1',
      finalMilestoneId: 'ending',
    });
    // Milestones are ordered from most to least common, and skip non-story achievements.
    expect(funnel.milestones.map((milestone) => milestone.achievementId)).toEqual([
      'bell-1',
      'bell-2',
      'lordvessel',
      'ending',
    ]);
  });

  it('uses the furthest milestone reached, even when earlier ones are missing', () => {
    const funnel = computeFunnel({
      achievements: darkSouls.map((item) =>
        item.id === 'lordvessel' ? { ...item, isUnlocked: true } : item,
      ),
      goal: 'finish',
      times,
      playtimeMinutes: 0,
    });
    expect(funnel.currentMilestoneId).toBe('lordvessel');
    expect(funnel.percentFinished).toBe(71.9); // 23 / 32
  });

  it('measures the remaining time against the completionist figure for 100% goals', () => {
    const funnel = computeFunnel({
      achievements: darkSouls,
      goal: 'all_achievements',
      times,
      playtimeMinutes: 10 * 60,
    });
    expect(funnel).toMatchObject({ remainingMinutes: 60 * 60, remainingBasis: 'completionist' });
  });

  it('reports 100% and no time left once the last milestone is unlocked', () => {
    const funnel = computeFunnel({
      achievements: darkSouls.map((item) => ({ ...item, isUnlocked: true })),
      goal: 'finish',
      times,
      playtimeMinutes: 5 * 60,
    });
    expect(funnel).toMatchObject({ percentFinished: 100, remainingMinutes: 0 });
  });

  it('never goes below zero when the player is past the time to beat', () => {
    const funnel = computeFunnel({
      achievements: darkSouls,
      goal: 'finish',
      times,
      playtimeMinutes: 90 * 60,
    });
    expect(funnel.remainingMinutes).toBe(0);
  });

  it('explains why there is no estimate', () => {
    const base = { goal: 'finish' as const, times: null, playtimeMinutes: null };
    expect(computeFunnel({ ...base, achievements: [] }).reason).toBe('no_achievements');
    expect(computeFunnel({ ...base, achievements: [achievement('a', null)] }).reason).toBe(
      'no_achievements',
    );
    expect(
      computeFunnel({ ...base, achievements: [achievement('a', 50, { story: false })] }).reason,
    ).toBe('no_story_achievements');

    const noPosition = computeFunnel({ ...base, achievements: [achievement('a', 50)] });
    expect(noPosition).toMatchObject({
      available: false,
      reason: 'no_position',
      finalMilestoneId: 'a',
      remainingMinutes: null,
    });
    expect(noPosition.milestones).toHaveLength(1);
  });
});

describe('story heuristic', () => {
  it.each([
    ['Chapter 3 Complete', null],
    ['Act II', 'Finish the second act.'],
    ['Lord of Cinder', 'Defeat the final boss.'],
    ['The End', 'Reach the ending and watch the credits.'],
    ['Escape Artist', 'Escaped from the prison.'],
  ])('treats %j as story progress', (name, description) => {
    expect(looksLikeStory({ name, description })).toBe(true);
  });

  it.each([
    ['Collector', 'Collect all the coins.'],
    ['Slayer', 'Defeat 100 enemies.'],
    ['Perfectionist', 'Complete every side quest.'],
    ['Iron Will', 'Finish the game on Hard difficulty.'],
    ['Untouchable', 'Defeat a boss without taking damage.'],
    ['Friendly', 'Pet the dog.'],
  ])('does not treat %j as story progress', (name, description) => {
    expect(looksLikeStory({ name, description })).toBe(false);
  });

  it('spots New Game+ achievements', () => {
    expect(looksLikeNewGamePlus({ name: 'Again', description: 'Finish New Game+.' })).toBe(true);
    expect(looksLikeNewGamePlus({ name: 'NG+ hero', description: null })).toBe(true);
    expect(looksLikeNewGamePlus({ name: 'Hero', description: 'Finish the game.' })).toBe(false);
  });
});
