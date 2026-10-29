-- Additive only: the appointment_no_overlap exclusion constraint and every unique key are untouched.
ALTER TABLE "WaitlistEntry" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "WaitlistOffer" ADD COLUMN "emailedAt" TIMESTAMPTZ(3);

-- Expiry cron: find OPEN offers past their expiry, or OPEN unsent ones, without scanning the table.
CREATE INDEX "WaitlistOffer_open_expiresAt_idx" ON "WaitlistOffer" ("status", "expiresAt") WHERE "status" = 'OPEN';
