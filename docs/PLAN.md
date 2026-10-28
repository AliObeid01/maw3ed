# Maw3ed — execution tracker

Build window: **Thu 29 Oct → Sun 8 Nov 2026** (review after 8 Nov). Pilots must be live by **Tue 3 Nov**.
Tracks: **BE** `backend-engineer` · **FE** `frontend-engineer` · **QA** `test-engineer` · **H** human (you).
Every task: branch `feat/<id>-<slug>` → PR → CI green → `code-reviewer` → merge. Tick the box when it's merged.
If the core slips, drop in this order: P3.9 deposit → P3.8 pricing → P3.6 CSV → P4.2 load test. **Never cut pilot days.**

---

## Phase 0 — Foundations (29 Oct)
- [x] **P0.1 BE** Scaffold Next.js (App Router, `src/`), TS strict, pnpm, path alias `@/`, `.nvmrc` (Node 22), `.env.example`.
- [x] **P0.2 BE** ESLint + Prettier; `eslint-plugin-i18next` `no-literal-string` on `src/app/**` + `src/components/**` (NFR-12); `import/no-restricted-paths` so only `src/server/repositories` imports Prisma.
- [x] **P0.3 QA** Vitest config (`unit` and `integration` projects; integration uses `DATABASE_URL_TEST`); Playwright config (Pixel 5 + Desktop Chrome, `webServer`).
- [x] **P0.4 BE** `docker-compose.yml` (postgres:16) + `pnpm` scripts from CLAUDE.md.
- [x] **P0.5 BE** `.github/workflows/ci.yml` (PR: postgres service → install → migrate deploy → lint → typecheck → unit → int → build → openapi:check → i18n keys) and `deploy.yml` (main: same → `prisma migrate deploy` on prod → `vercel deploy --prod`); `reminders-backup.yml` (cron `*/5` → curl the job routes).
- [x] **P0.6 FE** Tailwind v4 `@theme` tokens, `bg-hero`, Outfit + IBM Plex Sans Arabic via `next/font`, shadcn/ui init restyled to tokens, `Logo.tsx` from the sidebar board SVG.
- [x] **P0.7 FE** next-intl (no URL prefix; locale resolver), `messages/en.json` + `ar.json`, `scripts/i18n/check-keys.mjs`, root layout sets `lang`/`dir`.
- [x] **P0.8 FE** `pnpm design:extract` script alias; run `snapshot-boards.mjs` once Playwright is installed → `design/boards/*.png`.
- [ ] **P0.9 H** Accounts and secrets from `docs/HUMAN_TASKS.md` §1–5; start recruiting pilots (§7).

## Phase 1 — Engine proven (29–31 Oct) · gate: slots + no-overlap + isolation tests green
- [ ] **P1.1 BE** `prisma/schema.prisma`: all entities from `docs/DATA_MODEL.md`, businessId-first indexes, uniques, enums. (FR-01…24 data)
- [ ] **P1.2 BE** Hand-written migration `appointment_no_overlap` + CHECKs + reminder partial index; `scripts/db/check-constraints.sql`, `check-overlaps.sql`. (NFR-07)
- [ ] **P1.3 BE** `prisma/seed.ts`: "Studio Nour" (Hamra, Beirut; Lina owner+bookable, Karim, Jad, receptionist Rana; the five board services) + a second business for isolation tests.
- [ ] **P1.4 BE** `src/server/http`: `withRoute`, `AppError`, error mapper (23P01→409, 23505→409), request id + pino logger, OpenAPI registry + `openapi:generate/check`. (NFR-02, NFR-11)
- [ ] **P1.5 BE** `domain/slots.ts` `generateSlots` with TDD: split shifts, long service, buffers, time off, min notice, window edge, DST days (Asia/Beirut), "anyone" merge + least-booked pick. (FR-09, NFR-06)
- [ ] **P1.6 BE** `domain/tokens.ts` (HMAC sign/verify, scope, expiry), `domain/phone.ts` (E.164, default LB), `domain/reminderWindows.ts`. (NFR-03, FR-15, FR-17)
- [ ] **P1.7 BE** Auth: `POST /api/auth/signup` (Business + User + Membership OWNER + owner StaffMember, slug check), login/logout, `Session` table, argon2, cookie flags, `requireRole`. (FR-01, FR-02, NFR-03)
- [ ] **P1.8 BE** Invites: `POST /api/invites`, `POST /api/invites/{token}/accept` (hashed, single-use, expiring), invite email via `EmailProvider` + `FakeEmailProvider`. (FR-02)
- [ ] **P1.9 QA** `tenant.isolation.test.ts` scaffold + `booking.concurrency.test.ts` (red until P2.3); unit tests for tokens/phone/windows/guards.
- [ ] **P1.10 FE** `PublicHeader`, `BusinessHero`, `StepRail`, `Button`/`IconButton`/`Input`/`Card`/`Chip`/`StatTile`/`Sheet` primitives.
- [ ] **P1.11 FE** `AppShell`: sidebar (`lg+`), bottom tab bar + More sheet + FAB (< `lg`), badge slots, active state.
- [ ] **P1.12 FE** Screens 3.1 sign up, 3.2 sign in, 3.3 accept invite → wired to P1.7/P1.8.

