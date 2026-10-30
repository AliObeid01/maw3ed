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
- [x] **P0.9 H** Accounts and secrets from `docs/HUMAN_TASKS.md` §1–5 (Neon prod, Vercel, Resend verified domain, cron-job.org done 30 Oct; Sentry is optional and not set up). Pilot recruiting is tracked in P2.17.

## Phase 1 — Engine proven (29–31 Oct) · gate: slots + no-overlap + isolation tests green
- [x] **P1.1 BE** `prisma/schema.prisma`: all entities from `docs/DATA_MODEL.md`, businessId-first indexes, uniques, enums. (FR-01…24 data)
- [x] **P1.2 BE** Hand-written migration `appointment_no_overlap` + CHECKs + reminder partial index; `scripts/db/check-constraints.sql`, `check-overlaps.sql`. (NFR-07)
- [x] **P1.3 BE** `prisma/seed.ts`: "Studio Nour" (Hamra, Beirut; Lina owner+bookable, Karim, Jad, receptionist Rana; the five board services) + a second business for isolation tests.
- [x] **P1.4 BE** `src/server/http`: `withRoute`, `AppError`, error mapper (23P01→409, 23505→409), request id + pino logger, OpenAPI registry + `openapi:generate/check`. (NFR-02, NFR-11)
- [x] **P1.5 BE** `domain/slots.ts` `generateSlots` with TDD: split shifts, long service, buffers, time off, min notice, window edge, DST days (Asia/Beirut), "anyone" merge + least-booked pick. (FR-09, NFR-06)
- [x] **P1.6 BE** `domain/tokens.ts` (HMAC sign/verify, scope, expiry), `domain/phone.ts` (E.164, default LB), `domain/reminderWindows.ts`. (NFR-03, FR-15, FR-17)
- [x] **P1.7 BE** Auth: `POST /api/auth/signup` (Business + User + Membership OWNER + owner StaffMember, slug check), login/logout, `Session` table, argon2, cookie flags, `requireRole`. (FR-01, FR-02, NFR-03)
- [x] **P1.8 BE** Invites: `POST /api/invites`, `POST /api/invites/{token}/accept` (hashed, single-use, expiring), invite email via `EmailProvider` + `FakeEmailProvider`. (FR-02)
- [x] **P1.9 QA (tenant.isolation todos and the 10-parallel booking test move to P2.9)** `tenant.isolation.test.ts` scaffold + `booking.concurrency.test.ts` (red until P2.3); unit tests for tokens/phone/windows/guards.
- [x] **P1.10 FE** `PublicHeader`, `BusinessHero`, `StepRail`, `Button`/`IconButton`/`Input`/`Card`/`Chip`/`StatTile`/`Sheet` primitives.
- [x] **P1.11 FE** `AppShell`: sidebar (`lg+`), bottom tab bar + More sheet + FAB (< `lg`), badge slots, active state.
- [x] **P1.12 FE** Screens 3.1 sign up, 3.2 sign in, 3.3 accept invite → wired to P1.7/P1.8.

