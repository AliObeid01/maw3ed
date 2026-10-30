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

  RAISE NOTICE 'OK: appointment_no_overlap, reminder unique key and partial index are present';
END $$;
