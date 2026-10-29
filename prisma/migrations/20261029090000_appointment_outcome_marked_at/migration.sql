-- AlterTable: when a staff member recorded the outcome (attended / no-show / late cancel). Nullable, no free text.
ALTER TABLE "Appointment" ADD COLUMN "outcomeMarkedAt" TIMESTAMPTZ(3);
