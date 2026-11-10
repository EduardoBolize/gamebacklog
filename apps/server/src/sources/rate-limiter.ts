import type { SourceRateLimit } from './adapter.ts';

export interface RateLimiter {
  /** Runs `task` as soon as the limit allows, in call order. */
  schedule<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * Sliding-window limiter: at most `maxRequests` task starts in any `perMs` window.
 * Tasks queue up and start in order, so a burst is spread out instead of rejected.
 */
export function createRateLimiter(limit: SourceRateLimit): RateLimiter {
  const startTimes: number[] = [];
  let chain: Promise<void> = Promise.resolve();

  async function waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (startTimes.length > 0 && now - (startTimes[0] ?? 0) >= limit.perMs) {
        startTimes.shift();
      }
      if (startTimes.length < limit.maxRequests) {
        startTimes.push(now);
        return;
      }
      const waitMs = limit.perMs - (now - (startTimes[0] ?? now));
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 1)));
    }
  }

  return {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      const slot = chain.then(waitForSlot);
      // The queue only orders the starts; a slow or failing task never blocks the next one.
      chain = slot.catch(() => undefined);
      return slot.then(task);
    },
  };
}
