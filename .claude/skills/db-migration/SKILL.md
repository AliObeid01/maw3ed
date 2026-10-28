---
name: db-migration
description: Use when changing the Maw3ed Prisma schema or writing a migration, especially anything touching Appointment status, the appointment_no_overlap exclusion constraint, ReminderJob uniqueness, or raw SQL. Covers hand-written SQL migrations, Neon connection URLs, and verifying constraints survive a reset.
---

# Maw3ed database migrations

## Rules
- Always `pnpm prisma migrate dev --name <change>`. **Never** `prisma db push`: it would drop the hand-written constraint.
- Every tenant table has `businessId` and its indexes start with `businessId` (`@@index([businessId, ...])`).
- No free-text notes columns (NFR-04). Timestamps are `DateTime @db.Timestamptz(3)`, stored in UTC.
- Money is `Decimal @db.Decimal(10,2)`. Phones are E.164 strings.
- Services and staff are soft-deactivated (`active=false`), never deleted.

## Things Prisma cannot express → `--create-only`, then edit the SQL
```bash
pnpm prisma migrate dev --create-only --name appointment_no_overlap
# edit prisma/migrations/<ts>_appointment_no_overlap/migration.sql, then:
pnpm prisma migrate dev
```
The no-overlap constraint (PRD §Engineering heart 2):
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startAt", "blockedUntil", '[)') WITH &&
  ) WHERE (status IN ('BOOKED', 'CONFIRMED'));
```
`blockedUntil = endAt + bufferMin`, written by the booking service. When the deposit feature lands, write a **new**
migration that drops and re-creates the constraint with `('BOOKED','CONFIRMED','PENDING_PAYMENT')`. Never edit an applied migration.

Other hand-written pieces worth keeping in SQL:
- Partial index for the reminder claim: `CREATE INDEX ON "ReminderJob" (status, "dueAt") WHERE status = 'PENDING';`
- `CHECK ("endAt" > "startAt")` and `CHECK ("blockedUntil" >= "endAt")` on Appointment.

## Verify after every migration and reset
```bash
pnpm prisma migrate reset --force   # local only
psql "$DATABASE_URL" -f scripts/db/check-constraints.sql   # must list appointment_no_overlap
pnpm test:int -- booking.concurrency
```
`scripts/db/check-constraints.sql` queries `pg_constraint` for `appointment_no_overlap` (contype `x`) and the
`ReminderJob_appointmentId_kind_channel_key` unique index, and fails loudly if either is missing.
`scripts/db/check-overlaps.sql` is the nightly "zero double bookings" query.

## Neon
- `DATABASE_URL` = pooled connection (`-pooler` host, `?sslmode=require&pgbouncer=true&connection_limit=1` on serverless).
- `DIRECT_URL` = direct host, used by `prisma migrate` (`directUrl = env("DIRECT_URL")` in the datasource).
- `btree_gist` is available on Neon; the migration enables it.
- CI uses a `postgres:16` service container. Production migrations run in the deploy workflow (`prisma migrate deploy`) before the Vercel deploy.

## Raw SQL
Use `prisma.$queryRaw` tagged templates (parameterised), never string concatenation. Raw queries live in repositories only.
The reminder claim:
```sql
UPDATE "ReminderJob" SET status = 'SENDING', "lockedAt" = now(), attempts = attempts + 1
WHERE id IN (
  SELECT id FROM "ReminderJob"
  WHERE status = 'PENDING' AND channel = 'EMAIL' AND "dueAt" <= now()
    AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
  ORDER BY "dueAt" LIMIT 50
  FOR UPDATE SKIP LOCKED)
RETURNING *;
```
Stuck rows (`SENDING` with `lockedAt` older than 10 minutes) are re-queued to `PENDING`. The retry reuses the job id as the idempotency key, so it is safe.
