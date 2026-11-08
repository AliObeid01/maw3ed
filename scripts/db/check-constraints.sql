-- Fails loudly (non-zero exit with psql -v ON_ERROR_STOP=1) if a guarantee is missing.
-- Usage: psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/db/check-constraints.sql
-- Checks the schema on the connection's search_path (public by default).

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('appointment_no_overlap', 'appointment_end_after_start', 'appointment_blocked_after_end', 'workinghours_end_after_start')
  AND connamespace = current_schema()::regnamespace
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname IN ('ReminderJob_appointmentId_kind_channel_key', 'ReminderJob_pending_due_idx')
ORDER BY indexname;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointment_no_overlap' AND contype = 'x' AND connamespace = current_schema()::regnamespace
  ) THEN
    RAISE EXCEPTION 'MISSING: appointment_no_overlap exclusion constraint';
  END IF;

  -- Deposit holds block slots: the active-status predicate must be exactly BOOKED, CONFIRMED, PENDING_PAYMENT.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointment_no_overlap' AND contype = 'x' AND connamespace = current_schema()::regnamespace
      AND pg_get_constraintdef(oid) LIKE '%PENDING_PAYMENT%'
      AND pg_get_constraintdef(oid) LIKE '%BOOKED%'
      AND pg_get_constraintdef(oid) LIKE '%CONFIRMED%'
      AND pg_get_constraintdef(oid) LIKE '%"staffId" WITH =%'
  ) THEN
    RAISE EXCEPTION 'WRONG: appointment_no_overlap must cover BOOKED, CONFIRMED and PENDING_PAYMENT per staffId';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'ReminderJob_appointmentId_kind_channel_key'
  ) THEN
    RAISE EXCEPTION 'MISSING: ReminderJob_appointmentId_kind_channel_key unique index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'ReminderJob_pending_due_idx'
  ) THEN
    RAISE EXCEPTION 'MISSING: ReminderJob_pending_due_idx partial index';
  END IF;

  -- Staff login: partial unique indexes and the identity CHECK.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
      AND indexname = 'StaffMember_userId_businessId_key' AND indexdef LIKE '%WHERE ("userId" IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'MISSING: StaffMember_userId_businessId_key partial unique index';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
      AND indexname = 'ActivationToken_open_staff_key' AND indexdef LIKE '%WHERE ("usedAt" IS NULL)%'
  ) THEN
    RAISE EXCEPTION 'MISSING: ActivationToken_open_staff_key partial unique index';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_has_identity' AND connamespace = current_schema()::regnamespace
  ) THEN
    RAISE EXCEPTION 'MISSING: user_has_identity CHECK on User';
  END IF;

  -- Booking reference: the unique index the booking insert retries on (and the idempotency key stays separate).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
      AND indexname = 'Appointment_reference_key' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef ~ '\(("?)reference\1\)'
  ) THEN
    RAISE EXCEPTION 'MISSING: Appointment_reference_key unique index';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
      AND indexname = 'Appointment_businessId_idempotencyKey_key'
  ) THEN
    RAISE EXCEPTION 'MISSING: Appointment_businessId_idempotencyKey_key unique index';
  END IF;

  -- Business logo (PR-10b): its own table with the cascade, and the demand-count index.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'BusinessLogo_businessId_fkey' AND contype = 'f' AND confdeltype = 'c'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    RAISE EXCEPTION 'MISSING: BusinessLogo_businessId_fkey (ON DELETE CASCADE)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
      AND indexname = 'Appointment_businessId_createdAt_idx'
  ) THEN
    RAISE EXCEPTION 'MISSING: Appointment_businessId_createdAt_idx';
  END IF;

  RAISE NOTICE 'OK: appointment_no_overlap, reminder unique key, partial indexes, staff-login, reference and logo guarantees are present';
END $$;
