/*
  Warnings:

  - Made the column `freedFromAppointmentId` on table `WaitlistOffer` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "WaitlistOffer" DROP CONSTRAINT "WaitlistOffer_freedFromAppointmentId_fkey";

-- AlterTable
ALTER TABLE "WaitlistOffer" ALTER COLUMN "freedFromAppointmentId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_freedFromAppointmentId_fkey" FOREIGN KEY ("freedFromAppointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
