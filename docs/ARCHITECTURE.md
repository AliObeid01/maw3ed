# Maw3ed — architecture

One Next.js app on free tiers. Route handlers validate and authorise, the service layer holds the logic, and
repositories are the only code that touches Prisma. The two hard guarantees live in Postgres; the slot logic is a pure function.

```
 Client phone ─┐                         ┌─ cron-job.org (every 5 min) ─┐  + GitHub Actions backup cron
 Staff phones ─┤                         │                              │
               ▼                         ▼                              │
 ┌──────────── Next.js on Vercel ───────────────────────────────────────┐
 │ Route handlers   src/app/api/**     Zod, session/role/token/cron guard│
 │ Services         src/server/services  booking · reminders · waitlist │──► Resend (EmailProvider)
 │                                        outcomes · pilot · setup · auth│──► Whish test / Fake (PaymentProvider)
 │ Domain (pure)    src/server/domain    generateSlots · windows · tokens│
 │ Repositories     src/server/repositories  Prisma, businessId-first    │
 └──────────────────────────────┬───────────────────────────────────────┘
                                ▼
              Neon Postgres: exclusion constraint (no double booking)
                             unique (appointmentId, kind, channel) (no double send)
```

## Folder layout
```
src/app/(public)/b/[slug]/page.tsx            booking stepper (1.1–1.6)
src/app/(public)/b/[slug]/waitlist/page.tsx   1.7
src/app/(public)/b/[slug]/booked/[token]/     1.5 (shareable)
src/app/(public)/l/[token]/                   2.1–2.2 confirm / cancel
src/app/(public)/o/[token]/                   2.3 waitlist offer
src/app/(public)/pay/[token]/                 5.2 deposit
src/app/(public)/pricing/                     5.1
src/app/(auth)/signup|login|invite/[token]/   3.1–3.3
src/app/app/                                  dashboard (AppShell) 3.4–3.9, 4.1–4.8
src/app/api/**/route.ts                       route handlers only
src/server/http/        withRoute, AppError, errors, session, requestContext, logger
src/server/contracts/   Zod schemas + OpenAPI registry
src/server/domain/      slots.ts, reminderWindows.ts, tokens.ts, phone.ts, noShow.ts, waitlistMatch.ts, pilotMetrics.ts
src/server/services/    auth, setup, booking, reminders, links, waitlist, outcomes, clients, pilot, billing
src/server/repositories/ *.repo.ts, db.ts (Prisma singleton)
src/server/providers/   email/{EmailProvider,ResendEmailProvider,FakeEmailProvider}, payment/{PaymentProvider,WhishTestProvider,FakePaymentProvider}
src/emails/             react-email templates
src/components/{ui,brand,public,app}
messages/{en,ar}.json
prisma/schema.prisma, migrations/, seed.ts
scripts/{design,db,i18n}/
tests/{unit,integration,e2e}
```

## Request lifecycle
1. `withRoute(config, handler)` creates `requestId`, a child pino logger, and parses params/query/body/headers with Zod (`.strict()`).
2. Guard by mode: `session` (cookie → `Session` → Membership → `ctx.businessId`, `ctx.role`), `public` (no auth; the service resolves the slug),
   `token` (HMAC verify → `ctx.token`), `cron` (constant-time `x-cron-secret`).
3. Handler calls one service. Services enforce roles and pass `ctx.businessId` to repositories.
4. Errors → `{ error: { code, message, fields } }` with the status table in the `api-endpoint` skill. Unknown errors → 500 + Sentry.

## Engineering heart

### 1. Slot generation (`domain/slots.ts`)
`generateSlots(input) → Slot[]`, pure. Input: service duration and buffer; for each eligible staff member their weekly
intervals (`weekday`, `startLocal`, `endLocal`), time off (UTC), busy intervals (`startAt → blockedUntil`); `slotStepMin`,
`minNoticeMin`, `bookingWindowDays`, `timezone`, `now`, and a `from`/`to` range.
For each local day in range and each staff member:
1. Build that day's working intervals in local time with Luxon (`DateTime.fromObject({...}, { zone })`) and convert to UTC instants.
   A wall time that doesn't exist (Beirut springs forward at 00:00) moves forward; a repeated hour uses the earlier offset. Tests pin this.
