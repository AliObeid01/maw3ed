import type { Slot } from '@/lib/api/booking';

/**
 * The earliest free slot that starts at or after `now` (the front-desk API ignores minimum notice, so the very
 * next slot is allowed). Slots of any day may be passed; `undefined` when nothing is left.
 */
export function earliestSlot(slots: Slot[], now: Date): Slot | undefined {
  const t = now.getTime();
  let best: Slot | undefined;
  for (const slot of slots) {
    const start = Date.parse(slot.startAt);
    if (Number.isNaN(start) || start < t) continue;
    if (!best || start < Date.parse(best.startAt)) best = slot;
  }
  return best;
}
