# Maw3ed ship check (P4.4, machine-checkable part)

- Date: Mon 2 Nov 2026 (local clock of the machine that ran it, Beirut time; evening).
- Commit checked: `2b72c555edd69fe8ad8dda96e988b3248e1ddaa0` (`origin/main`, "feat: staff-only 'Reminders go to' line, review follow-ups F55 to F60 (#65)"), fresh worktree, `pnpm install --frozen-lockfile`.
- Database used locally: the Docker Postgres 16 container `maw3ed-db-1` (localhost:5432, healthy). Integration tests ran in a private schema `itest_ship` of `maw3ed_test`; the migration steps ran on a FRESH scratch database `maw3ed_ship_scratch` (dropped afterwards). Neon, Vercel and Sentry were not touched.
- Rule followed: every number below comes from a command run in this session. Failures are reported as failures.

## 1. Pipeline

| Step | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | "Already up to date", done in 711 ms |
| `pnpm prisma migrate deploy` on a fresh database | PASS | 12 migrations applied ("All migrations have been successfully applied"): init, appointment_no_overlap, waitlist_offer_freed_required, appointment_outcome_marked_at, waitlist_contact_email, rate_limit_bucket, business_listed, waitlist_entry_claim_reservation, deposit_columns, deposit_overlap_constraint, email_verification, appointment_contact_email |
| `scripts/db/check-constraints.sql` | PASS | No `psql` on this machine, so run through `scripts/db/run-sql.ts` (a node/pg stand-in that runs the same file). Output: `NOTICE: OK: appointment_no_overlap, reminder unique key and partial index are present`; `appointment_no_overlap` is `EXCLUDE USING gist ("staffId" WITH =, tstzrange("startAt","blockedUntil",'[)') WITH &&) WHERE status IN (BOOKED, CONFIRMED, PENDING_PAYMENT)`; unique index `ReminderJob_appointmentId_kind_channel_key` and partial index `ReminderJob_pending_due_idx` present |
| `scripts/db/check-overlaps.sql` | PASS | Same runner: 0 rows (no overlapping active appointments) |
| `pnpm lint` | PASS | `eslint .` exit 0, no output |
| `pnpm typecheck` | PASS | `tsc --noEmit` exit 0 |
| `pnpm test:unit` | PASS | 121 files; 1236 passed, 1 skipped (the opt-in `RUN_PERF=1` load test), 1237 total; 50.3 s |
| `pnpm test:int` (full suite, once) | PASS WITH ONE ENVIRONMENT CAVEAT | 48 files, 836 tests, 471.7 s. First run on a bare checkout: 47 files passed, 1 failed: `tests/integration/cleanup.test.ts`, 2 tests ("400 on unknown query parameters" got 401, "200 with counts" got 401) because the file reads `CRON_SECRET` from the environment and `tests/integration/helpers/env.ts` does not set it (CI sets it). 834 passed, 2 failed. Re-run of that file with `CRON_SECRET=ci-only-cron-secret-0000000000000000` exported (the CI value): 7 of 7 passed (4.1 s). So 836 of 836 pass in a CI-like environment. This is a test hygiene gap, not a product defect: tracked as F61 in `docs/PLAN.md`, NOT fixed here (docs-only PR) |
| `pnpm build` | PASS | `next build` (Next.js 16.4.3, Turbopack) compiled in 41 s, TypeScript 52 s, whole build 116 s; 94 route entries (61 `/api` routes, 33 pages and others); no warnings or errors in the output; `clean-sourcemaps` removed 692 map files |
| `pnpm openapi:check` | PASS | "openapi.json is up to date"; 61 paths, 72 operations |
| `node scripts/i18n/check-keys.mjs` | PASS | "i18n keys match (1346 keys); placeholders and plurals consistent" |
| `playwright test --list` | 778 tests in 33 files | mobile (Pixel 5, public specs) 187 in 15 files; desktop (Desktop Chrome, public specs) 187 in 15 files; dashboard-mobile (Pixel 5) 202 in 18 files; dashboard-desktop 202 in 18 files. Not run locally by design: CI runs it |
| Latest CI on `main` | PASS | `gh run list --branch main --workflow CI --limit 5`: five runs, all `completed success`: 41469419576 (#65, 10m35s), 41458708235 (#64, 10m15s), 41455774970 (#61, 10m2s), 41452694966 (#63, 9m34s), 41446057554 (#62, 7m5s). URL pattern `https://github.com/AliObeid01/maw3ed/actions/runs/<id>` |
| Fresh CI re-run of the newest main run (`gh run rerun 41469419576`) | PASS: checks, e2e (1/2), e2e (2/2) all success (section 1a) | https://github.com/AliObeid01/maw3ed/actions/runs/41469419576 |
| `pnpm audit --prod` | 0 high, 0 critical; 2 moderate | `minimatch` (<11.0.1, ReDoS via globparts, GHSA-g3hv-75wg-m249) and `glob` (>=9 <=14.0.1, AbortSignal bypass, GHSA-3g3m-2fjr-6pw4), both only through `@sentry/nextjs > @sentry/bundler-plugins`. Reachable? Only at BUILD time, in Sentry's source map upload plugin globbing our own build output; neither runs in the deployed app and neither takes user input. Nothing upgraded |
| Secret scan of tracked files | PASS | `git ls-files` contains only `.env.example` (variable names, no values); no `.pem`, `.key` or credential files. Patterns searched in all tracked files except the lockfile: `re_[A-Za-z0-9]{20,}`, `sk_live`, `sk_test_`, `ghp_`, `AKIA`, private key headers, `SENTRY_AUTH_TOKEN=<value>`, `*_SECRET/_KEY/_TOKEN/PASSWORD = <32+ chars>` outside tests, any `postgres://user:pass@host` other than `maw3ed:maw3ed@localhost`: zero real findings. Matches were all FAKE test values: `tests/unit/db.ssl.test.ts`, `tests/unit/productionEnv.test.ts`, `tests/unit/observability/sourcemapUpload.test.ts` (`postgresql://u:p@ep-x...neon.tech/db`, `pw-secret`), and the word "neon.tech" in prose in `docs/HUMAN_TASKS.md`. CI uses throwaway `ci-only-*` values |

### 1a. Fresh CI re-run (run 41469419576, `gh run rerun`, watched with `gh run watch --exit-status`, exit 0)

| Job | Conclusion | Started to completed (UTC) |
|---|---|---|
| checks | success | 19:15:08 to 19:20:34 |
| e2e (1/2) | success | 19:15:08 to 19:20:54 |
| e2e (2/2) | success | 19:15:09 to 19:26:11 |

Run conclusion: success. The e2e (1/2) log shows "195 passed (3.1m)" for the mobile projects and "17 passed" for the dashboard shell at desktop width. URL: https://github.com/AliObeid01/maw3ed/actions/runs/41469419576

Note on what CI covers: the e2e job runs `--project=mobile --project=dashboard-mobile` (sharded 2 ways) plus `shell.spec.ts` on `dashboard-desktop`. The `desktop` public project (187 tests) and the rest of `dashboard-desktop` (202 tests listed, `shell.spec.ts` is the part CI runs) exist but are outside the CI gate; they were not run in this ship-check either.

## 2. Production checks (read-only, https://maw3edlb.com, 2 Nov 2026)

| Check | Result |
|---|---|
| `GET /api/health` | `{"status":"ok","db":"up"}` |
| `node scripts/check-security-headers.mjs https://maw3edlb.com` | PASS on every line, ending "All checks passed": CSP (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, no wildcard, `upgrade-insecure-requests`), `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy, COOP same-origin, no `X-Powered-By`, HSTS from Vercel, `no-referrer` and `no-store` on a token route, `/api/health` headers, a different nonce on each of two loads. 0 FAIL lines |
| `GET /`, `/directory`, `/pricing`, `/login`, `/signup`, `/forgot-password` | HTTP 200 each, `Content-Type: text/html; charset=utf-8`, per-request nonce CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cache-Control: private, no-cache, no-store` |
| Booking page | `docs/` documents no public production slug (`studio-nour` is only the pilot-playbook example, and `GET /api/public/studio-nour` is 404 on production; `test-f26` is the owner's manual test business). The only public business is the one the directory lists, so `GET /b/nour-beaty` was checked: HTTP 200 and `GET /api/public/nour-beaty` HTTP 200. No booking was made |
| `GET /api/public/directory` | `{"businesses":[{"slug":"nour-beaty","name":"Nour Beaty","category":null,"address":null,"serviceCount":1,"fromPrice":20}],"nextCursor":null}` (one listed business) |
| `POST /api/jobs/reminders` with no secret | HTTP 401, body `{"error":{"code":"UNAUTHENTICATED","message":"Invalid cron secret.","fields":{}}}`. No secret was sent |
| 404 page | `GET /this-page-does-not-exist` returns HTTP 404 with the branded page: header (Maw3ed, Find a business, For businesses, Pricing, language toggle, Business sign in), "We can't find that page", "The link may be old or mistyped. Head back to the start and try again.", a "Go to Maw3ed" link and the "Bookings by Maw3ed" footer |

No data was created and no mutating endpoint was called other than the unauthenticated 401 probe.

## 3. Definition of done (PRD, 8 Nov), item by item

| DoD item | Status | Evidence |
|---|---|---|
| Live at a public URL, deployed by CI that runs tests on every PR | DONE | https://maw3edlb.com (health ok, section 2). Latest green Actions run on main: https://github.com/AliObeid01/maw3ed/actions/runs/41469419576 (and four earlier green runs, section 1). Workflows: `.github/workflows/ci.yml` (checks, e2e 1/2, e2e 2/2 on every PR and push), `reminders-backup.yml`, `load.yml`. Production is deployed by Vercel from main (`scripts/vercel-build.mjs` runs `prisma migrate deploy` first); there is no separate deploy workflow file |
| Route handlers in TS + Prisma; repository layer separate from services; validation on every route | DONE | 61 route files under `src/app/api`, repositories in `src/server/repositories` (the only importers of Prisma, enforced by an ESLint `import/no-restricted-paths` rule, lint passes). `tests/integration/validation.routes.test.ts` (72 tests, all pass) walks the OpenAPI registry: it asserts that all 72 operations in `openapi.json` map to a route file, sends an unknown body field and a non-object body to all 27 operations that take a body, and an unknown query parameter to all 17 operations with query parameters or the cron secret; each must answer 400 `VALIDATION_FAILED` with `fields`. The other 28 operations take only path parameters or nothing, so they have no body or query to reject (path parameters are not walked by this file) |
| Any business can sign up to its own workspace; a test proves one cannot read another's data | DONE | `tests/integration/tenant.isolation.test.ts`, 17 tests, pass. Entities: appointments (GET, cancel, outcome PATCH; no PATCH or DELETE route exists for appointments), clients (GET, list, DELETE), services (PATCH, list), staff (list, PATCH, services, hours, time off), outcomes queue, dashboard summaries, pilot baseline, report and CSV export, invites, sessions, `/api/me`, and booking with another business's service or staff id. Cross-tenant ids answer 404. Signup: `tests/integration/auth.test.ts`, `journey.smoke.test.ts` |
| Sign-in with Owner and Staff roles | DONE | Role tests: `tests/unit/session.guard.test.ts`, `tests/integration/auth.test.ts`, `invites.test.ts`, `team.test.ts`, `setup.hardening.test.ts`, `clients.test.ts`, `pilot.test.ts`, `outcomes.test.ts`, `billing.test.ts`, `deposit.test.ts`, `emailVerification.test.ts`, `tests/unit/team/teamAccess.test.ts` (STAFF gets 403 on owner-only routes) |
| Comfortable on a phone | DONE, with owner-measured Lighthouse | Playwright Pixel 5: `mobile` project 187 tests in 15 files (public) and `dashboard-mobile` 202 tests in 18 files; CI runs both on every PR (run above, `e2e (1/2)` and `e2e (2/2)`). Design QA reports: `docs/DESIGN_QA.md` and `docs/DESIGN_QA_ROUND2.md`. Lighthouse mobile accessibility: 100 on `/b/<slug>`, `/app` and `/app/reminders`, MEASURED BY THE OWNER on 1 Nov; 100 on `/`, `/pricing`, `/directory` measured by an agent (per the task brief; note `docs/DESIGN_QA_ROUND2.md` itself records `/` and `/pricing` at 100 and says the `/directory` run did not finish). Cited, not re-measured here. Caveat: the Pixel 5 dashboard and booking specs mock the API; the real-stack browser journey is `tests/e2e/waitlistJourney.spec.ts` |
| README (setup, architecture, key decisions), FR/NFR one-pager, ERD, OpenAPI contract | DONE | `README.md`; `docs/REQUIREMENTS.md` (37 FR, 16 NFR after this pass); `docs/DATA_MODEL.md` (Mermaid ERD, checked against `prisma/schema.prisma` model by model and column by column on 2 Nov, see section 6); `openapi.json` in sync (`pnpm openapi:check` passed, 72 operations) |
| Unit tests on business logic; integration tests on main endpoints | DONE | Unit: 121 files, 1236 passed, 1 skipped. Integration: 48 files, 836 tests, all pass with the CI environment (section 1). E2E: 778 listed |
| 3-min demo video + 60-s backup video | OPEN (HUMAN, owner's, due 12 Nov) | Not recorded |
| Scored extras: pricing + test checkout, Arabic, deposit | DONE (all in test mode, Arabic draft) | Pricing and test checkout: route `/pricing`, `/api/billing`, `/api/billing/checkout` and `/api/billing/downgrade`, `tests/integration/billing.test.ts`, `tests/e2e/dashboard/pricing.spec.ts`. Arabic with RTL: `messages/ar.json` (1346 keys, parity with en enforced), `tests/e2e/booking.rtl.spec.ts`, `tests/e2e/dashboard/shell.rtl.spec.ts`, `tests/unit/reminders/emailTemplates.locale.test.ts`; wording is a draft: 36 rows in `docs/ARABIC_REVIEW.md` await a native reviewer. Deposit: `/pay/[token]`, `tests/integration/deposit.test.ts`, `deposit.migration.test.ts`, `waitlist.deposit.journey.test.ts`, `tests/e2e/deposit.spec.ts`; Whish itself is not integrated (fake provider only) |

## 4. The five must-work-on-stage items (docs/SCOPE_REVIEW.md section 8)

"Real stack" means real route handlers and a real Postgres, no `page.route` mocks. "Mocked" means the browser talks to Playwright-mocked API responses.

| # | Item | Proof | Kind |
|---|---|---|---|
| 1 | Owner setup and publish: sign up, service, staff, hours, working booking link | `tests/integration/journey.smoke.test.ts` (signup, service, staff, hours, public booking through the real handlers), `setup.test.ts`, `directory.test.ts` (publish toggle and listing), `emailVerification.test.ts`; browser: `tests/e2e/auth.spec.ts`, `tests/e2e/dashboard/setup.spec.ts` | Real stack at the route-handler level (no browser). The browser steps for signup and setup are MOCKED-API only. The owner did it for real on production (O4 done 30 Oct, nour-beaty is listed) |
| 2 | Discovery and guest booking on a phone in four screens or fewer, with a clear message and fresh times when the slot was just taken | `tests/e2e/directory.spec.ts` and `tests/e2e/booking.spec.ts` (Pixel 5, "books in four screens", slot-taken message): MOCKED API. Real: `tests/integration/booking.concurrency.test.ts` (10 parallel, one 201, nine 409 `SLOT_TAKEN` with fresh slots), `booking.flow.test.ts`, `booking.hardening.test.ts`, `directory.test.ts`; and `tests/e2e/waitlistJourney.spec.ts` steps 1 and 7 book through the real booking page in a real browser and hit the taken-slot path with fresh options | Both. The four-screen count and the directory page are proven only with mocked responses; the slot-taken behaviour is proven on the real stack |
| 3 | Automatic reminders with confirm and cancel links, no duplicate reminders | `tests/integration/reminders.idempotency.test.ts` (overlapping runs, crash after send, cancel skips, <24 h and <2 h windows), `reminders.hardening.test.ts`, `links.test.ts`, `journey.smoke.test.ts` (booking, reminder job, confirm link, cancel link); `waitlistJourney.spec.ts` steps 2 and 4 | Real stack (handlers + Postgres; the email provider is the fake or a stub at the HTTPS edge). Real emails on production were confirmed by the owner (O6, 1 Nov). Exact 5-minute cadence is scheduler configuration, not tested |
| 4 | Cancellation from the link frees the slot and triggers a waitlist offer email | `tests/integration/waitlist.claim.test.ts` (27 tests), `links.test.ts`, `waitlist.test.ts`, `waitlist.deposit.journey.test.ts`; `tests/e2e/waitlistJourney.spec.ts` step 2 ("A cancels from the link in the confirmation email: slot freed, reminders skipped, offers go to W1..W3 only") | Real stack, including a real browser and the real cron routes. The only stand-in is the Resend HTTPS call, answered by a stub that writes each email to a file. The owner's manual two-inbox real-email check (F26, `docs/HUMAN_TASKS.md`) is still the owner's |
| 5 | One waitlisted client claims the slot and shows as a replacement on the dashboard; a second claimant is told it is unavailable | `tests/e2e/waitlistJourney.spec.ts` step 3 (two claim at the same moment: exactly one booking, loser told), step 4 (owner logs in and sees the refilled booking), `tests/integration/waitlist.claim.test.ts` (two claimers, one booking and one 409; expired offer; cascade), `waitlist.offerState.test.ts`, `pilot.refills.test.ts` | Real stack (browser + handlers + Postgres). The dashboard Refilled tile in `tests/e2e/dashboard/today.spec.ts` is MOCKED, the real one is journey step 4 |

Summary: items 3, 4 and 5 are proven on the real stack, including the one real-browser journey. Items 1 and 2 are proven on the real stack only below the browser (route handlers and Postgres); their phone UI steps (signup and setup screens, directory, the four-screen booking count) are proven with mocked-API Playwright specs.

## 5. Known limitations (consolidated from the tracker)

- Deferred follow-ups: F25 (argon2 concurrency cap is per serverless instance; rate limits in Postgres bound the fleet), F29 (a `PENDING_PAYMENT` answer reveals that a phone has no-show history; per-phone rate limit is the pilot mitigation), F30 (no refund or credit rule for paid deposits, nothing is refunded in test mode), F31 (the pay link is not emailed when a hold is created, so a closed tab loses the hold), F32 (hold sweeps take at most 50 per booking call and 200 per cron call; a larger backlog clears over several runs). F61 (new, test hygiene): `cleanup.test.ts` needs `CRON_SECRET` in the environment.
- Arabic is a machine-assisted draft awaiting a native reviewer: 36 rows in `docs/ARABIC_REVIEW.md`.
- Payments are test mode only (`PAYMENT_PROVIDER=fake`): the pay page and the pricing checkout take no card; Whish is not integrated.
- Free plan: one bookable staff member (the owner counts if bookable); Pro is a free test-mode upgrade.
- Sentry: errors only, personal data scrubbed on a best-effort basis; Sentry adds a coarse `user.geo` (the Vercel server city for server events, possibly the visitor's city for rare browser errors); the tunnel (F41) was skipped by the owner. Stack traces stay minified until the owner adds `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` as Production build variables (F39).
- Email: Resend free plan, about 100 a day. The job log warns at 80 sent today (a log line, nobody is paged) and booking confirmations are skipped at 95 so reminders keep priority. Invite, verification and reset emails are not counted.
- The 5-minute reminder cadence depends on cron-job.org plus the GitHub Actions backup; it is configuration, not a test.
- CI e2e does not run the `desktop` public project nor most of `dashboard-desktop`; they are outside the CI gate and were not run here.
- No automated accessibility gate in CI (Lighthouse and axe were run by hand).
- Two moderate `pnpm audit --prod` advisories in build-time Sentry plugin dependencies (section 1).
- Branch protection on `main` is not possible on the free private repo; the rule is a PR with green CI.

## 6. ERD check (docs/DATA_MODEL.md against prisma/schema.prisma)

All 19 models are in the ERD and the entity table with matching relations. Columns added since the ERD was written were checked one by one: `Appointment.contactEmail`, `contactName`, `holdExpiresAt`, `outcomeMarkedAt`, `outcomeMarkedById`; `User.emailVerifiedAt`; model `EmailToken`; `Business.depositEnabled`, `depositThreshold`, `depositAmount`, `listed`, `plan`; `WaitlistEntry.claimingOfferId`, `claimingAt`, `contactEmail`; models `RateLimitBucket` and `Payment` were already present. Other stale statements fixed in this PR: README ("No email verification at signup yet", change password "in Settings > Account", missing env names and docs links), `docs/PLAN.md` O1 ("all 7 migrations", now 12) and P0.5 (a `deploy.yml` that never existed). Stale ERD items found and fixed: the ERD lacked `User.emailVerifiedAt` and `name`, `WaitlistEntry.contactEmail`, `fromDate`, `toDate`, `Appointment.cancelledVia`, `Business.name`, `category`, `address`, `currency`, `Client.name`, `email`, `Payment.currency`, `WaitlistOffer.emailedAt`; the entity table listed `depositEnabled` twice; a paragraph still described an undecided `EmailLog` view that does not exist (replaced by how the daily budget is really counted). The hand-written constraint list was re-verified against the migrations (`appointment_no_overlap` with PENDING_PAYMENT, six CHECKs including `client_counters_non_negative`, `ReminderJob_pending_due_idx`, `Appointment_pending_hold_idx`).

## 7. OPEN for the owner

1. Record the 3-minute demo video and the 60-second backup video (due Thu 12 Nov). Then tick P4.4 in `docs/PLAN.md`.
2. Optional: add the three Sentry build variables for readable stack traces (F39, steps in `docs/HUMAN_TASKS.md`).
3. Re-check the GitHub Actions usage bar on Thu 5 Nov (see "Done by the owner" below for the 2 Nov reading).
4. Deferred until real money or real volume: F25, F29 to F32 (see section 6).

### Done by the owner (confirmed 2 Nov, after the ship-check ran; the earlier list of this section was stale)
- Neon usage check: 9.35 of 100 compute hours and 0.09 of 1 GB storage used (Free plan).
- GitHub Actions usage check: 4.82 of 12.00 USD included compute used this month, billable usage 0 USD.
- DMARC TXT record `_dmarc` added in Vercel DNS (`v=DMARC1; p=none;`).
- Manual two-inbox real-email waitlist check on production (F26).
- Native Arabic review: the owner reported it done and asked for it to be removed from the list.
- The F15 design-hook warnings (Arial email font, border accent on the rounded card) were ruled on: leave them, known and accepted.
- F61 (integration tests default `CRON_SECRET`) was fixed in this PR.
