# Maw3ed — project guide for Claude

Maw3ed is a multi-business booking page (salons, barbers, clinics, physios) that lowers no-shows:
automatic 24 h / 2 h email reminders, one-tap WhatsApp sends for the receptionist, signed confirm/cancel
links, a waitlist that refills freed slots, and per-client no-show history. Phone-first. Review after **8 Nov 2026**.

Source of truth: `Maw3ed — No-Show Reducer PRD.pdf` (requirements) and `maw3ed-design.html` (UI).
Live task tracker: `docs/PLAN.md`. Update its checkboxes as tasks land.

## Stack
Next.js App Router + route handlers · TypeScript strict · pnpm · Prisma + Neon Postgres · Zod (`.strict()`) +
zod-to-openapi · custom session table + argon2 · Luxon · libphonenumber-js · Resend + react-email ·
Tailwind v4 + shadcn/ui · next-intl (en, ar) · lucide-react · pino · Sentry · Vitest · Playwright · GitHub Actions · Vercel.

## Layering rules (non-negotiable)
```
route handler (src/app/api/**)   → Zod-parse params/query/body, session + role guard, call ONE service, map errors
service       (src/server/services)  → business logic, role checks, transactions
repository    (src/server/repositories) → the ONLY code that imports Prisma
domain        (src/server/domain)    → pure functions, no I/O, no Date.now() (inject `now`)
providers     (src/server/providers) → EmailProvider / PaymentProvider + Fake implementations
```
- Every repository method takes `businessId` as its **first argument**, sourced from the session, never from the request body.
- Public routes resolve the business from the `slug` or from a signed token.
- An ID belonging to another business → **404**, never data, never 403.
- Error shape everywhere: `{ "error": { "code": "SLOT_TAKEN", "message": "…", "fields": { … } } }`.
- Validation failure → 400 with `fields`. Unknown fields are rejected (`.strict()`).
- Every new route: register its schemas in the OpenAPI registry and add a 400 test + (if tenant-scoped) a cross-tenant 404 test. Use the `api-endpoint` skill.

## The three guarantees (never weaken them)
1. **No double booking**: Postgres exclusion constraint `appointment_no_overlap` (hand-written SQL migration, btree_gist) over
   `(staffId, tstzrange(startAt, blockedUntil, '[)'))` for active statuses. Postgres 23P01 → 409 `SLOT_TAKEN` + fresh slots.
   Waitlist claims and front-desk bookings go through the **same** booking insert.
2. **No duplicate reminder**: `ReminderJob` unique `(appointmentId, kind, channel)`; claim with `FOR UPDATE SKIP LOCKED`;
   job id is the provider idempotency key.
3. **Correct slots across DST**: `generateSlots` is pure; build local intervals and convert with the business timezone (Luxon).

## Time
Store UTC (`timestamptz`). Compute and display in `Business.timezone` (default `Asia/Beirut`). Never use the server's local zone.

## Frontend
- Match `maw3ed-design.html`. Extracted boards: `design/screens/*.html` (run `pnpm design:extract` or `node scripts/design/extract-screens.mjs`).
  Use the `maw3ed-design-system` skill and `docs/DESIGN_SYSTEM.md`.
- Build at **360 px first**, then `md` (768) and `lg` (1024+). Tap targets ≥ 44 px. Booking in ≤ 4 screens.
- Dashboard: sidebar at `lg+`, bottom tab bar + More sheet + floating "New booking" below `lg`.
- **No hardcoded UI strings**. Every string goes in `messages/en.json` **and** `messages/ar.json` (`i18n-rtl` skill).
- Logical CSS only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`). Never `left`/`right`/`ml`/`mr`.

## Privacy
Store only name, phone (E.164), email, appointment time, service and staff. **No notes / free-text columns** on appointments or clients.

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

## Workflow
- Branch per task (`feat/<area>-<thing>`), PR to `main`, CI must be green, run the `code-reviewer` agent before merge.
- **Three levels of checks (saves time and tokens; CI is the full verdict):**
  1. While coding: `pnpm typecheck` plus only the test file or Playwright spec you touched (`--workers=2`). Integration files run against local Docker Postgres (`docker compose up -d db`, `DATABASE_URL_TEST=postgresql://maw3ed:maw3ed@localhost:5432/maw3ed_test`), about 8 s each.
  2. Once before the PR: lint, typecheck, unit, the integration files for the touched area, i18n keys, `openapi:check` if the API changed, build.
  3. After the PR opens: CI runs everything. Never run the full integration or e2e suite locally (about 4 min); never re-verify after green; pipe output through `| tail -30`.
- Keep tasks small and clear: one screen or one endpoint group per agent, an explicit scope, and a stop rule. Related tasks may share one PR.
- TDD for `src/server/domain` and services (`superpowers:test-driven-development`).
- Before claiming done: run the `ship-check` skill (or at least lint + typecheck + affected tests).
- Per-task definition of done: lint, typecheck, tests green; screen checked at 360 px; strings in both locales; `docs/PLAN.md` ticked.

## Agents and skills
Agents (`.claude/agents/`): `backend-engineer`, `frontend-engineer`, `test-engineer`, `code-reviewer`, `design-qa`.
Skills (`.claude/skills/`): `maw3ed-design-system`, `api-endpoint`, `db-migration`, `i18n-rtl`, `ship-check`.

## Docs
`docs/PLAN.md` (tracker) · `docs/ARCHITECTURE.md` · `docs/REQUIREMENTS.md` · `docs/DATA_MODEL.md` ·
`docs/DESIGN_SYSTEM.md` · `docs/PILOT_PLAYBOOK.md` · `docs/HUMAN_TASKS.md`
