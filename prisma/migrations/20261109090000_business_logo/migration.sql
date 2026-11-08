-- Business logo: one processed 256x256 WebP per business, stored in Postgres (no third-party storage).
-- Additive only: a new table plus one index. No existing table is rewritten and no existing row changes.
-- It is a separate table so a Business query never loads image bytes. The image holds no personal data
-- (EXIF, GPS and ICC are removed before storing). appointment_no_overlap and the ReminderJob unique key are not touched.
-- CreateTable
CREATE TABLE "BusinessLogo" (
    "businessId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessLogo_pkey" PRIMARY KEY ("businessId")
);

-- CreateIndex
-- Popular-service demand (appointments created in the last 30 days) filters on (businessId, createdAt).
CREATE INDEX "Appointment_businessId_createdAt_idx" ON "Appointment"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessLogo" ADD CONSTRAINT "BusinessLogo_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
