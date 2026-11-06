export type OutcomeTarget = 'ATTENDED' | 'NO_SHOW' | 'LATE_CANCEL';
export type CounterField = 'attended' | 'noShows' | 'lateCancels';

/**
 * Minutes after the start before a booking that nobody has marked can become NO_SHOW. A No-show frees the slot in
 * appointment_no_overlap, so a client who is a few minutes late must not lose their time to a walk-in. Fixed, not a
 * business setting. LATE_CANCEL is not held back: the client has said they are not coming.
 */
export const NO_SHOW_GRACE_MIN = 10;

const COUNTER: Record<OutcomeTarget, CounterField> = {
  ATTENDED: 'attended',
  NO_SHOW: 'noShows',
  LATE_CANCEL: 'lateCancels',
};

export interface PlanInput {
  /** The appointment's current status. */
  status: string;
  /** Set by the link / staff cancel flows. A LATE_CANCEL with a value here was already counted by that flow. */
  cancelledVia: 'LINK' | 'STAFF' | 'SYSTEM' | null;
  startAt: Date;
  endAt: Date;
  now: Date;
  target: OutcomeTarget;
}

export type OutcomePlan =
  | { kind: 'not_started' }
  | { kind: 'not_ended' }
  | { kind: 'grace_period'; availableAt: Date }
  | { kind: 'conflict' }
  | { kind: 'noop' }
  | { kind: 'apply'; decrement: CounterField | null; increment: CounterField };

/**
 * Decide what marking an outcome does. Pure: the clock is injected.
 *
 * - Only appointments that have started can get an outcome.
 * - From BOOKED / CONFIRMED the target counter goes up by one.
 * - Between ATTENDED / NO_SHOW / LATE_CANCEL (a correction) one count moves from the old counter to the new.
 * - The same outcome again is a no-op.
 * - A LATE_CANCEL written by the cancel flow (cancelledVia set) is already counted and final: marking it
 *   again as LATE_CANCEL is a no-op, anything else conflicts (a cancelled appointment cannot be attended).
 * - CANCELLED and PENDING_PAYMENT never take an outcome.
 * - Guarantee 1: BOOKED / CONFIRMED hold the slot in appointment_no_overlap. Leaving that set re-opens the
 *   appointment's remaining time and buffer, so ATTENDED (which means "it happened") requires endAt <= now
 *   (NOT_ENDED otherwise). NO_SHOW and LATE_CANCEL may follow once startAt has passed: they free the slot on
 *   purpose. No route moves a past appointment back to BOOKED / CONFIRMED (the link confirm only accepts
 *   BOOKED), so a correction can never re-enter the constraint set.
 */
export function planOutcome(input: PlanInput): OutcomePlan {
  const plan = decide(input);
  if (
    plan.kind === 'apply' &&
    input.target === 'ATTENDED' &&
    input.endAt.getTime() > input.now.getTime()
  )
    return { kind: 'not_ended' };
  return plan;
}

function decide(input: PlanInput): OutcomePlan {
  const { status, target } = input;
  if (input.startAt.getTime() > input.now.getTime()) return { kind: 'not_started' };

  if (status === 'LATE_CANCEL' && input.cancelledVia !== null)
    return target === 'LATE_CANCEL' ? { kind: 'noop' } : { kind: 'conflict' };

  if (status === 'BOOKED' || status === 'CONFIRMED') {
    // The grace period applies only to moving INTO no-show from an unmarked booking. A correction from an outcome
    // that is already recorded (ATTENDED / LATE_CANCEL set by staff) is not re-blocked: the slot was already free.
    if (target === 'NO_SHOW') {
      const availableAt = new Date(input.startAt.getTime() + NO_SHOW_GRACE_MIN * 60_000);
      if (availableAt.getTime() > input.now.getTime()) return { kind: 'grace_period', availableAt };
    }
    return { kind: 'apply', decrement: null, increment: COUNTER[target] };
  }

  if (status === 'ATTENDED' || status === 'NO_SHOW' || status === 'LATE_CANCEL') {
    if (status === target) return { kind: 'noop' };
    return {
      kind: 'apply',
      decrement: COUNTER[status as OutcomeTarget],
      increment: COUNTER[target],
    };
  }
  return { kind: 'conflict' };
}

export type ExcusePlan =
  | { kind: 'noop' }
  | { kind: 'conflict' }
  | { kind: 'apply'; decrement: CounterField };

/**
 * Excuse a no-show or a late cancel: the booking becomes a normal CANCELLED one and the matching client counter
 * goes down by one. Works for a mark set by staff and for a LATE_CANCEL written by the cancel link. An appointment
 * that is already CANCELLED is a no-op (idempotent). Every other status conflicts. Neither the source nor the target
 * status is in the active set of appointment_no_overlap, so the slot is not touched.
 */
export function planExcuse(input: { status: string }): ExcusePlan {
  if (input.status === 'NO_SHOW') return { kind: 'apply', decrement: 'noShows' };
  if (input.status === 'LATE_CANCEL') return { kind: 'apply', decrement: 'lateCancels' };
  if (input.status === 'CANCELLED') return { kind: 'noop' };
  return { kind: 'conflict' };
}

/** A counter after an excuse: one less, never below zero. */
export const decrementCounter = (count: number): number => Math.max(0, count - 1);
