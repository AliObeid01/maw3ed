/**
 * The Reveal state machine (pure: no DOM, no I/O). `Reveal` (a client component) calls these after mount.
 *
 * The server HTML is ALWAYS fully visible: nothing is hidden before hydration, so a no-JS visitor, a crawler and the
 * LCP element see everything at once. After mount a block is hidden ONLY if it starts below the fold, so what the
 * visitor can see never flashes; it then fades in once when it scrolls into view.
 */
export type RevealState = 'visible' | 'hidden' | 'revealed';

export const MAX_STEP = 6;

export function initialRevealState({
  reducedMotion,
  hasObserver,
  top,
  viewportHeight,
}: {
  reducedMotion: boolean;
  hasObserver: boolean;
  /** `getBoundingClientRect().top` at mount. */
  top: number;
  viewportHeight: number;
}): 'visible' | 'hidden' {
  if (reducedMotion || !hasObserver) return 'visible';
  return top < viewportHeight ? 'visible' : 'hidden';
}

export function nextRevealState(state: RevealState, event: 'intersect' | 'reduced'): RevealState {
  if (state === 'hidden') return 'revealed';
  return state;
}

/** Stagger index (a CSS data attribute drives the delay), kept small so a group never feels slow. */
export function clampStep(step: number | undefined): number {
  if (step === undefined || !Number.isFinite(step)) return 0;
  return Math.min(MAX_STEP, Math.max(0, Math.round(step)));
}
