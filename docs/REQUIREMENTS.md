# Maw3ed — FR / NFR one-pager

Status: ⬜ not started / no proof · 🟨 partial proof · ✅ done (a test genuinely proves it) · ⏭ cut. Update this as tasks in `docs/PLAN.md` merge.
Proof paths are relative to `tests/` (`int/` = `tests/integration`, `unit/` = `tests/unit`, `e2e/` = `tests/e2e`). Audit of 30 Oct 2026 (P3.10).

## Functional requirements
| ID | Area | Requirement (acceptance) | Prio | Task | Proof | Status |
|---|---|---|---|---|---|---|
| FR-01 | Workspace | Sign up with name, slug, timezone + owner account → workspace + setup checklist | Must | P1.7, P2.12 | `int/auth.test.ts`, `int/journey.smoke.test.ts`, `e2e/auth.spec.ts` | ✅ |
| FR-02 | Auth | Email/password, Owner and Staff roles; owner invites staff by an expiring link | Must | P1.7–1.8 | `int/auth.test.ts`, `int/invites.test.ts` | ✅ |
| FR-03 | Isolation | Everything scoped to the session's business; other business's IDs → 404 | Must | P1.4, P1.9 | `int/tenant.isolation.test.ts` | ✅ |
| FR-04 | Setup | Services: name, duration, buffer, price, active | Must | P2.1 | `int/setup.test.ts`, `int/setup.hardening.test.ts`, `unit/setup.services.test.ts` | ✅ |
| FR-05 | Setup | Staff and the services each performs | Must | P2.1 | `int/setup.test.ts`, `int/setup.hardening.test.ts` | ✅ |
| FR-06 | Setup | Weekly hours, several intervals per day, dated time off | Must | P2.1 | `int/setup.test.ts`, `unit/hours.test.ts`, `unit/setup/hours.test.ts` | ✅ |
| FR-07 | Setup | Settings: timezone, slot step, window, min notice, cancel cutoff | Must | P2.1 | `int/setup.test.ts` (business), `unit/setup/settingsForm.test.ts` | ✅ |
| FR-08 | Booking | `/b/{slug}`: service → staff/anyone → day → slot → details → booked, ≤ 4 phone screens | Must | P2.10 | `e2e/booking.spec.ts` (Pixel 5, mocked API), `int/booking.flow.test.ts`, `int/journey.smoke.test.ts` (real API) | ✅ |
| FR-09 | Booking | Slots = hours − appointments − buffers − time off; none past or inside min notice | Must | P1.5, P2.2 | `unit/slots.test.ts`, `unit/booking/slots.equivalence.test.ts`, `int/public.read.test.ts` | ✅ |
| FR-10 | Booking | Concurrent requests for one slot: exactly one succeeds, rest 409 + fresh slots | Must | P2.3 | `int/booking.concurrency.test.ts` | ✅ |
| FR-11 | Front desk | Staff book phone/walk-in through the same engine | Must | P2.3, P2.15 | `int/appointments.test.ts`, `e2e/dashboard/frontdesk.spec.ts` | ✅ |
| FR-12 | Booking | Confirmation email with confirm/cancel links + .ics | Should | P2.5 | `int/reminders.idempotency.test.ts`, `int/journey.smoke.test.ts`, `unit/reminders/ics.test.ts` | ✅ |
| FR-13 | Reminders | Email 24 h and 2 h before, with confirm/cancel links | Must | P2.4–2.5 | `int/reminders.idempotency.test.ts`, `int/journey.smoke.test.ts` | ✅ |
| FR-14 | Reminders | "Reminders due" list, one-tap WhatsApp, records who sent | Must | P2.7, P2.14 | `int/whatsapp.test.ts`, `e2e/dashboard/reminders.spec.ts` | ✅ |
| FR-15 | Reminders | Cancelled → no more reminders; < 24 h skips H24; < 2 h gets none | Must | P1.6, P2.3 | `unit/reminderWindows.test.ts`, `int/reminders.idempotency.test.ts` | ✅ |
| FR-16 | Reminders | Each appointment × kind × channel sent at most once (retries, overlap, crash) | Must | P2.4 | `int/reminders.idempotency.test.ts`, `int/reminders.hardening.test.ts` | ✅ |
| FR-17 | Links | Signed, one appointment, no sign-in, stop at start; after cutoff → late cancel | Must | P1.6, P2.6 | `int/links.test.ts`, `unit/tokens.test.ts`, `int/journey.smoke.test.ts` | ✅ |
| FR-18 | Waitlist | Join for service + date range (+ optional staff) | Must | P2.8, P2.11 | `int/waitlist.test.ts`, `e2e/waitlist.spec.ts` | ✅ |
| FR-19 | Waitlist | Freed slot offered by email; first claim wins via the same path; offer expires | Must | P2.8 | `int/waitlist.claim.test.ts`, `int/waitlist.hardening.test.ts` | ✅ |
| FR-20 | Waitlist | Unclaimed offer cascades to next batch until too close | Should | P2.8 | `int/waitlist.claim.test.ts` | ✅ |
| FR-21 | History | Mark Attended / No-show / Late cancel (idempotent re-mark, counters adjust) | Must | P3.1, P3.3 | `int/outcomes.test.ts`, `e2e/dashboard/outcomes.spec.ts` (the planned `outcome.spec.ts`) | ✅ |
| FR-22 | History | Client record by phone with counts; repeat no-show badge on every booking | Must | P3.2–3.3 | `int/clients.test.ts`, `e2e/dashboard/clients.spec.ts`, `e2e/dashboard/clientHistory.spec.ts` | ✅ |
| FR-23 | History | "Mark outcome" queue for past appointments without an outcome | Should | P3.2–3.3 | `int/outcomes.test.ts` (queue), `e2e/dashboard/outcomes.spec.ts` | ✅ |
| FR-24 | Pilot | Baseline entry; weekly no-show rate vs baseline + confirm and refill rates | Must | P3.4–3.5 | `int/pilot.test.ts` (exact weekly/pilot maths, DST week, PENDING_PAYMENT excluded, tenant scoped), `unit/outcomes/pilotMetrics.test.ts`. Deposit holds are excluded and not counted as confirmations: `int/deposit.test.ts` | ✅ |
| FR-25 | Pilot | CSV export of appointments and outcomes | Could | P3.6 | `int/pilot.test.ts` (header/BOM, escaping, formula neutralising, range, owner only, tenant scoped), `unit/pilot/csv.test.ts` | ✅ |
| FR-26 | Stretch | Deposit for past no-showers via Whish test env | Could | P3.9 | `int/deposit.test.ts` (settings, hold 15 min, parallel bookings one winner, idempotent pay, pay vs expiry race, expiry job cancels + offers to waitlist, paid deposit stays BOOKED with no confirmedAt so it is not a client confirmation, tenant scoping), `int/deposit.migration.test.ts` (constraint covers PENDING_PAYMENT), `e2e/deposit.spec.ts`. Whish itself is not tested (fake provider only) | ✅ |
| FR-27 | Extra | Pricing page + test-mode checkout | Could | P3.8 | `int/billing.test.ts` (checkout, downgrade, Free staff limit), `e2e/dashboard/pricing.spec.ts` | ✅ |
| FR-28 | Extra | Arabic interface with RTL | Could | P3.7 | `e2e/booking.rtl.spec.ts`, `e2e/dashboard/shell.rtl.spec.ts`, `unit/reminders/emailTemplates.locale.test.ts`, `unit/businessLocale.test.ts` | ✅ |

