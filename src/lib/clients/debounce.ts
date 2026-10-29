/** Trailing debounce with an injectable timer, so tests control time. */
export function createDebounced<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  timers: {
    set: (cb: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  } = {
    set: (cb, delay) => setTimeout(cb, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
) {
  let handle: unknown;
  let pending: A | undefined;
  const cancel = () => {
    if (handle !== undefined) timers.clear(handle);
    handle = undefined;
    pending = undefined;
  };
  return {
    call(...args: A) {
      if (handle !== undefined) timers.clear(handle);
      pending = args;
      handle = timers.set(() => {
        handle = undefined;
        const a = pending!;
        pending = undefined;
        fn(...a);
      }, ms);
    },
    /** Run a waiting call now (Enter in the search box). */
    flush() {
      if (handle === undefined || !pending) return;
      const a = pending;
      cancel();
      fn(...a);
    },
    cancel,
  };
}
