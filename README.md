# Maw3ed

Maw3ed is a multi-business booking page for salons, barbers, clinics and physios, built to lower no-shows.
Clients book from their phone, get automatic email reminders and one-tap confirm or cancel links, and freed slots are offered to a waitlist.
Staff get one-tap WhatsApp reminders, per-client no-show history and a pilot report that compares each business with its own past.

Live: https://maw3edlb.com

## What is built

- Public booking page at `/b/{slug}` (service, staff or "anyone", day, time, details; phone-first, English and Arabic with RTL).
- Public directory at `/directory` (opt-in: a business chooses to be listed; unlisted businesses still work by direct link) and a home page at `/`.
- Reminders: booking confirmation with a calendar file, then 24 h and 2 h email reminders sent by a scheduled job. A reminder exists only if its time is still ahead when the booking is made (or its deposit is paid); the confirmation pages show exactly the reminders the server planned.
- WhatsApp reminders as a "due" list for the receptionist with prefilled `wa.me` links; the server never sends WhatsApp, it records who sent each one.
- Signed confirm and cancel links (late cancel after the cutoff is recorded separately).
- Waitlist: join for a service and date range; a cancellation offers the freed slot by email in batches of 3, first claim wins.
- Dashboard: Today, Reminders due, Mark outcome, Clients and per-client history, front-desk booking, Setup (services, staff, hours, time off, settings, booking link with QR).
- Accounts: sign up, sign in, owner and staff roles, invites, sessions stored in the database; soft email verification (the owner confirms their address before inviting staff or listing in the directory) and a dashboard banner with a rate-limited **Resend email**; forgot password and reset password by emailed single-use link (revokes every session), and an Account page (`/app/account`, every role) with change password and sign out of other devices; team access: the owner removes a departed member (their sessions for that business end in the same transaction), lists and revokes pending invites, and anyone can sign out their other devices.
- Pilot report: baseline entry, weekly no-show rate versus baseline with raw counts, CSV export.
- Deposits (test mode): optional deposit for clients with past no-shows, 15 minute slot hold, pay page.
- Plans (test mode): Free (one bookable staff member) and Pro at $20 (`PLAN_PRICE` in `src/server/domain/plan.ts`), shown on `/for-business#plans`, with a TEST-mode checkout at `/app/checkout` (no card is taken). The old `/pricing` page was removed: `/pricing` answers a 308 redirect to `/for-business#plans` (`next.config.ts`).
- Marketplace pages: home `/`, Explore at `/directory` (filters, "Next free" times, an "Open until" status derived from posted weekly hours), a shared business card, and "My bookings on this device" at `/my-bookings` (no account; saved in the browser).
- Rate limiting shared across serverless instances (Postgres), login throttling, argon2 password hashing.

## Assistant connectors (MCP)

Two separate Model Context Protocol endpoints, each OFF unless its own flag is exactly `true` (off means the routes answer 404). Neither is listed in any directory; ChatGPT is not supported.

- **Client connector (find and book).** `POST /api/mcp`, flag `MCP_ENABLED`. A client adds the link in Claude as a custom connector and chats to find a business and book. Nine tools (search, details, free times, prepare, create booking, join waitlist, get, confirm, cancel). Stateless, serves the 2026-07-28 and the legacy protocol. The page `/assistant` explains the steps. Bookings go through the same single booking insert as the website, so the three guarantees still apply. Details: [docs/MCP.md](docs/MCP.md).
- **Owner setup assistant.** `POST /api/mcp/owner`, flag `MCP_OWNER_ENABLED`. A business owner connects Claude to their own business through OAuth 2.1 with PKCE (consent page `/oauth/authorize`). Three tools: `get_setup_status`, `preview_setup_changes`, `apply_setup_changes`: changes are proposed first and saved only by a separate apply call. It can add services and staff, replace weekly hours, and set category, area, address, slot step, minimum notice and cancellation cutoff. It cannot delete anything and cannot read or return clients, appointments, waitlist or pilot data, plans, or logins. It appears only in the dashboard (Setup page, and Settings > Connected apps where the owner can revoke), never on `/assistant`. Details: [docs/MCP_OWNER.md](docs/MCP_OWNER.md).

