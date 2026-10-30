-- Deposit (FR-26), step 2 of 2: a PENDING_PAYMENT hold blocks its slot exactly like a booking.
-- Same btree_gist definition as 20261028205918_appointment_no_overlap, one more active status.
-- The two statements run as ONE implicit transaction (a multi-statement script is a single simple query), so
-- the table is never without the guarantee. Existing rows are BOOKED/CONFIRMED/finished only; widening the
-- predicate cannot make any of them conflict, and the rebuilt index validates against all current rows.
ALTER TABLE "Appointment" DROP CONSTRAINT appointment_no_overlap;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startAt", "blockedUntil", '[)') WITH &&
  ) WHERE (status IN ('BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'));

-- The hold-expiry sweep scans only live holds.
CREATE INDEX "Appointment_pending_hold_idx" ON "Appointment" ("holdExpiresAt") WHERE "status" = 'PENDING_PAYMENT';
