export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
/** Hard cap on tracked keys so a flood of distinct emails cannot grow the map without bound. */
export const MAX_KEYS = 10_000;

export interface Throttle {
  /** Seconds to wait if the key is locked, otherwise 0. */
  retryAfterSec(key: string, now: Date): number;
  recordFailure(key: string, now: Date): void;
  clear(key: string): void;
  reset(): void;
  /** Number of tracked keys (for tests). */
  size(): number;
}

/**
 * Best-effort brute-force throttle: MAX_FAILURES failures per normalised email in WINDOW_MS.
 *
 * TODO(P-hardening): this state lives in process memory. On serverless (Vercel) every instance has its
 * own map and cold starts forget it, so an attacker spread across instances gets more than 5 tries.
 * Move to a shared store (a Postgres table or Upstash/Redis) before relying on it as a control.
 */
export function createInMemoryThrottle(): Throttle {
  const failures = new Map<string, number[]>();
  const live = (key: string, now: Date) => {
    const cutoff = now.getTime() - WINDOW_MS;
    const recent = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
    return recent;
  };
  /** Drop every expired entry; if still over the cap, drop the oldest keys (Map keeps insertion order). */
  let lastPrune = 0;
  const prune = (now: Date) => {
    // A full scan is O(keys): do it at most once a second, or whenever the cap is exceeded.
    if (failures.size <= MAX_KEYS && now.getTime() - lastPrune < 1000) return;
    lastPrune = now.getTime();
    const cutoff = now.getTime() - WINDOW_MS;
    for (const [key, times] of failures) {
      if (times[times.length - 1]! <= cutoff) failures.delete(key);
    }
    for (const key of failures.keys()) {
      if (failures.size <= MAX_KEYS) break;
      failures.delete(key);
    }
  };
  return {
    retryAfterSec(key, now) {
      const recent = live(key, now);
      if (recent.length < MAX_FAILURES) return 0;
      return Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now.getTime()) / 1000));
    },
    recordFailure(key, now) {
      prune(now);
      const recent = live(key, now);
      recent.push(now.getTime());
      failures.set(key, recent);
    },
    clear: (key) => void failures.delete(key),
    reset: () => failures.clear(),
    size: () => failures.size,
  };
}

const g = globalThis as unknown as { __maw3edThrottle?: Throttle };
export const loginThrottle: Throttle = (g.__maw3edThrottle ??= createInMemoryThrottle());