## Non-functional requirements
| ID | Area | Requirement | How verified | Status |
|---|---|---|---|---|
| NFR-01 | Tenant isolation | Repos take businessId from session; public routes resolve by slug | `int/tenant.isolation.test.ts`, cross-tenant 404 in each route test | ✅ |
| NFR-02 | Validation | Zod on params/query/body, unknown fields rejected, 400 with fields | `int/validation.routes.test.ts` (walks the OpenAPI registry: unknown body field, non-object body, unknown query param on every operation) | ✅ |
| NFR-03 | Security | argon2; httpOnly/Secure/Lax cookie; role checks in services; HMAC tokens per appointment + action | `unit/password.test.ts`, `unit/session.guard.test.ts`, `int/auth.test.ts`, `unit/tokens.test.ts`, STAFF 403 cases in `int/pilot.test.ts` / `int/clients.test.ts` | ✅ |
| NFR-04 | Privacy | Only name, phone, email, time, service, staff; no notes; client delete | `int/privacy.schema.test.ts` (exact column lists on the migrated DB, no note/comment column anywhere), `int/clients.test.ts` (DELETE anonymises, no personal data left in any table) | ✅ |
| NFR-05 | Phone first | 360 px first, ≥ 44 px targets, ≤ 4 booking screens, one-handed dashboard | Pixel 5 E2E (44 px asserted in `e2e/dashboard/outcomes.spec.ts`, `e2e/booking.spec.ts`); Lighthouse a11y and real Android still manual (P4.1) | 🟨 |
| NFR-06 | Time | UTC storage; business timezone; correct across DST | `unit/slots.test.ts` (Asia/Beirut spring/autumn transitions), DST night in `int/pilot.test.ts` CSV and week boundaries. No file named `slots.dst.test.ts` | ✅ |
| NFR-07 | Concurrency | No overlap per staff, enforced by the DB | `int/booking.concurrency.test.ts`, `int/appointment.overlap.test.ts`, `scripts/db/check-constraints.sql` | ✅ |
| NFR-08 | Reminders | Job ≥ every 5 min; catch-up; never twice | Never twice and catch-up: `int/reminders.idempotency.test.ts`. The 5-minute cadence is scheduler config (`.github/workflows/reminders-backup.yml`, cron-job.org), not tested | 🟨 |
| NFR-09 | Performance | 14-day slots, 10 staff, < 300 ms p95 | Domain only: `unit/booking/slots.load.test.ts` (opt-in `RUN_PERF=1`). End to end: `scripts/load/slots-load.mjs` via `.github/workflows/load.yml` (non-blocking, nightly). Local production build (30 Oct, 10 staff, 14 days): concurrency 1 p50 126 ms, p95 150 ms, max 286 ms (within budget); concurrency 10 p50 2.2 s, p95 6.2 s, max 11.8 s, no 5xx (over budget under parallel load, see PR #38) | 🟨 |
| NFR-10 | Email limits | Fits Resend free tier; daily count, alert at 80 | Daily cap and parking on rate limit in `int/reminders.idempotency.test.ts` / `int/reminders.hardening.test.ts`; alert at 80 % not proven | 🟨 |
| NFR-11 | Observability | Structured logs (businessId, requestId); provider message IDs; Sentry | requestId and providerMessageId asserted in `int/booking.hardening.test.ts`, `int/reminders.idempotency.test.ts`; Sentry is demo only | 🟨 |
| NFR-12 | i18n ready | All strings in message files; lint rule | ESLint `no-literal-string` and `scripts/i18n/check-keys.mjs`, both run in CI | ✅ |

## Definition of done (review after 8 Nov)
See the `ship-check` skill for the evidence for each item.
