-- F68: a PUBLIC booking made less than 2 h before the slot gets neither H24 nor H2, so the receptionist would
-- never hear of it. It gets ONE WhatsApp row of this new kind, due at once, created with the booking.
-- Additive and idempotent. Nothing else changes: the unique key (appointmentId, kind, channel) already covers
-- the new value (one LATE per appointment and channel), the partial claim index only matches PENDING EMAIL
-- rows, and the appointment_no_overlap exclusion constraint is untouched.
-- The new value is not used in this migration (Postgres cannot use an enum value added in the same transaction).
ALTER TYPE "ReminderKind" ADD VALUE IF NOT EXISTS 'LATE';
