/**
 * Live refresh for the public booking page (F68-B). While the tab is visible `refresh` runs about once a minute
 * (jittered, so many open tabs do not hit the API in the same second). It pauses while the tab is hidden and stops
 * after `idleMs` without interaction; the next interaction (or the tab becoming visible) resumes it.
 *
 * Framework free so it can be tested with fake timers; `useLiveRefresh` below wires it to React.
 */
export const LIVE_INTERVAL_MS = 60_000;
export const LIVE_IDLE_MS = 15 * 60_000;
export const LIVE_JITTER = 0.15;
/** Events that count as the client still being there. Passive; they only store a timestamp. */
export const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'focusin'] as const;

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export type LiveRefreshOptions = {
  refresh: () => void;
  intervalMs?: number;
  idleMs?: number;
  /** 0.15 = each wait is 85 % to 115 % of `intervalMs`. */
  jitter?: number;
  random?: () => number;
  now?: () => number;
  isVisible?: () => boolean;
  doc?: Target;
  win?: Target;
};

export function createLiveRefresh(options: LiveRefreshOptions) {
  const {
    refresh,
    intervalMs = LIVE_INTERVAL_MS,
    idleMs = LIVE_IDLE_MS,
    jitter = LIVE_JITTER,
    random = Math.random,
    now = Date.now,
    isVisible = () => document.visibilityState === 'visible',
    doc = typeof document === 'undefined' ? undefined : document,
    win = typeof window === 'undefined' ? undefined : window,
  } = options;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastInteraction = now();
  let idle = false;
  let running = false;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    if (!running || idle || timer !== undefined || !isVisible()) return;
    const wait = intervalMs * (1 + (random() * 2 - 1) * jitter);
    timer = setTimeout(tick, wait);
  };

  function tick() {
    timer = undefined;
    if (!running || !isVisible()) return; // hidden: the visibility handler restarts it
    if (now() - lastInteraction >= idleMs) {
      idle = true; // nobody here: stop, an interaction wakes it
      return;
    }
    refresh();
    schedule();
  }

  const onInteraction = () => {
    lastInteraction = now();
    if (idle) {
      idle = false;
      if (isVisible()) {
        refresh(); // the data is as old as the idle period
        schedule();
      }
    }
  };

  const onVisibility = () => {
    if (!isVisible()) {
      clear();
      return;
    }
    // Back on the tab counts as being here. The page's own visibility handler already refetches once.
    lastInteraction = now();
    idle = false;
    clear();
    schedule();
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastInteraction = now();
      idle = false;
      doc?.addEventListener('visibilitychange', onVisibility);
      for (const name of INTERACTION_EVENTS) win?.addEventListener(name, onInteraction, { passive: true, capture: true });
      schedule();
    },
    stop() {
      running = false;
      clear();
      doc?.removeEventListener('visibilitychange', onVisibility);
      for (const name of INTERACTION_EVENTS) win?.removeEventListener(name, onInteraction, { capture: true });
    },
    /** For tests and the page: is the poller asleep because of inactivity? */
    isIdle: () => idle,
  };
}

/** Structural equality for JSON data, so an unchanged refresh keeps the old object (no re-render, no flicker). */
export const sameData = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
