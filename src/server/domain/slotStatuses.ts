/**
 * Appointment statuses that HOLD a slot. This single list must stay in step with three places:
 *   1. the appointment_no_overlap exclusion constraint predicate (hand-written migration:
 *      `WHERE (status IN ('BOOKED', 'CONFIRMED'))`),
 *   2. the busy intervals the availability loader subtracts (BLOCKING_STATUSES in availability.repo.ts),
 *   3. the per-day booking counts behind the "anyone" fairness pick (COUNTED_STATUSES in appointment.repo.ts,
 *      which is this list plus finished appointments).
 * The deposit task adds 'PENDING_PAYMENT' to ALL of them AND ships a NEW migration that drops and
 * re-creates the constraint (never edit an applied migration). tests/unit/booking/slotStatuses.test.ts
 * fails if the constant and the migration SQL drift apart.
 */
export const SLOT_HOLDING_STATUSES = ['BOOKED', 'CONFIRMED'] as const;
