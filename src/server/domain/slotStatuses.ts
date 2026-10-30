/**
 * Appointment statuses that HOLD a slot. This single list must stay in step with three places:
 *   1. the appointment_no_overlap exclusion constraint predicate (the LATEST constraint migration,
 *      20261031090100_deposit_overlap_constraint: `WHERE (status IN ('BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'))`),
 *   2. the busy intervals the availability loader subtracts (BLOCKING_STATUSES in availability.repo.ts),
 *   3. the per-day booking counts behind the "anyone" fairness pick (COUNTED_STATUSES in appointment.repo.ts,
 *      which is this list plus finished appointments).
 * A PENDING_PAYMENT deposit hold blocks its slot for 15 minutes. Never edit an applied migration: changing
 * this list needs a NEW migration that drops and re-creates the constraint.
 * tests/unit/booking/slotStatuses.test.ts fails if the constant and the migration SQL drift apart.
 */
export const SLOT_HOLDING_STATUSES = ['BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'] as const;
