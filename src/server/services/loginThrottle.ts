export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export interface Throttle {
  /** Seconds to wait if the key is locked, otherwise 0. */
  retryAfterSec(key: string, now: Date): number;
  recordFailure(key: string, now: Date): void;
  clear(key: string): void;
  reset(): void;
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
  return {
    retryAfterSec(key, now) {
      const recent = live(key, now);
      if (recent.length < MAX_FAILURES) return 0;
      return Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now.getTime()) / 1000));
    },
    recordFailure(key, now) {
      const recent = live(key, now);
      recent.push(now.getTime());
      failures.set(key, recent);
    },
    clear: (key) => void failures.delete(key),
    reset: () => failures.clear(),
  };
}

const g = globalThis as unknown as { __maw3edThrottle?: Throttle };
export const loginThrottle: Throttle = (g.__maw3edThrottle ??= createInMemoryThrottle());
