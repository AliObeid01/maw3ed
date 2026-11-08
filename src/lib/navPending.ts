/**
 * How many client navigations are in flight right now. The top progress bar shows while this is above zero. A tiny
 * external store (no library); links and the hero search report into it, the bar reads it.
 */
let count = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of [...listeners]) l();
};

/** A navigation started; call the returned function when it ends. Safe to call the end function twice. */
export function beginNavigation(): () => void {
  count += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    count = Math.max(0, count - 1);
    emit();
  };
}

export const navigationPending = (): boolean => count > 0;
export const subscribeNavigation = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
