-- F16: the contact email and name of THIS booking. Additive only: two nullable columns, no default, no
-- backfill and no rewrite of existing rows (a metadata-only change in Postgres). appointment_no_overlap and
-- the ReminderJob (appointmentId, kind, channel) unique key are not touched.
-- Existing appointments keep NULL and fall back to Client.email / Client.name at send time (effective
-- recipient = COALESCE(Appointment.contactEmail, Client.email)); the record name is only ever used for mail
-- that goes to the record email.
-- NFR-04: both are personal-data columns. Anonymising a client (DELETE /api/clients/{id}) sets them to NULL.
ALTER TABLE "Appointment" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "contactName" TEXT;
