import { AppError } from '@/server/http/errors';

export interface Semaphore {
  /** Run `fn` when a slot is free; waits up to the budget, then throws 503 SERVICE_BUSY. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Slots in use and callers waiting (for tests). */
  stats(): { active: number; waiting: number };
}

/**
 * In-process counting semaphore. On serverless this bounds work PER INSTANCE only: N warm instances can
 * run N x max hashes at once. It protects one instance's CPU and memory from an argon2 flood; the
 * Postgres rate limits are what bound the fleet.
 */
export function createSemaphore(max: number, maxWaitMs: number): Semaphore {
  let active = 0;
  const queue: { grant: () => void }[] = [];

  const release = () => {
    const next = queue.shift();
    if (next)
      next.grant(); // the slot passes straight to the next waiter
    else active--;
  };

  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        const i = queue.indexOf(waiter);
        if (i >= 0) queue.splice(i, 1);
        reject(AppError.busy(2));
      }, maxWaitMs);
      queue.push(waiter);
    });
  };

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    stats: () => ({ active, waiting: queue.length }),
  };
}
