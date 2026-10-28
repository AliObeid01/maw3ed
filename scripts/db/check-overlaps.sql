-- Nightly "zero double bookings" query. Must return zero rows.
-- Two active appointments for one staff member whose blocked ranges overlap.
SELECT a."staffId", a.id AS appointment_a, b.id AS appointment_b, a."startAt", a."blockedUntil"
FROM "Appointment" a
JOIN "Appointment" b
  ON a."staffId" = b."staffId"
 AND a.id < b.id
 AND tstzrange(a."startAt", a."blockedUntil", '[)') && tstzrange(b."startAt", b."blockedUntil", '[)')
WHERE a.status IN ('BOOKED', 'CONFIRMED')
  AND b.status IN ('BOOKED', 'CONFIRMED');
