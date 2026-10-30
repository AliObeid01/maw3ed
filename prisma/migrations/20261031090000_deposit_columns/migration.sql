-- Deposit (FR-26), step 1 of 2. Additive only: no data is rewritten and no existing row changes behaviour.
-- A new enum value cannot be used in the transaction that adds it, so the constraint that mentions
-- PENDING_PAYMENT lives in the NEXT migration (20261031090100_deposit_overlap_constraint).
-- The enum label already exists (init migration); IF NOT EXISTS makes this a safe no-op there.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';

-- Deposits are OFF for every existing business.
ALTER TABLE "Business" ADD COLUMN "depositEnabled" BOOLEAN NOT NULL DEFAULT false;

-- When a PENDING_PAYMENT hold lapses. NULL for every other appointment.
ALTER TABLE "Appointment" ADD COLUMN "holdExpiresAt" TIMESTAMPTZ(3);
