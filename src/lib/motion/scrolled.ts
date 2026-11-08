/** Pure helpers for the public header (PR-12). No DOM, so they are unit-tested. */

/** The header shadow turns on after this many pixels of scroll. */
export const SCROLLED_AFTER = 4;

export function isScrolled(scrollY: number): boolean {
  return Number.isFinite(scrollY) && scrollY > SCROLLED_AFTER;
}

/** Position of the active phone tab, so one indicator bar can slide (transform only). `null` hides the bar. */
export function tabIndicator(ids: readonly string[], current: string | null): { index: number; count: number } | null {
  if (current === null) return null;
  const index = ids.indexOf(current);
  return index < 0 ? null : { index, count: ids.length };
}
