-- Booking reference: a short human-readable code on each appointment. Additive and safe on the populated table.
-- Nullable: existing rows keep NULL (never backfilled). A unique index allows many NULLs, so no rewrite and no lock-heavy step.
-- appointment_no_overlap, the idempotency key and the ReminderJob unique key are not touched.
ALTER TABLE "Appointment" ADD COLUMN "reference" TEXT;

CREATE UNIQUE INDEX "Appointment_reference_key" ON "Appointment"("reference");
