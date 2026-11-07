/**
 * Run async tasks with at most `limit` in flight. Stops starting new ones once `signal` is aborted. A task that
 * throws does not stop the others (each task handles its own errors; this only keeps the pool alive).
 */
export async function runPool(
  tasks: readonly (() => Promise<void>)[],
  limit: number,
  signal: AbortSignal,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = next;
      next += 1;
      const task = tasks[index];
      if (!task) return;
      try {
        await task();
      } catch {
        // one failing task must not stop the rest
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
}