Automated tests drive both endpoints with hand-written JSON-RPC clients (`tests/integration/mcp.*.test.ts`, `tests/unit/mcp*/`); they do not run a real Claude conversation. The owner reports having connected the owner assistant in Claude by hand on 11 Nov 2026 with a fresh signup and that it worked; that is a manual check, not a test.

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
   - `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`: optional error reporting (inert unless set in a Vercel Production deployment).
   - `CSP_MODE`: optional Content-Security-Policy kill switch (`enforce` default, `report-only`, `off`).
   - Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
6. Apply the migrations: `pnpm db:migrate` (development) or `pnpm db:deploy`.
7. Seed demo data (opt-in, local database only): `ALLOW_SEED=1 pnpm db:seed` on macOS, or in PowerShell `$env:ALLOW_SEED=1; pnpm db:seed`. It creates "Studio Nour" and a second business, and prints a password once unless `SEED_USER_PASSWORD` is set.
8. `pnpm dev` and open http://localhost:3000.

## Environment variables

Names only; values are never in the repository (`.env.example` lists the names, CI uses throwaway values). "Prod" is what the production build checks (`scripts/lib/productionEnv.mjs`): a missing required variable fails the build and lists names only.

| Variable | Prod | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Pooled Postgres connection used by the app. |
| `DIRECT_URL` | required | Direct (non-pooled) connection for migrations and the seed; must differ from `DATABASE_URL`. |
| `DATABASE_URL_TEST` | no | Database for integration tests (they use an isolated `itest` schema). |
| `APP_URL` | required | Exact public origin, https, no trailing slash (links, emails, the connector URLs). |
| `NEXT_PUBLIC_APP_URL` | required | The same origin, exposed to the browser. |
| `LINK_SECRET` | required | HMAC key for signed confirm, cancel, offer, pay and view links; 32+ characters. |
| `CRON_SECRET` | required | Shared secret for `/api/jobs/*` (`x-cron-secret`); 32+ characters, different from `LINK_SECRET`. |
| `EMAIL_PROVIDER` | required (`resend`) | `resend` or `fake` (records emails, sends nothing). |
| `RESEND_API_KEY`, `EMAIL_FROM` | required | Resend credentials and sender address. |
| `PAYMENT_PROVIDER` | no | `fake` (default; the only implemented provider). |
| `SESSION_SECRET` | no | Kept for compatibility; sessions are stored in the database. |
| `EXPECTED_DB_HOST` | recommended | Production database host (no `-pooler`); the build and the demo/seed tools refuse a different host. |
| `MCP_ENABLED` | no (off) | `true` turns on the client connector `/api/mcp` and its entry points. |
| `MCP_OWNER_ENABLED` | no (off) | `true` turns on the owner setup assistant, OAuth routes and consent page. |
| `MCP_ALLOWED_ORIGINS` | no | Extra https Origins allowed on `/api/mcp` (claude.ai, claude.com and `APP_URL` are always allowed). |
| `CSP_MODE` | no | `enforce` (default), `report-only` or `off`; read per request. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | no | Error reporting, inert unless set in a Vercel Production deployment. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | no | Build-time source map upload (all three or none). |
| `LOG_LEVEL` | no | pino log level. |
| `ALLOW_SEED`, `ALLOW_SEED_REMOTE`, `SEED_USER_PASSWORD` | never in prod | Opt-ins for `pnpm db:seed`; the production build fails if `ALLOW_SEED` or `ALLOW_SEED_REMOTE` is set. |
| `E2E_FAKE_SESSION` | never in prod | Test-only sign-in switch for browser tests; the production build fails if it is set. |
| `DEMO_OWNER_EMAIL`, `DEMO_OWNER_PASSWORD`, `DEMO_OWNER_NAME` | no | Used only by `pnpm demo:seed` and `demo:remove`, set in the terminal for that run. |
| `DATABASE_POOL_CONNECT_TIMEOUT_MS`, `RATE_LIMIT_DISABLED`, `RATE_LIMIT_TIMEOUT_MS` | no | Test and tuning knobs; `RATE_LIMIT_DISABLED` is ignored in production. |
| `BUILD_TIMEOUT_MINUTES` | no | Optional build timeout (5 to 40, default 25). |

## Demo data