## Phase 2 — Core flow live (31 Oct – 3 Nov) · gate: pilots go live 3 Nov
- [x] **P2.1 BE** Setup CRUD: `/api/services`, `/api/staff` (+ services performed, bookable, active), `/api/staff/{id}/hours`, `/api/staff/{id}/time-off`, `GET/PATCH /api/business`. (FR-04…07)
- [x] **P2.2 BE** Public read: `GET /api/public/{slug}`, `GET /api/public/{slug}/slots` (one query per range; < 300 ms p95). (FR-08, FR-09, NFR-09)
- [x] **P2.3 BE** (note: `pickStaff` does not re-check availability; the insert under the exclusion constraint is the only referee, and on 23P01 for an "anyone" booking retry the next candidate before returning 409) Booking service (one insert path for public, front desk, waitlist claim, deposit): client upsert by phone, friendly re-check, insert with `blockedUntil`, 23P01 → 409 + fresh slots, `Idempotency-Key`, reminder jobs created in the same transaction. `POST /api/public/{slug}/bookings`, `GET/POST /api/appointments`. (FR-08, FR-10, FR-11, FR-15)
- [x] **P2.4 BE** Reminder job runner `POST /api/jobs/reminders` (cron secret): requeue stuck, claim SKIP LOCKED, re-check, send via `ResendEmailProvider` with idempotency key, record SENT/backoff/FAILED, daily count + warn at 80. (FR-13, FR-16, NFR-08, NFR-10)
- [x] **P2.5 BE** Booking confirmation email (kind BOOKING) + `.ics` attachment; email templates (react-email) for BOOKING/H24/H2. (FR-12, FR-13)
- [x] **P2.6 BE** Links: `GET/POST /api/links/{token}` confirm/cancel; late cancel after the cutoff; cancel skips pending reminders and triggers the waitlist. Staff cancel `POST /api/appointments/{id}/cancel`. (FR-15, FR-17)
- [x] **P2.7 BE** WhatsApp: `GET /api/reminders/whatsapp-due` (with prefilled `wa.me` URL), `POST /api/reminders/{id}/mark-sent` (conditional update; second call → 409 with "sent by X at T"). (FR-14)
- [x] **P2.8 BE** Waitlist: `POST /api/public/{slug}/waitlist`; on cancel → `domain/waitlistMatch` → offer batch (3) by email with signed claim token; `POST /api/offers/{token}/claim` through P2.3; `POST /api/jobs/waitlist-expiry` cascades until the slot is within min notice. (FR-18…20)
- [x] **P2.9 QA (done as dedicated suites; the registry-wide validation sweep and the clients isolation todos remain)** Proof tests green: `booking.concurrency`, `reminders.idempotency`, `links`, `waitlist.claim`, `validation.routes`, `tenant.isolation` (all entities).
- [x] **P2.10 FE** Booking stepper `/b/[slug]` 1.1–1.4 + 1.5 booked + 1.6 slot taken; mobile sticky summary/CTA; ≤ 4 screens. (FR-08, NFR-05)
- [x] **P2.11 FE** (2.1 confirm/cancel and 2.2 cancelled are DONE in #19; 1.7 join waitlist and 2.3 waitlist offer remain, with P2.8) 1.7 join waitlist; 2.3 waitlist offer.
- [x] **P2.12 FE** Setup 3.4 checklist, 3.5 services, 3.6 staff, 3.7 hours & time off (several intervals per day), 3.8 settings, 3.9 share link (copy, QR, WhatsApp/Instagram share).
- [x] **P2.13 FE** 4.1 Today (stat tiles, calendar grid `lg+`, agenda list mobile, "Do this first" WhatsApp card, "Needs you", waitlist activity).
- [x] **P2.14 FE** 4.2 Reminders due (one-tap `wa.me`, optimistic mark-sent, disabled "sent by …" state, red badge count). (FR-14)
- [x] **P2.15 FE** 4.3 Front-desk booking (phone/walk-in, same slot engine, client lookup by phone, < 30 s). (FR-11)
- [x] **P2.16 QA** E2E `booking.spec.ts` (Pixel 5) green against preview.
- [ ] **P2.17 H** DONE 30 Oct: cron-job.org jobs live (3 jobs return 200), GitHub backup workflow green, production phone test (booking email arrived in the inbox, confirm and cancel links work). OPEN: 24 h reminder end-to-end check (email + WhatsApp item appear by themselves), **onboard pilots** (`docs/PILOT_PLAYBOOK.md`), enter baselines.

## Phase 3 — History, pilot report, extras (3–6 Nov)
- [x] **P3.1 BE** `PATCH /api/appointments/{id}/outcome` (ATTENDED / NO_SHOW / LATE_CANCEL; only after start; counters in the same transaction; idempotent re-mark adjusts counters). (FR-21)
- [x] **P3.2 BE** Mark-outcome queue query + badge count; `GET /api/clients`, `GET /api/clients/{id}` (visits, no-shows, late cancels, history); `DELETE /api/clients/{id}` (owner; anonymise past appointments). (FR-22, FR-23, NFR-04)
- [x] **P3.3 FE** 4.4 Mark outcome, 4.5 Appointment, 4.6 Clients, 4.7 Client history; `NoShowBadge` everywhere a booking shows. (FR-21…23)
- [x] **P3.4 BE** `GET/PUT /api/pilot/baseline`, `GET /api/pilot/report` (weekly no-show rate vs baseline, raw counts, abs/rel change, confirm rate, link cancels, refill rate). (FR-24)
- [x] **P3.5 FE** 4.8 Pilot report (accessible chart + table with raw counts; baseline form). (FR-24)
- [x] **P3.6 BE/FE** CSV export `GET /api/pilot/export.csv` + button. (FR-25)
- [ ] **P3.7 FE** Arabic: full `ar.json`, RTL pass on every screen, Arabic email + WhatsApp templates, language toggle on public pages. (FR-28)
- [ ] **P3.8 BE/FE** `PaymentProvider` + `FakePaymentProvider`; `/pricing` (5.1) Free vs Pro; test checkout sets `Business.plan`; Free limits to one bookable staff. (FR-27)
- [ ] **P3.9 BE/FE** Deposit: settings (threshold, amount); new migration adds `PENDING_PAYMENT` to the constraint; hold 15 min; `/pay/[token]` (5.2); server-side verify; expiry job → cancel + waitlist; `WhishTestProvider` only if credentials arrive. (FR-26)
- [ ] **P3.10 QA** Tests for outcomes/counters, pilot report maths, CSV, payments (fake), deposit hold/expiry; E2E `outcome.spec.ts`; RTL E2E.

## Phase 4 — Polish, docs, demo (6–8 Nov)
- [ ] **P4.1 FE** `design-qa` pass on every route at 360/768/1440 + RTL; fix blocking items; premium polish (skeletons, empty/error states, motion, focus); Lighthouse mobile a11y ≥ 90 on `/b/[slug]`, `/app`, `/app/reminders`.
- [ ] **P4.2 QA** NFR-09 seeded load test (10 staff, 14 days) as a non-blocking CI job.
- [ ] **P4.3 BE** README (setup, architecture, key decisions from `docs/ARCHITECTURE.md`), ERD in `docs/DATA_MODEL.md`, committed `openapi.json`, `docs/REQUIREMENTS.md` statuses.
- [ ] **P4.4 H** Run `ship-check`; record the 3-min demo + 60-s backup video (Thu 12 Nov); final DoD tick.
- [ ] **P4.5 FE** Public home page at `/` (today it is only the logo and tagline): hero with the value line, how it works in three steps (client books, reminders go out, no-shows drop), "Find a business" button to `/directory`, "Set up your business" to `/signup`, "Sign in" to `/login`; phone-first, en/ar, language toggle. Built after D2 so the directory link works. (Added 30 Oct.)

---

## Follow-ups from reviews (non-blocking, schedule alongside the phase that touches them)
- [x] **F1 FE** Focus ring is invisible on `bg-hero` and `primary` buttons: white outline on dark surfaces + `outline-offset-2` (before the public hero, P2.10).
- [x] **F2 FE** `Button`: add `ghost`/`danger` variants, 46 px row size, `loading` prop (spinner, `aria-busy`, disabled), `clsx`+`tailwind-merge` for className (P1.10).
- [x] **F3 FE** `Logo`: optional `label` (decorative = `aria-hidden`), fix the SVG `fontFamily` to use the next/font CSS variable, `tone` prop for a white logo on the hero, derive height from width (P1.10).
- [x] **F4 FE/BE (done in #19: proxy sets the locale cookie; per-business default via a client hint, see F14)** `?lang=` handoff: `src/proxy.ts` (Next 16) sets the `locale` cookie from `?lang=` and forwards `x-locale`/`x-business-locale`; export `LOCALE_COOKIE` from `src/i18n/config.ts`; resolution order per the `i18n-rtl` skill. Needed before the public booking page (P2.10).
- [ ] **F5 (viewport done in #7; timeZone remaining) FE** `NextIntlClientProvider` needs `timeZone` from `Business.timezone` once business context exists; add a `viewport` export (P1.11).
- [ ] **F6 QA** `check-keys.mjs`: compare ICU placeholder names and empty values; typed message keys (`AppConfig.Messages`); remove the `[ -f ... ]` skip guards in `ci.yml` for the i18n check now that it exists. Unit-test `isLocale`/`dirFor` (P1.9).
- [ ] **F7 BE** Security headers (CSP, `X-Frame-Options`) and `Referrer-Policy: no-referrer` on `/l`, `/o`, `/pay` (token in URL) (P4.1).
- [ ] **F8 FE** `muted` (#737C79) is about 4.3:1 on canvas, slightly under AA for normal text; `subtle` is lower. Use `subtle` only for placeholders; decide on darkening `muted` in the design-qa pass (P4.1).
- [ ] **F9 QA** Playwright `webServer` needs `pnpm build` first and test env vars; add an e2e CI job with `playwright install --with-deps chromium` (P2.16).
- [ ] **F10 FE** Remove the stale `design/app-shots/` folder (gitignored; the safety check blocked an automated delete).
- [ ] **F11 FE** Scope client messages per namespace: `NextIntlClientProvider` currently ships every namespace (including `dev.*`) to the browser; pass only the namespaces each route needs.
- [ ] **F12 FE** Narrow `use client` boundaries: `AppShell` and `StepRail` are fully client components; split the interactive parts (More sheet trigger, back button) so the rest renders on the server.

## Deployment and operations (done 30 Oct)
- [x] **O1** Production on Vercel at `https://maw3edlb.com` (`www` redirects to the bare domain), Node 22, region Frankfurt, Neon production branch with all 7 migrations applied by the production build, health check green.
- [x] **O2** Resend sending domain `mail.maw3edlb.com` verified; real emails arrive in the inbox.
- [x] **O3** cron-job.org: reminders and waitlist-expiry every 5 min, cleanup daily; `CRON_SECRET` rotated after an accidental exposure; failure notifications on. GitHub Actions backup runs.
- [x] **O4 H** Real phone test of the booking, confirmation email, confirm and cancel links.
- [ ] **O5 H** Resend click tracking off; Neon usage check; optional DMARC record; optional Sentry DSN.
- [ ] **O6 H** 24 h reminder end-to-end check (user will report).
- [ ] **O7 H** Reserved-slug SQL check on the production database before the first public pilot (`docs/HUMAN_TASKS.md` §9).
- [ ] **O8 FE/BE** Flow adjustments from the production phone test (user is compiling the list; add each as an F item).
- Branch protection on `main` is NOT possible on the free private repo (rules are not enforced); process rule instead: every change goes through a PR with green CI.

## Launch gates (must be done before the pilot goes live)

- [x] **L1 Shared login throttle.** Today's throttle is an in-memory map (per serverless instance, reset on cold start). Replace it with a shared store (Postgres table or Redis), keyed email + IP, plus a per-IP budget and a global argon2 concurrency/rate limit (this also protects signup, slug-check and unknown-email floods, which each cost an argon2 hash or a DB query). Known weakness until then: anyone can lock a victim out of login for 15 minutes by failing 5 times against their email.
- [x] **L2 Session and invite hygiene.** Cron job to purge expired `Session` and `Invite` rows; add an absolute session lifetime (e.g. 90 days) on top of the 30-day sliding expiry; add a "sign out other sessions" option.
- [ ] **L3 Staff removal revokes sessions.** When staff removal is built, delete that user's sessions for that business in the same transaction (otherwise a stale cookie revives access if they are re-added within 30 days).
- [ ] **L4 No email verification at signup.** Consequence: an attacker can pre-register someone's address so that a later invite to it hits an existing account (accept then needs that account's password, so it fails for the real person). There is no account takeover, but it is a squatting/DoS vector. Decide whether to add email verification before launch.
- [x] **L5 Referrer-Policy (done for /invite, /l, /o)** Send `Referrer-Policy: no-referrer` on `/invite/[token]` and every other page that carries a token in its URL (confirm/cancel/offer/pay links), so tokens never leak through the Referer header.
- [x] **L6 Platform rate limiting.** Put rate limiting in front of the public routes (Vercel Firewall rules) for signup, login, slug-check, invite preview/accept and the signed-link routes.

## Follow-ups from Phase 2 reviews and the real-API journey (non-blocking)
- [x] **F13 BE** Expose `bookingWindowDays` and `cancelCutoffMin` in `GET /api/public/{slug}` so the booking page stops probing 14 -> 7 -> 3 -> 1 days and can say 'free cancellation until ...'.
- [x] **F14 FE** First visit to a business whose language differs from the visitor's renders once in the default language, then refreshes (client `locale_hint`). Resolve the business locale server-side for `/b/[slug]` and `/l/[token]`.
- [ ] **F15 FE** Email templates: brand colours (teal button for confirm, canvas background) instead of neutral greys; keep web-safe `Arial` stack (email clients cannot load Outfit). Decide whether to ignore the design hook's overused-font finding for emails.
- [ ] **F16 BE** Verified or per-appointment contact email (today one mutable email per client; public bookings can only fill an EMPTY email on an existing client).
- [x] **F17 FE** The booked screen does not survive a refresh (manage link is in the confirmation email afterwards); consider persisting the manage link for the session.
- [ ] **F18 QA** Real-API journey (signup -> setup -> client booking -> reminder runner -> confirm/cancel links) is currently a throwaway script; keep a cleaned-up version as a CI-able smoke test against the CI Postgres.
- [ ] **F19 BE** `DST fall-back`: `time=HH:mm` in the booking URL is ambiguous for the one repeated hour per year in Beirut (24 Oct 23:xx); serialise with offset if it ever matters.
- [ ] **F20 QA** Playwright full-run is CPU-sensitive when other heavy processes run (auth specs time out); run per spec or lower workers locally; consider `workers: 2` in config.

## Added scope: public directory (team decision, 29 Oct)
- [x] **D1 BE** `Business.published` flag (migration, default false for new businesses; the seeded demo businesses and existing rows published) + `published` and `publishedAt` in `GET/PATCH /api/business` (owner only; publishing requires at least one active service and one bookable staff member with hours, else 409 `NOT_READY` with the missing items); `GET /api/public/directory?query=&category=&cursor=&limit=` (public, no auth) returning only published businesses `{businesses:[{slug,name,category,address,serviceCount,fromPrice}], nextCursor}`; `GET /api/public/{slug}` and `/slots` and `POST .../bookings` return 404 for an UNPUBLISHED business (the owner previews via the dashboard); tests incl. tenant/unpublished isolation, no PII or owner data in the directory, pagination.
- [ ] **D2 FE (see F24; BUILD approved by the user 30 Oct)** Public `/directory` page (simple list of cards: monogram, name, category, address, 'from $X', 'Book' button to `/b/{slug}`; search box by name; empty state; phone-first; en/ar), a link from the public header, and the owner's publish toggle with the readiness checklist on the Share page and Setup checklist (step 'Publish').
- Out of scope: ratings, maps, filters beyond name/category, SEO pages.

## Notes from the launch-gates and waitlist work (open follow-ups)
- [x] **F21 BE** Waitlist: the same entry claiming two DIFFERENT slots at the very same instant could book both (sequential case is blocked and tested); needs an atomic reservation on the entry.
- [ ] **F22 QA** Flaky: `waitlist.test.ts > the limit holds under concurrent joins` (8 concurrent joins) failed in some full runs against the remote Neon dev database and passed alone and in CI; investigate whether it is a slow-DB timeout or a real race in the advisory-lock path.
- [x] **F23 BE** Add a one-click 'remove me from the waitlist' link to the offer email (today the only way off the list is contacting the business, a staff delete, or the end of the date range).
- [ ] **F24 BE/FE** D2: public `/directory` page and the owner's 'list my business' toggle with the readiness checklist (the backend D1 uses `Business.listed`, opt-in, default false; unlisted businesses stay reachable by direct link: the plan text above says `published`, the implementation is `listed`).
- [ ] **F25 BE** Argon2 concurrency cap is per instance on serverless; rate limits in Postgres are what bound the fleet. Revisit if the signup/login flood risk matters.
- [ ] **F26 QA** Before launch run the reserved-slug check from docs/HUMAN_TASKS.md and the real-stack waitlist journey (cancel -> offer email -> claim in a browser): not yet run end to end against a real database.
- [ ] **F27 BE** `src/i18n/request.ts` imports repositories directly (layering): move the business-locale lookup behind a service and wrap it in React `cache` so one request does one lookup.
- [ ] **F28 FE** `loadSlotWindow` (`src/lib/booking/window.ts`) has no fallback when a known `bookingWindowDays` is still rejected with 400 on `to` (for example the owner shortened the window meanwhile).