## Phase 2 — Core flow live (31 Oct – 3 Nov) · gate: pilots go live 3 Nov
- [ ] **P2.1 BE** Setup CRUD: `/api/services`, `/api/staff` (+ services performed, bookable, active), `/api/staff/{id}/hours`, `/api/staff/{id}/time-off`, `GET/PATCH /api/business`. (FR-04…07)
- [ ] **P2.2 BE** Public read: `GET /api/public/{slug}`, `GET /api/public/{slug}/slots` (one query per range; < 300 ms p95). (FR-08, FR-09, NFR-09)
- [ ] **P2.3 BE** Booking service (one insert path for public, front desk, waitlist claim, deposit): client upsert by phone, friendly re-check, insert with `blockedUntil`, 23P01 → 409 + fresh slots, `Idempotency-Key`, reminder jobs created in the same transaction. `POST /api/public/{slug}/bookings`, `GET/POST /api/appointments`. (FR-08, FR-10, FR-11, FR-15)
- [ ] **P2.4 BE** Reminder job runner `POST /api/jobs/reminders` (cron secret): requeue stuck, claim SKIP LOCKED, re-check, send via `ResendEmailProvider` with idempotency key, record SENT/backoff/FAILED, daily count + warn at 80. (FR-13, FR-16, NFR-08, NFR-10)
- [ ] **P2.5 BE** Booking confirmation email (kind BOOKING) + `.ics` attachment; email templates (react-email) for BOOKING/H24/H2. (FR-12, FR-13)
- [ ] **P2.6 BE** Links: `GET/POST /api/links/{token}` confirm/cancel; late cancel after the cutoff; cancel skips pending reminders and triggers the waitlist. Staff cancel `POST /api/appointments/{id}/cancel`. (FR-15, FR-17)
- [ ] **P2.7 BE** WhatsApp: `GET /api/reminders/whatsapp-due` (with prefilled `wa.me` URL), `POST /api/reminders/{id}/mark-sent` (conditional update; second call → 409 with "sent by X at T"). (FR-14)
- [ ] **P2.8 BE** Waitlist: `POST /api/public/{slug}/waitlist`; on cancel → `domain/waitlistMatch` → offer batch (3) by email with signed claim token; `POST /api/offers/{token}/claim` through P2.3; `POST /api/jobs/waitlist-expiry` cascades until the slot is within min notice. (FR-18…20)
- [ ] **P2.9 QA** Proof tests green: `booking.concurrency`, `reminders.idempotency`, `links`, `waitlist.claim`, `validation.routes`, `tenant.isolation` (all entities).
- [ ] **P2.10 FE** Booking stepper `/b/[slug]` 1.1–1.4 + 1.5 booked + 1.6 slot taken; mobile sticky summary/CTA; ≤ 4 screens. (FR-08, NFR-05)
- [ ] **P2.11 FE** 1.7 join waitlist; 2.1 confirm/cancel, 2.2 cancelled, 2.3 waitlist offer.
- [ ] **P2.12 FE** Setup 3.4 checklist, 3.5 services, 3.6 staff, 3.7 hours & time off (several intervals per day), 3.8 settings, 3.9 share link (copy, QR, WhatsApp/Instagram share).
- [ ] **P2.13 FE** 4.1 Today (stat tiles, calendar grid `lg+`, agenda list mobile, "Do this first" WhatsApp card, "Needs you", waitlist activity).
- [ ] **P2.14 FE** 4.2 Reminders due (one-tap `wa.me`, optimistic mark-sent, disabled "sent by …" state, red badge count). (FR-14)
- [ ] **P2.15 FE** 4.3 Front-desk booking (phone/walk-in, same slot engine, client lookup by phone, < 30 s). (FR-11)
- [ ] **P2.16 QA** E2E `booking.spec.ts` (Pixel 5) green against preview.
- [ ] **P2.17 H** cron-job.org jobs live; prod smoke on a real Android phone; **onboard pilots** (`docs/PILOT_PLAYBOOK.md`); enter baselines.