The repository contains no real customer data. For demos and videos, `pnpm demo:seed`, `pnpm demo:check` and `pnpm demo:remove` load, verify and remove 18 simulated businesses (a dental-clinic flagship with a pilot report). They are dry runs by default and write only with `--apply --confirm-host <host>`. Demo data: all businesses, people and results are simulated for demonstration. Demo clients have no email address, so no email is ever sent for them. The step-by-step guide is [docs/DEMO_DATA.md](docs/DEMO_DATA.md).

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

Previewing emails: `node scripts/email/preview.mjs` renders every email kind in English and Arabic to `tmp/email-preview/*.html` (gitignored; open them in a browser, no network or secrets needed).

Also available: `pnpm db:deploy` (apply migrations), `pnpm db:check` (verify the constraints exist), `pnpm i18n:check` (en and ar keys match), `pnpm format`.

## How checks work

Three levels, so feedback is fast and CI is the full verdict:

1. While coding: `pnpm typecheck` plus only the test file or Playwright spec you touched. Integration files run against the local Docker Postgres (about 8 seconds each) in an isolated `itest` schema.
2. Once before a pull request: lint, typecheck, unit tests, the integration files for the touched area, i18n keys, `openapi:check` if the API changed, and a build.
3. After the pull request opens: GitHub Actions (`.github/workflows/ci.yml`) runs a `checks` job against a throwaway Postgres 16 (migrate, lint, typecheck, unit, integration, build, OpenAPI contract, i18n keys) and a parallel `e2e` job in two shards (Playwright, chromium: the `mobile` and `dashboard-mobile` projects, plus `shell.spec.ts` at desktop width on shard 1 and `cardAlignment.spec.ts` at desktop width on shard 2; the report is uploaded on failure). Playwright browsers are cached by Playwright version. When the cache hits, the job probes the Ubuntu apt mirror and skips `playwright install-deps` if it is unreachable (it then uses the libraries on the runner image; a missing library would fail the browser launch loudly). Changes to `docs/**`, `.claude/**` and `*.md` do not trigger CI; a push to `main` runs only `checks` (the e2e shards already ran on the pull request); a manual run (`workflow_dispatch`, for example `gh workflow run ci.yml --ref main`) runs everything. The full integration and e2e suites are not run locally: run only the spec you touched.

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

Only name, phone (normalised to E.164 with `libphonenumber-js`, default `LB`), email, appointment time, service and staff are stored. There are no notes or free-text columns on appointments or clients, so clinics can use it without holding health information. A client can be deleted by the owner and their past appointments are anonymised. Sentry (EU region) is a sub-processor that receives error diagnostics (error type, scrubbed message, minified stack, templated route, request id, internal business id); no cookies, headers, request bodies, query strings or user objects are sent. Personal data is removed on a best-effort basis (emails, phone numbers, link tokens and secret links, database error values). Free-text names cannot be detected automatically, so error messages are built without client data and Prisma / Postgres errors are reduced to class, code and column names. A rare residual risk remains and is documented in docs/ARCHITECTURE.md.

## Security headers

Every page gets a per-request nonce-based Content-Security-Policy from `src/proxy.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `unsafe-inline` and no `unsafe-eval` for scripts in production (`unsafe-eval` is added in development only), `frame-ancestors 'none'`, `connect-src` limited to `'self'` and the Sentry ingest host when a DSN is set). Styles are less strict: `style-src 'self' 'unsafe-inline'` is still allowed, because React renders `style=""` attributes (13 `style={...}` usages remain in `src`, counted on 12 Nov 2026) and a nonce cannot cover attributes. Removing that is a next-version item. The policy is built in `src/lib/security/csp.ts`; the owner consent page additionally allows its OAuth redirect target in `form-action`. `next.config.ts` adds `X-Content-Type-Options`, `X-Frame-Options: DENY` (the booking page cannot be embedded in another site), `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` on every route; HSTS comes from Vercel. If a page ever breaks because of the policy, set `CSP_MODE=report-only` or `off` (see `docs/HUMAN_TASKS.md`). Check a deployment with `node scripts/check-security-headers.mjs [baseUrl]` (default `https://maw3edlb.com`; add `--no-hsts` for local http): it prints PASS/FAIL per header per URL and exits 1 on any failure.

