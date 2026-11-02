-- F16: the contact email of THIS booking. Additive only: one nullable column, no default, no backfill and
-- no rewrite of existing rows (a metadata-only change in Postgres). appointment_no_overlap and the
-- ReminderJob (appointmentId, kind, channel) unique key are not touched.
-- Existing appointments keep NULL and fall back to Client.email at send time (effective recipient =
-- COALESCE(Appointment.contactEmail, Client.email)).
-- NFR-04: this is a personal-data column. Anonymising a client (DELETE /api/clients/{id}) sets it to NULL.
ALTER TABLE "Appointment" ADD COLUMN "contactEmail" TEXT;