## Phase 3 — History, pilot report, extras (3–6 Nov)
- [ ] **P3.1 BE** `PATCH /api/appointments/{id}/outcome` (ATTENDED / NO_SHOW / LATE_CANCEL; only after start; counters in the same transaction; idempotent re-mark adjusts counters). (FR-21)
- [ ] **P3.2 BE** Mark-outcome queue query + badge count; `GET /api/clients`, `GET /api/clients/{id}` (visits, no-shows, late cancels, history); `DELETE /api/clients/{id}` (owner; anonymise past appointments). (FR-22, FR-23, NFR-04)
- [ ] **P3.3 FE** 4.4 Mark outcome, 4.5 Appointment, 4.6 Clients, 4.7 Client history; `NoShowBadge` everywhere a booking shows. (FR-21…23)
- [ ] **P3.4 BE** `GET/PUT /api/pilot/baseline`, `GET /api/pilot/report` (weekly no-show rate vs baseline, raw counts, abs/rel change, confirm rate, link cancels, refill rate). (FR-24)
- [ ] **P3.5 FE** 4.8 Pilot report (accessible chart + table with raw counts; baseline form). (FR-24)
- [ ] **P3.6 BE/FE** CSV export `GET /api/pilot/export.csv` + button. (FR-25)
- [ ] **P3.7 FE** Arabic: full `ar.json`, RTL pass on every screen, Arabic email + WhatsApp templates, language toggle on public pages. (FR-28)
- [ ] **P3.8 BE/FE** `PaymentProvider` + `FakePaymentProvider`; `/pricing` (5.1) Free vs Pro; test checkout sets `Business.plan`; Free limits to one bookable staff. (FR-27)
- [ ] **P3.9 BE/FE** Deposit: settings (threshold, amount); new migration adds `PENDING_PAYMENT` to the constraint; hold 15 min; `/pay/[token]` (5.2); server-side verify; expiry job → cancel + waitlist; `WhishTestProvider` only if credentials arrive. (FR-26)
- [ ] **P3.10 QA** Tests for outcomes/counters, pilot report maths, CSV, payments (fake), deposit hold/expiry; E2E `outcome.spec.ts`; RTL E2E.

## Phase 4 — Polish, docs, demo (6–8 Nov)
- [ ] **P4.1 FE** `design-qa` pass on every route at 360/768/1440 + RTL; fix blocking items; premium polish (skeletons, empty/error states, motion, focus); Lighthouse mobile a11y ≥ 90 on `/b/[slug]`, `/app`, `/app/reminders`.
- [ ] **P4.2 QA** NFR-09 seeded load test (10 staff, 14 days) as a non-blocking CI job.
- [ ] **P4.3 BE** README (setup, architecture, key decisions from `docs/ARCHITECTURE.md`), ERD in `docs/DATA_MODEL.md`, committed `openapi.json`, `docs/REQUIREMENTS.md` statuses.
- [ ] **P4.4 H** Run `ship-check`; record the 3-min demo + 60-s backup video; final DoD tick.