2. Subtract time off and busy intervals (interval arithmetic on epoch ms).
3. Walk each free interval from its start in `slotStepMin` steps, aligned to the local step grid; emit `start` when
   `start + duration + buffer ≤ interval.end` and `start ≥ now + minNotice` and `start < windowEnd`.
4. "Anyone": union of starts across staff; each slot keeps the candidate staff ids. On booking, the service picks the free
   candidate with the fewest bookings that local day (ties → stable order by staff id).
The repository loads all inputs for the range in a fixed number of queries (no N+1), keeping NFR-09 (< 300 ms p95).

### 2. No double booking (Postgres exclusion constraint)
The hand-written migration `appointment_no_overlap` (see the `db-migration` skill) excludes overlapping
`tstzrange(startAt, blockedUntil, '[)')` per `staffId` while the status is `BOOKED`, `CONFIRMED` or `PENDING_PAYMENT` (a 15 minute deposit hold).
- The booking service re-checks availability first, to give a friendly answer, then inserts. Postgres `23P01` → 409 `SLOT_TAKEN` + fresh slots.
- `Idempotency-Key` header: stored on `Appointment.idempotencyKey` with unique `(businessId, idempotencyKey)`; a repeat returns the first booking.
- One insert path for public bookings, front-desk bookings, waitlist claims and deposits.
- Cancelling sets `CANCELLED` / `LATE_CANCEL`, which drops the row out of the constraint and frees the slot.

### 3. Reminders that never send twice
1. **Create**: the booking transaction inserts `ReminderJob` rows: `BOOKING/EMAIL` (immediately), `H24/EMAIL`, `H2/EMAIL`, `H24/WHATSAPP`, `H2/WHATSAPP`,
   skipping kinds already past (booked < 24 h ahead → no H24; < 2 h → no H2). Unique `(appointmentId, kind, channel)`.
2. **Trigger**: `POST /api/jobs/reminders` every 5 min (cron-job.org + GitHub Actions backup). It works on "whatever is due", so late or doubled triggers are harmless.
3. **Requeue**: `SENDING` rows locked more than 10 min ago → `PENDING` (crash recovery).
4. **Claim**: one `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`, at most 50 rows.
5. **Re-check**: appointment no longer active, or the window has passed (H24 after the 2 h mark; H2 within 15 min of start) → `SKIPPED`.
6. **Send**: `EmailProvider.send({ idempotencyKey: job.id, … })`. Resend returns the original result for a repeated key within 24 h.
7. **Record**: `SENT` + `providerMessageId` + `sentAt`; failure → `PENDING` with `nextAttemptAt` backoff (1, 5, 15 min); `FAILED` after 3 attempts.
8. **WhatsApp** rows are never sent by the server: they appear in `/api/reminders/whatsapp-due` once due, and
   `mark-sent` runs `UPDATE … WHERE id=? AND status='PENDING'`; zero rows updated → 409 with `sentBy`/`sentAt`.
9. **Email budget**: a daily count of SENT emails; warn at 80 (NFR-10); at ≥ 95, BOOKING confirmations are skipped before any reminder.

### Waitlist
Cancel (link or staff) → `waitlist.onSlotFreed(appointment)` → match `WaitlistEntry` rows (same service, date range covers the slot,
staff null or equal, status OPEN) ordered by `createdAt` → create `WaitlistOffer`s for the first batch of 3 (unique per entry per freed slot),
`expiresAt = min(now + 30 min, slotStart − minNotice)` → email with a signed claim token. Claim → booking service (same insert, so the
first claim wins and others get 409) → the offer is CLAIMED, the entry FULFILLED. `POST /api/jobs/waitlist-expiry` expires offers and
offers the next batch until the slot is inside the minimum notice.

