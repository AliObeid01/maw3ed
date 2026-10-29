/** True for a finite, non-negative amount that is exactly a whole number of cents (0.1 + 0.2 counts). */
export function isCents(v: number): boolean {
  if (!Number.isFinite(v) || v < 0) return false;
  if (v === 0) return true;
  if (v < 0.01) return false;
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

/** Round to cents; -0 becomes 0. */
export function toCents(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}
