export type OutcomeTarget = 'ATTENDED' | 'NO_SHOW' | 'LATE_CANCEL';
export type CounterField = 'attended' | 'noShows' | 'lateCancels';

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

  if (status === 'BOOKED' || status === 'CONFIRMED')
    return { kind: 'apply', decrement: null, increment: COUNTER[target] };

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
