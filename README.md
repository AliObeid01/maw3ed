# Maw3ed

Maw3ed is a multi-business booking page for salons, barbers, clinics and physios, built to lower no-shows.
Clients book from their phone, get automatic email reminders and one-tap confirm or cancel links, and freed slots are offered to a waitlist.
Staff get one-tap WhatsApp reminders, per-client no-show history and a pilot report that compares each business with its own past.

Live: https://maw3edlb.com

## What is built

- Public booking page at `/b/{slug}` (service, staff or "anyone", day, time, details; phone-first, English and Arabic with RTL).
- Public directory at `/directory` (opt-in: a business chooses to be listed; unlisted businesses still work by direct link) and a home page at `/`.
- Reminders: booking confirmation with a calendar file, then 24 h and 2 h email reminders sent by a scheduled job.
- WhatsApp reminders as a "due" list for the receptionist with prefilled `wa.me` links; the server never sends WhatsApp, it records who sent each one.
- Signed confirm and cancel links (late cancel after the cutoff is recorded separately).
- Waitlist: join for a service and date range; a cancellation offers the freed slot by email in batches of 3, first claim wins.
- Dashboard: Today, Reminders due, Mark outcome, Clients and per-client history, front-desk booking, Setup (services, staff, hours, time off, settings, booking link with QR).
- Accounts: sign up, sign in, owner and staff roles, invites, sessions stored in the database; soft email verification (the owner confirms their address before inviting staff or listing in the directory) and a dashboard banner with a rate-limited **Resend email**; forgot password and reset password by emailed single-use link (revokes every session), and change password in Settings > Account.
- Pilot report: baseline entry, weekly no-show rate versus baseline with raw counts, CSV export.
- Deposits (test mode): optional deposit for clients with past no-shows, 15 minute slot hold, pay page.
- Plans (test mode): Free (one bookable staff member) and Pro, with a test checkout and a `/pricing` page.
- Rate limiting shared across serverless instances (Postgres), login throttling, argon2 password hashing.

## Tech stack

Next.js (App Router, route handlers), TypeScript strict, pnpm, Prisma on Postgres (Neon in production), Zod with zod-to-openapi,
custom session table with argon2, Luxon, libphonenumber-js, Resend for email, Tailwind v4 with shadcn/ui, next-intl (en, ar),
lucide-react, pino, Sentry (optional), Vitest, Playwright, GitHub Actions, Vercel.

## The three engineering guarantees

**1. No double booking.** A hand-written Postgres exclusion constraint, `appointment_no_overlap`, rejects two active appointments
for the same staff member whose `tstzrange(startAt, blockedUntil, '[)')` overlap. Active means `BOOKED`, `CONFIRMED` or `PENDING_PAYMENT`,
so a deposit hold blocks its slot exactly like a booking. The application checks availability first only to give a friendly answer;
the database is the referee, and Postgres error `23P01` becomes `409 SLOT_TAKEN` with fresh slots. Public bookings, front-desk bookings,
waitlist claims and deposits all use the same insert. Proof: `tests/integration/appointment.overlap.test.ts`,
`tests/integration/booking.concurrency.test.ts` (parallel requests for one slot, one winner), `tests/integration/deposit.migration.test.ts`.

