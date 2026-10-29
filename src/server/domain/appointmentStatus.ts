/**
 * Statuses that hold a slot and count as "upcoming work".
 * MUST match the status predicate of the `appointment_no_overlap` exclusion constraint's active set.
 * The deposit task must add 'PENDING_PAYMENT' here (and to the constraint predicate) together.
 */
export const ACTIVE_APPOINTMENT_STATUSES = ['BOOKED', 'CONFIRMED'] as const;
