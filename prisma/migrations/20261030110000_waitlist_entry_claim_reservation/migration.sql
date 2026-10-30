-- Additive only: atomic reservation of a waitlist entry while one of its offers is being booked (F21).
ALTER TABLE "WaitlistEntry" ADD COLUMN "claimingOfferId" TEXT, ADD COLUMN "claimingAt" TIMESTAMPTZ(3);