**2. No duplicate reminders.** Three independent layers. `ReminderJob` has a unique key on `(appointmentId, kind, channel)`, so a second
row cannot be created. The runner claims due jobs with one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`,
so two overlapping runs never take the same row. Each send passes the job id as the provider idempotency key, so even a retry after a crash
is delivered once. Failures go back to `PENDING` with backoff and become `FAILED` after 3 attempts. Proof:
`tests/integration/reminders.idempotency.test.ts` (uses the fake email provider, which records calls so "sent exactly once" can be asserted),
`tests/integration/reminders.hardening.test.ts`.

**3. Correct slots across daylight saving time.** `generateSlots` is a pure function: working hours are built as local intervals in
`Business.timezone` with Luxon and converted to UTC, time off and busy intervals are subtracted, and "now" is injected. A local time that does
not exist (Beirut springs forward at midnight) moves forward and a repeated hour uses the earlier offset. Proof: `tests/unit/slots.test.ts`.

## Architecture overview

```
route handler (src/app/api/**)        Zod-parse params/query/body, session + role guard, call ONE service, map errors
service       (src/server/services)   business logic, role checks, transactions
repository    (src/server/repositories) the ONLY code that imports Prisma
domain        (src/server/domain)     pure functions, no I/O, `now` injected
providers     (src/server/providers)  EmailProvider / PaymentProvider with Fake implementations
```

- Tenant isolation: every repository method takes `businessId` as its first argument, taken from the session (or resolved from a slug or a signed token on public routes), never from a request body. An id that belongs to another business answers 404, not 403.
- Error shape everywhere: `{ "error": { "code": "SLOT_TAKEN", "message": "...", "fields": { ... } } }`. Validation failures are 400 with `fields`; unknown fields are rejected.
- Time: stored as UTC `timestamptz`, computed and shown in `Business.timezone` (default `Asia/Beirut`).

More detail, including the reminder pipeline, waitlist and signed links, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local setup

Prerequisites: Node 22 (the repo pins it in `.nvmrc` and `engines`), pnpm 11 (`packageManager` is pinned; `corepack enable` installs the right version), Git, and Docker Desktop for the local Postgres.

1. Install Node 22.
   - macOS: `brew install node@22` or use nvm (`nvm install 22`).
   - Windows: install Node 22 from nodejs.org, or `winget install OpenJS.NodeJS.LTS` and check `node -v` prints 22.x, or use nvm-windows.
2. Enable pnpm: `corepack enable` (Windows: run the terminal as administrator once if it complains about permissions).
3. Install and start Docker Desktop (macOS or Windows), then from the repo root: `docker compose up -d db`. This starts Postgres 16 on port 5432 (user `maw3ed`, password `maw3ed`, database `maw3ed_test`, throwaway local values from `docker-compose.yml`).
4. `pnpm install` (runs `prisma generate` afterwards).
5. Copy the environment file and fill it in: `cp .env.example .env` (Windows PowerShell: `Copy-Item .env.example .env`). Variable names:
   - `DATABASE_URL`: the pooled Postgres connection used by the app. For local Docker, use `postgresql://maw3ed:maw3ed@localhost:5432/maw3ed_test`.
   - `DIRECT_URL`: the direct (non-pooled) connection used by migrations and the seed. Locally, the same as `DATABASE_URL`.
   - `DATABASE_URL_TEST`: the database integration tests run against (they only touch a separate `itest` schema).
   - `APP_URL`, `NEXT_PUBLIC_APP_URL`: the site origin used in links and emails (`http://localhost:3000` locally).
   - `SESSION_SECRET`: kept for compatibility; sessions are stored in the database.
   - `LINK_SECRET`: HMAC key for signed confirm, cancel, offer and pay links. 32 or more random characters.
   - `CRON_SECRET`: shared secret for the scheduled job routes. 32 or more random characters, different from `LINK_SECRET`.
   - `RESEND_API_KEY`, `EMAIL_FROM`: Resend credentials and sender; only needed with `EMAIL_PROVIDER=resend`.
   - `EMAIL_PROVIDER`: `fake` locally (records emails, sends nothing) or `resend`.
   - `PAYMENT_PROVIDER`: `fake` (the only provider implemented for real use).
   - `SENTRY_DSN`: optional error reporting.
   - Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
6. Apply the migrations: `pnpm db:migrate` (development) or `pnpm db:deploy`.
7. Seed demo data (opt-in, local database only): `ALLOW_SEED=1 pnpm db:seed` on macOS, or in PowerShell `$env:ALLOW_SEED=1; pnpm db:seed`. It creates "Studio Nour" and a second business, and prints a password once unless `SEED_USER_PASSWORD` is set.
8. `pnpm dev` and open http://localhost:3000.

## Commands

```
pnpm dev               # Next dev server
pnpm lint              # ESLint (incl. no-literal-string in components)
pnpm typecheck         # tsc --noEmit
pnpm test:unit         # Vitest, domain + services with fakes
pnpm test:int          # Vitest against real Postgres (docker compose up -d db)
pnpm test:e2e          # Playwright, Pixel 5 + desktop
pnpm db:migrate        # prisma migrate dev
pnpm db:seed           # demo data (Studio Nour + a second business)
pnpm openapi:generate  # write openapi.json from Zod registry
pnpm openapi:check     # fail if committed openapi.json is stale
pnpm design:extract    # unpack design boards to design/screens
```

Also available: `pnpm db:deploy` (apply migrations), `pnpm db:check` (verify the constraints exist), `pnpm i18n:check` (en and ar keys match), `pnpm format`.

## How checks work

Three levels, so feedback is fast and CI is the full verdict:

1. While coding: `pnpm typecheck` plus only the test file or Playwright spec you touched. Integration files run against the local Docker Postgres (about 8 seconds each) in an isolated `itest` schema.
2. Once before a pull request: lint, typecheck, unit tests, the integration files for the touched area, i18n keys, `openapi:check` if the API changed, and a build.
3. After the pull request opens: GitHub Actions (`.github/workflows/ci.yml`) runs everything against a throwaway Postgres 16: migrate, lint, typecheck, unit, integration, build, OpenAPI contract and i18n keys, plus a parallel `e2e` job (Playwright, chromium only: public specs and dashboard specs on the mobile projects, `shell.spec.ts` at desktop width; the report is uploaded on failure). The full integration and e2e suites are not run locally: run only the spec you touched.

E2E specs never depend on the real clock (time of day, midnight in Beirut, CI running in UTC). Every mocked spec freezes the browser clock and derives its dates from `tests/e2e/helpers/clock.ts` (`FIXED_NOW`, default Wed 4 Nov 2026 10:00 Beirut; `clockNow()`, `nowMs()`, `freezeClock(page)`). To check a spec at another time: `E2E_NOW=2026-11-04T23:55:00+02:00 pnpm exec playwright test --project=dashboard-mobile --workers=2 <spec>`. Never call `Date.now()` or `DateTime.now()` in a spec or mock.

## Deploys and migrations

The app deploys to Vercel; production is https://maw3edlb.com. Vercel runs the `vercel-build` script (`scripts/vercel-build.mjs`):

- Production builds (`VERCEL_ENV=production`) first check the environment (required variable names, secrets of 32 or more characters, distinct pooled and direct database strings, `EMAIL_PROVIDER=resend`, no seed or test flags), then run `prisma migrate deploy`, then `prisma generate`, then `next build`. A bad setting fails the build and lists variable names only, never values.
- Preview and development builds never run migrations, so a preview cannot touch the production database.
- `EXPECTED_DB_HOST` (production only) is the Neon host of the production database without `-pooler`. If `DATABASE_URL` or `DIRECT_URL` points anywhere else, the production build refuses to deploy. It is a warning, not an error, if unset, so set it.
- `prisma generate` also runs explicitly at build time because the generated client (`src/generated`) is not committed and build caches can skip `postinstall`.
- Migrations run before the new code goes live, so keep them additive (add a column first, remove the old one in a later release).
- Reserved slugs are only enforced at signup; see the production checklist in `docs/HUMAN_TASKS.md`.

## Scheduled jobs

All job routes are `POST`, authenticated with the `x-cron-secret` header, and idempotent, so a late or doubled trigger is harmless.

| Job | Route | Schedule | Scheduler |
|---|---|---|---|
| Send due reminders | `/api/jobs/reminders` | every 5 min | cron-job.org, GitHub Actions backup |
| Expire waitlist offers and lapsed deposit holds, offer freed slots | `/api/jobs/waitlist-expiry` | every 5 min | cron-job.org, GitHub Actions backup |
| Purge expired sessions, old invites, used or expired email tokens, old rate-limit rows | `/api/jobs/cleanup` | daily (03:00) | cron-job.org, GitHub Actions backup (03:00 UTC) |

The GitHub backup is `.github/workflows/reminders-backup.yml` and needs the `APP_URL` Actions variable and the `CRON_SECRET` secret. Vercel Hobby cron runs once a day, which is why an external scheduler is used.

## OpenAPI

Every route registers its Zod schemas in `src/server/contracts/`. `pnpm openapi:generate` writes `openapi.json` at the repo root; `pnpm openapi:check` fails if the committed file is stale, and CI runs it.

## Internationalisation

English and Arabic through next-intl, with no locale prefix in URLs (so `/b/{slug}` stays shareable). A visitor's choice is a cookie (`?lang=` also sets it); otherwise the business default is used, resolved on the server, then English. Arabic renders right to left; the UI uses logical CSS only (`ms-*`, `me-*`, `start-*`). No hardcoded strings in components: every string is in `messages/en.json` and `messages/ar.json`, enforced by lint and `pnpm i18n:check`.

## Privacy

Only name, phone (normalised to E.164 with `libphonenumber-js`, default `LB`), email, appointment time, service and staff are stored. There are no notes or free-text columns on appointments or clients, so clinics can use it without holding health information. A client can be deleted by the owner and their past appointments are anonymised.

## Payments and deposits (test mode)

Payments are simulated. `PAYMENT_PROVIDER=fake` is the implemented provider; the pay page and the pricing checkout say "test mode" and no card is ever taken. Deposits are off by default. When an owner turns them on in Settings, a public booking by a client who has at least N earlier no-shows at that business (default 1) is held for 15 minutes as `PENDING_PAYMENT` until the client pays on `/pay/{token}`; front-desk bookings never ask for a deposit. Nothing is refunded or credited yet (tracked as follow-up F30).

## Key decisions

A short list; the full log with reasoning is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#key-decisions).

- The database enforces no double booking (exclusion constraint), not application code.
- Three layers stop duplicate reminders: unique key, `SKIP LOCKED` claim, provider idempotency key.
- An external scheduler plus a GitHub backup instead of Vercel Cron.
- A custom session table instead of Auth.js, for server-side revocation.
- Luxon for all time zone work; fake providers in tests.
- Postgres-backed rate limiting that works across serverless instances.

## Project docs

- [docs/PLAN.md](docs/PLAN.md): task tracker.
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): requirements and their status.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design and key decisions.
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): entities, ERD, constraints.
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md): UI tokens and components.
- [docs/PILOT_PLAYBOOK.md](docs/PILOT_PLAYBOOK.md): how to onboard a pilot business.
- [docs/HUMAN_TASKS.md](docs/HUMAN_TASKS.md): account setup and production checklist.
- [docs/ARABIC_REVIEW.md](docs/ARABIC_REVIEW.md): notes for the native Arabic review.
- [CLAUDE.md](CLAUDE.md): working rules for the AI assistant that builds this repo.

## Status and limitations

- Payments are fake. There is no real payment provider and no refund or credit rule for paid deposits.
- The Arabic translation is a machine-assisted draft and still needs a native speaker's review (`docs/ARABIC_REVIEW.md`).
- The Free plan allows one bookable staff member; Pro is a test-mode upgrade with no real billing.
- Email goes through Resend's free plan, about 100 emails per day. The job log warns at 80 and booking confirmations are skipped at 95 so reminders keep priority.
- WhatsApp messages are sent by a person from their own phone, not by the server.
- No email verification at signup yet.
- The pilot is small: with a few dozen appointments one no-show moves the rate by several points, so the report claims a direction, not significance.
