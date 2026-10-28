-- Hand-written: things Prisma cannot express. NEVER remove, rename or narrow appointment_no_overlap
-- or the ReminderJob (appointmentId, kind, channel) unique index (created in the init migration).
-- When deposits land, add a NEW migration that drops and re-creates the constraint including 'PENDING_PAYMENT'.

-- Guarantee 1: no double booking. blockedUntil = endAt + service buffer, written by the booking service.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startAt", "blockedUntil", '[)') WITH &&
  ) WHERE (status IN ('BOOKED', 'CONFIRMED'));

-- Sanity checks
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_end_after_start CHECK ("endAt" > "startAt"),
  ADD CONSTRAINT appointment_blocked_after_end CHECK ("blockedUntil" >= "endAt");

ALTER TABLE "WorkingHours"
  ADD CONSTRAINT workinghours_weekday_range CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT workinghours_end_after_start CHECK ("endLocal" > "startLocal");

ALTER TABLE "TimeOff"
  ADD CONSTRAINT timeoff_end_after_start CHECK ("endAt" > "startAt");

ALTER TABLE "Client"
  ADD CONSTRAINT client_counters_non_negative CHECK ("attended" >= 0 AND "noShows" >= 0 AND "lateCancels" >= 0);

-- Reminder claim: UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) scans PENDING rows by dueAt.
CREATE INDEX "ReminderJob_pending_due_idx" ON "ReminderJob" ("status", "dueAt") WHERE "status" = 'PENDING';