## Observability

Errors only, through Sentry (`@sentry/nextjs`), and **off unless** a DSN is set in a Vercel Production deployment: with no `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (previews, local, CI) the SDK is never loaded and nothing is sent. No tracing, profiling, session replay or user feedback. Personal data is removed on a best-effort basis before anything leaves (emails, phones, link tokens, cookies, headers, bodies, query strings, users, database error values; names in free text cannot be detected); see `src/lib/observability/scrub.ts` and "Error monitoring" in `docs/ARCHITECTURE.md`. pino logging is unchanged. Stack traces become readable once the owner adds `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` as Production-only Vercel build variables (F39): source maps are then uploaded to Sentry's EU region during the Production build and deleted from the deployment (they are never served), and a failed upload only warns. Without all three the build is unchanged and uploads nothing. Owner steps (account, DSN, alert rule, the `POST /api/jobs/sentry-test` check) are in `docs/HUMAN_TASKS.md`.

## Payments and deposits (test mode)

Payments are simulated. `PAYMENT_PROVIDER=fake` is the implemented provider; the pay page and the Pro checkout say "test mode" and no card is ever taken. Deposits are off by default. When an owner turns them on in Settings, a public booking by a client who has at least N earlier no-shows at that business (default 1) is held for 15 minutes as `PENDING_PAYMENT` until the client pays on `/pay/{token}`; front-desk bookings never ask for a deposit. Nothing is refunded or credited yet (tracked as follow-up F30).

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
- [docs/DESIGN_QA.md](docs/DESIGN_QA.md), [docs/DESIGN_QA_ROUND2.md](docs/DESIGN_QA_ROUND2.md): design QA reports.
- [docs/SCOPE_REVIEW.md](docs/SCOPE_REVIEW.md): scope document, including the five must-work-on-stage items.
- [docs/SHIP_CHECK.md](docs/SHIP_CHECK.md): definition-of-done evidence table.
- [docs/MCP.md](docs/MCP.md), [docs/MCP_OWNER.md](docs/MCP_OWNER.md): the two assistant connectors.
- [docs/DEMO_DATA.md](docs/DEMO_DATA.md): simulated demo data, run guide.
- [CLAUDE.md](CLAUDE.md): working rules for the AI assistant that builds this repo.

## Known limits and next version

- Styles still allow `'unsafe-inline'` in the CSP (scripts do not); hardening is planned for the next version.
- Slot and free times are shown as HH:mm (24-hour); an AM/PM option (planned as PR-9) is not built.
- The "finish your Pro upgrade" banner is remembered per browser and business, not across devices.
- The owner assistant only does setup. Further owner assistants (read-only or insights) need a separate privacy and security review before any work.
- Neither connector is listed in a Claude or other directory, and ChatGPT is not supported.
- The Privacy and Terms pages have not been reviewed by a lawyer.
- "Top places" in a category are ordered alphabetically, not by quality.
- "Open until" is computed from posted weekly hours only: it ignores time off and existing bookings, and it can be about 6 minutes out of date because the directory response is cached (`s-maxage=60`, `stale-while-revalidate=300`).
- The Arabic strings are machine-assisted and need a native speaker's read (`docs/ARABIC_REVIEW.md`).

## Status and limitations

- Payments are fake. There is no real payment provider and no refund or credit rule for paid deposits.
- The Arabic translation is a machine-assisted draft and still needs a native speaker's review (`docs/ARABIC_REVIEW.md`).
- The Free plan allows one bookable staff member; Pro is a test-mode upgrade with no real billing.
- Email goes through Resend's free plan, about 100 emails per day. The job log warns at 80 and booking confirmations are skipped at 95 so reminders keep priority.
- WhatsApp messages are sent by a person from their own phone, not by the server.
- Email verification is soft: a new account works at once, but inviting staff and listing in the directory need a confirmed address.
- Sentry stack traces stay minified until the owner adds the three build variables (`docs/HUMAN_TASKS.md`).
- Final ship-check evidence (pipeline, production checks, definition of done) is in [docs/SHIP_CHECK.md](docs/SHIP_CHECK.md).
- The pilot is small: with a few dozen appointments one no-show moves the rate by several points, so the report claims a direction, not significance.