### Signed links
`token = base64url(payload) + "." + base64url(HMAC-SHA256(LINK_SECRET, payload))`, payload `{ a: appointmentId | o: offerId, act: 'view'|'confirm'|'cancel'|'claim'|'pay', exp }`.
Verified with `timingSafeEqual`. Appointment links expire at `startAt`; offer links at `expiresAt`. The confirm and cancel pages load
with GET (no side effect) and act with POST, so email link scanners can't cancel an appointment.

## Key decisions (copy into the README)
| Decision | Why |
|---|---|
| Exclusion constraint in a hand-written SQL migration | The database is the referee; no application race can create an overlap. Prisma can't express it. |
| `FOR UPDATE SKIP LOCKED` + unique job key + provider idempotency key | Three independent layers make a duplicate send impossible to record, to claim and to deliver. |
| External scheduler (cron-job.org) instead of Vercel Cron | Vercel Hobby cron runs once a day; the job route is idempotent, so a backup scheduler is safe. |
| Custom session table instead of Auth.js | Credentials provider forces JWT sessions; we need server-side revocation and a business-scoped session. |
| Repository-owned transactions (`account.repo`, `invite.repo`) | Signup and invite-accept must commit several tables atomically; the Prisma transaction handle may only live in `src/server/repositories`, so those repos expose one method per transaction (an accepted exception to "one repo per entity"). |
| Luxon for time | Explicit zone-aware local → UTC conversion; DST handling is covered by tests. |
| WhatsApp via `wa.me` prefilled links | No paid Business API; the receptionist sends from their phone and the server records who sent it. |
| No locale prefix in URLs | Keeps `/b/{slug}` stable for sharing on Instagram and WhatsApp. |
| Fake providers in tests | The fakes record calls, which is how "sent exactly once" is asserted. |
| Login throttle: three dimensions in Postgres (`RateLimitBucket`) | Counted BEFORE the password check (atomic upsert, no read-then-write race): (1) email+IP 5 / 15 min, checked first so hammering one locked account never spends the NAT's budget; (2) IP 20 / 15 min across emails (skipped when the address is unknown); (3) email 30 / hour across IPs, a loose ceiling against rotating addresses. A success clears (1) and refunds its hits in (2) and (3) in the exact window they were taken. IPv6 is keyed by /64, IPv4-mapped addresses by their IPv4. Accepted residual risk: an attacker with many /64s can still burn a victim's 30 / h and lock that email for up to an hour; the alternative (no ceiling) is worse. If the store errors or times out (300 ms) the login guard falls back to per-instance memory counters; route limits fail open and log `rate_limit_fail_open` (alert on it). |
| Client address: Vercel-only trust | `x-vercel-forwarded-for` is set by Vercel's edge and cannot be forged. `x-real-ip` / `x-forwarded-for` are client-controlled anywhere else, so they are honoured only when `VERCEL` is set or `TRUST_PROXY_HEADERS=1`. With no trustworthy address the key is `unknown`: per-IP budgets are skipped (a shared bucket would lock everyone out), email-keyed ones still apply, and production logs a warning once per process. |
| Per-instance argon2 gate | At most 3 concurrent password hashes per server instance, queue wait up to 5 s, then 503 `SERVICE_BUSY` (Retry-After 2). It protects one instance's CPU and memory; on serverless the fleet total is N instances x 3, so the Postgres limits are what bound the whole fleet. |
| Cacheable reads count in memory first | Slots, public page, directory and link/offer GETs write to Postgres only once an instance has seen 50% of the limit for that IP and window; once limited, the instance answers 429 from memory until the window ends. Mutating routes always write. |
| E.164 phones | One client per `(businessId, phone)` regardless of how staff typed it. |
