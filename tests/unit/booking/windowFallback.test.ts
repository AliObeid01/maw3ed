import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import { loadSlotWindow } from '@/lib/booking/window';

const now = new Date('2026-11-01T10:00:00Z');
const slots = [{ startAt: '2026-11-03T08:30:00Z', endAt: '2026-11-03T09:00:00Z' }];
const outOfWindow = () => new ApiError(400, 'VALIDATION_FAILED', 'x', { to: 'Bookings open up to 2 days ahead.' });

/** A server that accepts requests up to `allowedTo` (inclusive) and answers 400 on `to` beyond it. */
const serverUpTo = (allowedTo: string) =>
  vi.fn(async (_slug: string, q: { to: string }) => {
    if (q.to > allowedTo) throw outOfWindow();
    return slots;
  });
const tos = (fn: ReturnType<typeof serverUpTo>) => fn.mock.calls.map((c) => c[1].to);
const run = (
  fetchSlots: ReturnType<typeof serverUpTo>,
  maxDays: number,
  refresh?: (signal?: AbortSignal) => Promise<number | undefined>,
  signal?: AbortSignal,
) => loadSlotWindow('s', { serviceId: 's1' }, 'Asia/Beirut', now, signal, fetchSlots as never, maxDays, refresh);

describe('loadSlotWindow: a known window the server still rejects (F28)', () => {
  it('falls back through 7, 3, 1 below the attempted length and re-reads the business once', async () => {
    const fetchSlots = serverUpTo('2026-11-03'); // server window is 3 days; the page believes 10
    const refresh = vi.fn(async () => 10 as number | undefined); // the business still says 10
    const w = await run(fetchSlots, 10, refresh);
    expect(tos(fetchSlots)).toEqual(['2026-11-10', '2026-11-07', '2026-11-03']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(w.coveredDays).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('jumps straight to the freshly published window instead of guessing', async () => {
    const fetchSlots = serverUpTo('2026-11-02'); // 2 days: not on the 7, 3, 1 ladder
    const refresh = vi.fn(async () => 2 as number | undefined);
    const w = await run(fetchSlots, 7, refresh);
    expect(tos(fetchSlots)).toEqual(['2026-11-07', '2026-11-02']);
    expect(w.coveredDays).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never loops: every length once, one refresh, then the error', async () => {
    const fetchSlots = serverUpTo('2026-10-31'); // nothing is accepted
    const refresh = vi.fn(async () => 7 as number | undefined);
    await expect(run(fetchSlots, 7, refresh)).rejects.toMatchObject({ status: 400 });
    expect(tos(fetchSlots)).toEqual(['2026-11-07', '2026-11-03', '2026-11-01']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a window of 1 day has nothing shorter: it re-reads the business once and gives up', async () => {
    const fetchSlots = serverUpTo('2026-10-31');
    const refresh = vi.fn(async () => 1 as number | undefined);
    await expect(run(fetchSlots, 1, refresh)).rejects.toMatchObject({ status: 400 });
    expect(tos(fetchSlots)).toEqual(['2026-11-01']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a failing refresh does not stop the fallback', async () => {
    const fetchSlots = serverUpTo('2026-11-03');
    const refresh = vi.fn(async (): Promise<number | undefined> => {
      throw new ApiError(500, 'INTERNAL', 'x');
    });
    const w = await run(fetchSlots, 7, refresh);
    expect(w.coveredDays).toHaveLength(3);
  });

  it('does not touch the business when the first request succeeds or fails for another reason', async () => {
    const refresh = vi.fn(async () => 3 as number | undefined);
    await run(serverUpTo('2026-11-30'), 7, refresh);
    const broken = vi.fn(async () => {
      throw new ApiError(500, 'INTERNAL', 'x');
    });
    await expect(run(broken as never, 7, refresh)).rejects.toMatchObject({ status: 500 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['429 too many requests', new ApiError(429, 'RATE_LIMITED', 'x')],
    ['400 on another field than `to`', new ApiError(400, 'VALIDATION_FAILED', 'x', { serviceId: 'Invalid id.' })],
  ])('%s is rethrown at once: no fallback, no business refresh', async (_name, error) => {
    const fetchSlots = vi.fn(async (): Promise<typeof slots> => {
      throw error;
    });
    const refresh = vi.fn(async () => 3 as number | undefined);
    await expect(run(fetchSlots as never, 7, refresh)).rejects.toBe(error);
    expect(fetchSlots).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps abort handling: an aborted refresh ends the load with the abort error', async () => {
    const controller = new AbortController();
    const refresh = vi.fn(async (): Promise<number | undefined> => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(run(serverUpTo('2026-10-31'), 7, refresh, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
