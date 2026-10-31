import { after } from 'next/server';

/**
 * Run slow work (sending an email) after the response has been sent, so the answer does not reveal, through
 * its timing, whether the work existed. Outside a request scope (tests, scripts) `after` is unavailable and
 * the task simply runs to completion first. The task must handle its own errors.
 */
export async function afterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}
