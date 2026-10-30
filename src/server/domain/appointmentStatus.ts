/**
 * Statuses that hold a slot and count as "upcoming work" (staff deactivation guard, waitlist "is it still
 * taken"). MUST match the status predicate of the `appointment_no_overlap` exclusion constraint.
 * PENDING_PAYMENT is a deposit hold: it blocks the slot but is NOT a confirmed booking.
 */
export const ACTIVE_APPOINTMENT_STATUSES = ['BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'] as const;

/**
 * Statuses that get reminders (email and WhatsApp). A PENDING_PAYMENT hold has none until the deposit is
 * paid: no booking email, no H24/H2.
 */
export const REMINDABLE_STATUSES = ['BOOKED', 'CONFIRMED'] as const;
