import { describe, expect, it } from 'vitest';
import { runPool } from '@/lib/myBookings/pool';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runPool', () => {
  it('never runs more than the limit at once and runs every task', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    const tasks = Array.from({ length: 8 }, (_, i) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      await tick();
      running -= 1;
      done.push(i);
    });
    await runPool(tasks, 3, new AbortController().signal);
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('stops starting new tasks once aborted', async () => {
    const controller = new AbortController();
    let started = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      started += 1;
      controller.abort();
      await tick();
    });
    await runPool(tasks, 1, controller.signal);
    expect(started).toBe(1);
  });

  it('a failing task does not stop the others', async () => {
    const ran: number[] = [];
    await runPool(
      [
        async () => {
          throw new Error('x');
        },
        async () => {
          ran.push(1);
        },
        async () => {
          ran.push(2);
        },
      ],
      2,
      new AbortController().signal,
    );
    expect(ran.sort()).toEqual([1, 2]);
  });
});
