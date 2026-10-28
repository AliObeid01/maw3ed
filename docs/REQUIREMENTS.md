# Maw3ed — FR / NFR one-pager

Status: ⬜ not started · 🟨 in progress · ✅ done (tested) · ⏭ cut. Update this as tasks in `docs/PLAN.md` merge.

## Functional requirements
| ID | Area | Requirement (acceptance) | Prio | Task | Proof | Status |
|---|---|---|---|---|---|---|
| FR-01 | Workspace | Sign up with name, slug, timezone + owner account → workspace + setup checklist | Must | P1.7, P2.12 | `auth.signup.test.ts` | ⬜ |
| FR-02 | Auth | Email/password, Owner and Staff roles; owner invites staff by an expiring link | Must | P1.7–1.8 | `auth.*.test.ts`, `invites.test.ts` | ⬜ |
| FR-03 | Isolation | Everything scoped to the session's business; other business's IDs → 404 | Must | P1.4, P1.9 | `tenant.isolation.test.ts` | ⬜ |
| FR-04 | Setup | Services: name, duration, buffer, price, active | Must | P2.1 | `services.test.ts` | ⬜ |
| FR-05 | Setup | Staff and the services each performs | Must | P2.1 | `staff.test.ts` | ⬜ |
| FR-06 | Setup | Weekly hours, several intervals per day, dated time off | Must | P2.1 | `hours.test.ts` | ⬜ |
| FR-07 | Setup | Settings: timezone, slot step, window, min notice, cancel cutoff | Must | P2.1 | `business.test.ts` | ⬜ |
| FR-08 | Booking | `/b/{slug}`: service → staff/anyone → day → slot → details → booked, ≤ 4 phone screens | Must | P2.10 | `booking.spec.ts` (Pixel 5) | ⬜ |
| FR-09 | Booking | Slots = hours − appointments − buffers − time off; none past or inside min notice | Must | P1.5, P2.2 | `slots*.test.ts` | ⬜ |
| FR-10 | Booking | Concurrent requests for one slot: exactly one succeeds, rest 409 + fresh slots | Must | P2.3 | `booking.concurrency.test.ts` | ⬜ |
| FR-11 | Front desk | Staff book phone/walk-in through the same engine | Must | P2.3, P2.15 | `appointments.test.ts` | ⬜ |
| FR-12 | Booking | Confirmation email with confirm/cancel links + .ics | Should | P2.5 | `reminders.idempotency.test.ts` | ⬜ |
| FR-13 | Reminders | Email 24 h and 2 h before, with confirm/cancel links | Must | P2.4–2.5 | `reminders.*.test.ts` | ⬜ |
| FR-14 | Reminders | "Reminders due" list, one-tap WhatsApp, records who sent | Must | P2.7, P2.14 | `whatsapp.test.ts` | ⬜ |
| FR-15 | Reminders | Cancelled → no more reminders; < 24 h skips H24; < 2 h gets none | Must | P1.6, P2.3 | `reminderWindows.test.ts` | ⬜ |
| FR-16 | Reminders | Each appointment × kind × channel sent at most once (retries, overlap, crash) | Must | P2.4 | `reminders.idempotency.test.ts` | ⬜ |
| FR-17 | Links | Signed, one appointment, no sign-in, stop at start; after cutoff → late cancel | Must | P1.6, P2.6 | `links.test.ts`, `tokens.test.ts` | ⬜ |
| FR-18 | Waitlist | Join for service + date range (+ optional staff) | Must | P2.8, P2.11 | `waitlist.test.ts` | ⬜ |
| FR-19 | Waitlist | Freed slot offered by email; first claim wins via the same path; offer expires | Must | P2.8 | `waitlist.claim.test.ts` | ⬜ |
| FR-20 | Waitlist | Unclaimed offer cascades to next batch until too close | Should | P2.8 | `waitlist.claim.test.ts` | ⬜ |
| FR-21 | History | Mark Attended / No-show / Late cancel | Must | P3.1, P3.3 | `outcomes.test.ts`, `outcome.spec.ts` | ⬜ |
| FR-22 | History | Client record by phone with counts; repeat no-show badge on every booking | Must | P3.2–3.3 | `clients.test.ts` | ⬜ |
| FR-23 | History | "Mark outcome" queue for past appointments without an outcome | Should | P3.2–3.3 | `outcomes.test.ts` | ⬜ |
| FR-24 | Pilot | Baseline entry; weekly no-show rate vs baseline + confirm and refill rates | Must | P3.4–3.5 | `pilotMetrics.test.ts` | ⬜ |
| FR-25 | Pilot | CSV export of appointments and outcomes | Could | P3.6 | `export.test.ts` | ⬜ |
| FR-26 | Stretch | Deposit for past no-showers via Whish test env | Could | P3.9 | `deposit.test.ts` | ⬜ |
| FR-27 | Extra | Pricing page + test-mode checkout | Could | P3.8 | `billing.test.ts` | ⬜ |
| FR-28 | Extra | Arabic interface with RTL | Could | P3.7 | `booking.rtl.spec.ts` | ⬜ |

## Non-functional requirements
| ID | Area | Requirement | How verified | Status |
|---|---|---|---|---|
| NFR-01 | Tenant isolation | Repos take businessId from session; public routes resolve by slug | `tenant.isolation.test.ts` | ⬜ |
| NFR-02 | Validation | Zod on params/query/body, unknown fields rejected, 400 with fields | `validation.routes.test.ts` | ⬜ |
| NFR-03 | Security | argon2; httpOnly/Secure/Lax cookie; role checks in services; HMAC tokens per appointment + action | `guards.test.ts`, `tokens.test.ts` | ⬜ |
| NFR-04 | Privacy | Only name, phone, email, time, service, staff; no notes; client delete | Schema review; `clients.delete.test.ts` | ⬜ |
| NFR-05 | Phone first | 360 px first, ≥ 44 px targets, ≤ 4 booking screens, one-handed dashboard | Pixel 5 E2E, design-qa, Lighthouse a11y ≥ 90, real Android | ⬜ |
| NFR-06 | Time | UTC storage; business timezone; correct across DST | `slots.dst.test.ts` | ⬜ |
| NFR-07 | Concurrency | No overlap per staff, enforced by the DB | `booking.concurrency.test.ts`, `check-constraints.sql` | ⬜ |
| NFR-08 | Reminders | Job ≥ every 5 min; catch-up; never twice | `reminders.idempotency.test.ts`, cron history | ⬜ |
| NFR-09 | Performance | 14-day slots, 10 staff, < 300 ms p95 | `slots.load.test.ts` (non-blocking CI) | ⬜ |
| NFR-10 | Email limits | Fits Resend free tier; daily count, alert at 80 | job log | ⬜ |
| NFR-11 | Observability | Structured logs (businessId, requestId); provider message IDs; Sentry | demo | ⬜ |
| NFR-12 | i18n ready | All strings in message files; lint rule | ESLint `no-literal-string`, `check-keys.mjs` | ⬜ |

## Definition of done (review after 8 Nov)
See the `ship-check` skill for the evidence for each item.
