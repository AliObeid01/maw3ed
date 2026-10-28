---
name: ship-check
description: Use before claiming a Maw3ed task, PR or phase is done, and before the 8 November review. Runs the full local pipeline (lint, typecheck, unit, integration, build, OpenAPI, e2e) and reports results against the definition of done in docs/REQUIREMENTS.md, with real command output as evidence.
---

# Maw3ed ship check

Run every step and report actual output. If a step fails, stop, say which one, and show the failure. Don't summarise a failure as a pass.

## Pipeline (same order as CI)
```bash
docker compose up -d db                 # local Postgres for integration tests
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
psql "$DATABASE_URL" -f scripts/db/check-constraints.sql
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:int
pnpm build
pnpm openapi:check
node scripts/i18n/check-keys.mjs
pnpm test:e2e                           # needs the app built/started by the Playwright webServer config
```
For a single task, the minimum is lint + typecheck + the affected unit/integration tests. Use the full pipeline at phase gates.

## Phase gates
- **Engine proven** (end of Phase 1): `slots*.test.ts` green incl. DST; `booking.concurrency.test.ts` green; `tenant.isolation.test.ts` green.
- **Pilots go live** (end of Phase 2): the above + `reminders.idempotency`, `links`, `waitlist.claim`, `validation.routes` green;
  prod deployed from main; the cron-job.org history shows 5-minute calls; booking works end to end on a real phone.
- **Review** (8 Nov): the DoD below.

## Definition of done (PRD, 8 November)
Check each item and cite the evidence:
- [ ] Live at a public URL, deployed by CI that runs tests on every PR → link to the latest green Actions run + prod URL
- [ ] Next.js route handlers in TS + Prisma; repository layer separate from services; validation on every route → `validation.routes.test.ts`
- [ ] Any business can sign up to its own workspace; a test proves one business cannot read another's data → `tenant.isolation.test.ts`
- [ ] Sign-in with Owner and Staff roles → role tests
- [ ] Comfortable on a phone → Playwright Pixel 5 run, design-qa report, Lighthouse mobile a11y ≥ 90
- [ ] README (setup, architecture, key decisions), FR/NFR one-pager, ERD, OpenAPI contract → file paths
- [ ] Unit tests on business logic; integration tests on main endpoints → test counts
- [ ] 3-min demo video + 60-s backup video (human)
- [ ] Scored extras attempted: pricing + test checkout, Arabic, deposit → routes and tests

Finish by updating the status column in `docs/REQUIREMENTS.md` and the checkboxes in `docs/PLAN.md`.
