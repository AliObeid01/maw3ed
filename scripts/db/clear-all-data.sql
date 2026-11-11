-- Maw3ed: CLEAR ALL APP DATA (businesses, users, clients, appointments, everything).
-- IRREVERSIBLE once committed. Take a Neon branch backup first (see the steps given by Claude).
--
-- HOW TO RUN (psql shows every result, the Neon SQL editor may show only the last one, so prefer psql):
--   psql "<DIRECT_URL of the production branch>" -f 2-clear-all-data.sql
-- The script ends with ROLLBACK on purpose = DRY RUN: it really deletes inside a transaction, shows you
-- the counts AFTER the delete, then undoes everything. When the numbers are what you expect, change the LAST
-- line from ROLLBACK to COMMIT and run it again.
--
-- What it keeps: the migration history table (_prisma_migrations), every table structure, the
-- appointment_no_overlap exclusion constraint, the btree_gist extension, enums, indexes.
-- What it removes: every row in every app table (CASCADE follows the foreign keys from Business and User).

\set ON_ERROR_STOP on

BEGIN;

-- Fail fast instead of waiting behind a long-running query (Neon pooled connections).
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Safety rail 1: refuse to run against the wrong database by showing where you are.
SELECT current_database() AS database, inet_server_addr() AS server, now() AS at;

-- Safety rail 2: the protected objects must exist BEFORE the delete.
SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'appointment_no_overlap') AS overlap_constraint_before,
       (SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist')               AS btree_gist_before,
       (SELECT count(*) FROM "_prisma_migrations")                                   AS migrations_before;

-- The delete. "Business" and "User" are the two roots; CASCADE also empties every table that points at them
-- (logos, sessions, memberships, invites, staff, activation tokens, services, hours, time off, clients,
-- appointments, reminder jobs, waitlist entries and offers, pilot baseline, payments, email tokens).
-- RateLimitBucket and OAuthClient (dynamic OAuth clients of the owner connector) have no foreign key, so they are listed explicitly.
TRUNCATE TABLE "Business", "User", "RateLimitBucket", "OAuthClient" RESTART IDENTITY CASCADE;

-- Counts AFTER the delete: every app row must be 0, migrations must be unchanged.
SELECT 'Business'        AS "table", count(*) AS rows FROM "Business"
UNION ALL SELECT 'BusinessLogo',    count(*) FROM "BusinessLogo"
UNION ALL SELECT 'User',            count(*) FROM "User"
UNION ALL SELECT 'EmailToken',      count(*) FROM "EmailToken"
UNION ALL SELECT 'Session',         count(*) FROM "Session"
UNION ALL SELECT 'Membership',      count(*) FROM "Membership"
UNION ALL SELECT 'Invite',          count(*) FROM "Invite"
UNION ALL SELECT 'StaffMember',     count(*) FROM "StaffMember"
UNION ALL SELECT 'ActivationToken', count(*) FROM "ActivationToken"
UNION ALL SELECT 'Service',         count(*) FROM "Service"
UNION ALL SELECT 'StaffService',    count(*) FROM "StaffService"
UNION ALL SELECT 'WorkingHours',    count(*) FROM "WorkingHours"
UNION ALL SELECT 'TimeOff',         count(*) FROM "TimeOff"
UNION ALL SELECT 'Client',          count(*) FROM "Client"
UNION ALL SELECT 'Appointment',     count(*) FROM "Appointment"
UNION ALL SELECT 'ReminderJob',     count(*) FROM "ReminderJob"
UNION ALL SELECT 'WaitlistEntry',   count(*) FROM "WaitlistEntry"
UNION ALL SELECT 'WaitlistOffer',   count(*) FROM "WaitlistOffer"
UNION ALL SELECT 'PilotBaseline',   count(*) FROM "PilotBaseline"
UNION ALL SELECT 'Payment',         count(*) FROM "Payment"
UNION ALL SELECT 'OAuthClient',     count(*) FROM "OAuthClient"
UNION ALL SELECT 'OAuthAuthorizationCode', count(*) FROM "OAuthAuthorizationCode"
UNION ALL SELECT 'OAuthGrant',      count(*) FROM "OAuthGrant"
UNION ALL SELECT 'OAuthAccessToken', count(*) FROM "OAuthAccessToken"
UNION ALL SELECT 'OAuthRefreshToken', count(*) FROM "OAuthRefreshToken"
UNION ALL SELECT 'McpPlan',         count(*) FROM "McpPlan"
UNION ALL SELECT 'McpAuditLog',     count(*) FROM "McpAuditLog"
UNION ALL SELECT 'RateLimitBucket', count(*) FROM "RateLimitBucket"
UNION ALL SELECT '(_prisma_migrations: kept)', count(*) FROM "_prisma_migrations"
ORDER BY 1;

-- Protected objects must STILL exist after the delete.
SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'appointment_no_overlap') AS overlap_constraint_after,
       (SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist')               AS btree_gist_after,
       (SELECT count(*) FROM "_prisma_migrations")                                   AS migrations_after;

-- DRY RUN by default. After checking the numbers above, change ROLLBACK to COMMIT and run the script again.
ROLLBACK;
