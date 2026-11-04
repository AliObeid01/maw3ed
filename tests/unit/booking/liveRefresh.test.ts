import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveRefresh, sameData } from '@/lib/booking/liveRefresh';

const MIN = 60_000;

function setup(random = () => 0.5) {
  const doc = new EventTarget();
  const win = new EventTarget();
  let visible = true;
  const refresh = vi.fn();
  const live = createLiveRefresh({
    refresh,
    random,
    now: () => Date.now(),
    isVisible: () => visible,
    doc,
    win,
  });
  return {
    refresh,
    live,
    interact: () => win.dispatchEvent(new Event('pointerdown')),
    setVisible: (v: boolean) => {
      visible = v;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

describe('createLiveRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes about once a minute while visible, not before', () => {
    const { live, refresh, interact } = setup();
    live.start();
    vi.advanceTimersByTime(59_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    interact();
    vi.advanceTimersByTime(MIN);
    expect(refresh).toHaveBeenCalledTimes(2);
    live.stop();
  });

  it('jitters the wait within 15 percent and never issues a request storm over simulated minutes', () => {
    for (const r of [0, 1]) {
      const { live, refresh, interact } = setup(() => r);
      live.start();
      // Ten simulated minutes with the client present the whole time.
      for (let s = 0; s < 600; s += 5) {
        interact();
        vi.advanceTimersByTime(5_000);
      }
      // 51 s waits at the low end give 11 refreshes in 10 minutes, 69 s waits give 8: never more than one per ~51 s.
      expect(refresh.mock.calls.length).toBeLessThanOrEqual(12);
      expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(8);
      live.stop();
    }
  });

  it('pauses while the tab is hidden and resumes when it is visible again', () => {
    const { live, refresh, setVisible } = setup();
    live.start();
    setVisible(false);
    vi.advanceTimersByTime(10 * MIN);
    expect(refresh).not.toHaveBeenCalled();
    setVisible(true);
    vi.advanceTimersByTime(MIN + 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    live.stop();
  });

  it('stops after 15 minutes without interaction and resumes (with one catch-up refresh) on the next interaction', () => {
    const { live, refresh, interact } = setup();
    live.start();
    vi.advanceTimersByTime(20 * MIN);
    const whileIdle = refresh.mock.calls.length;
    expect(whileIdle).toBeLessThanOrEqual(15);
    expect(live.isIdle()).toBe(true);
    vi.advanceTimersByTime(30 * MIN);
    expect(refresh).toHaveBeenCalledTimes(whileIdle);
    interact();
    expect(refresh).toHaveBeenCalledTimes(whileIdle + 1);
    vi.advanceTimersByTime(MIN + 1);
    expect(refresh).toHaveBeenCalledTimes(whileIdle + 2);
    live.stop();
  });

  it('interaction keeps it alive past 15 minutes', () => {
    const { live, refresh, interact } = setup();
    live.start();
    for (let m = 0; m < 30; m++) {
      interact();
      vi.advanceTimersByTime(MIN);
    }
    expect(live.isIdle()).toBe(false);
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(28);
    live.stop();
  });

  it('stop cancels everything', () => {
    const { live, refresh } = setup();
    live.start();
    live.stop();
    vi.advanceTimersByTime(10 * MIN);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('sameData', () => {
  it('is true for equal JSON and false for a change', () => {
    expect(sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameData({ a: [1] }, { a: [2] })).toBe(false);
    expect(sameData(null, null)).toBe(true);
  });
});
