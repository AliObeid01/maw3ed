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
 │                                        outcomes · pilot · setup · auth│──► Fake (PaymentProvider, test mode)
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
src/server/services/    auth, setup, booking, reminders, links, waitlist, outcomes, clients, pilot, billing, pay, directory
src/server/repositories/ *.repo.ts, db.ts (Prisma singleton)
src/server/providers/   email/{EmailProvider,ResendEmailProvider,FakeEmailProvider}, payment/{PaymentProvider,FakePaymentProvider} (a real provider is not built)
src/server/i18n/        email rendering (emailRender.ts) and the server-side business locale lookup (en, ar)
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
**F33 speed:** the profile showed ~60 % of a request in Luxon `IANAZone.offset` (an Intl format on every call, thousands per request). The generator now memoises zone offsets per hour bucket (a bucket that contains a transition is never cached, so DST answers still come from Luxon), memoises local-to-UTC conversions, walks the calendar days once per call, and scans only the time-off/busy intervals that overlap each working interval. Output is proven identical to the pre-change code by `tests/unit/booking/slots.f33.equivalence.test.ts`. These are memoised pure functions of the immutable tz database: no business data is cached.

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
offers the next batch until the slot is inside the minimum notice, and first sweeps lapsed deposit holds (each frees a slot and offers it at once).
A claim first takes an atomic reservation on the entry (`claimingOfferId` / `claimingAt`, 60 s lease) so one entry cannot book two slots at the same instant;
a claim that needs a deposit leaves the entry reserved while its hold is live (see the key decisions).

### Signed links
`token = base64url(payload) + "." + base64url(HMAC-SHA256(LINK_SECRET, payload))`, payload `{ a: appointmentId | o: offerId, act: 'view'|'confirm'|'cancel'|'claim'|'pay', exp }`.
Verified with `timingSafeEqual`. Appointment links expire at `startAt`; offer links at `expiresAt`. The confirm and cancel pages load
with GET (no side effect) and act with POST, so email link scanners can't cancel an appointment.

## Key decisions
| Decision | Why |
|---|---|
| No cache of slot inputs or responses (F33) | Measured: after removing the Luxon offset cost the endpoint is bound by row decoding and the domain loop, not by the settings/staff/hours reads, so a TTL cache would save little and add stale-data risk. Slots stay uncached (no CDN/HTTP caching); the booking insert, its friendly re-check and the exclusion constraint always read fresh data. |
| Exclusion constraint in a hand-written SQL migration | The database is the referee; no application race can create an overlap. Prisma can't express it. |
| `FOR UPDATE SKIP LOCKED` + unique job key + provider idempotency key | Three independent layers make a duplicate send impossible to record, to claim and to deliver. |
| External scheduler (cron-job.org) instead of Vercel Cron | Vercel Hobby cron runs once a day; the job route is idempotent, so a backup scheduler is safe. |
| Custom session table instead of Auth.js | Credentials provider forces JWT sessions; we need server-side revocation and a business-scoped session. |
| Repository-owned transactions (`account.repo`, `invite.repo`) | Signup and invite-accept must commit several tables atomically; the Prisma transaction handle may only live in `src/server/repositories`, so those repos expose one method per transaction (an accepted exception to "one repo per entity"). |
| Soft email verification (L4) | A new account works at once (login, setup, public booking page); only inviting staff and `listed=true` need a confirmed address, rejected in the SERVICE layer with 409 `EMAIL_NOT_VERIFIED` (a state precondition like `NOT_READY`). Hard-blocking login would lose pilot owners on a spam-foldered email. A pre-existing user is verified by the migration; accepting a staff invite verifies the invitee (the link proves the inbox). |
| Account email tokens (`EmailToken`) | 32 random bytes base64url, only sha256 stored, VERIFY 24 h / RESET 1 h, single use by one conditional `UPDATE … WHERE usedAt IS NULL AND expiresAt > now`, a new token does NOT invalidate older ones (otherwise anyone could kill the link a user is about to click by asking again): at most 5 live unused tokens per user and kind are kept (the oldest are deleted), and a successful use deletes ALL the user's unused tokens of that kind. Trade-off: several valid links may coexist for at most 1 h (reset) / 24 h (verify), all single use. A failed send therefore never leaves a user without a working link. The emailed link opens a page with a button; only the POST changes state (mail scanners prefetch GETs). Tokens and passwords never appear in logs; those pages send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. |
| Forgot password never enumerates users (A1) | `POST /api/auth/forgot-password` does ONLY the rate-limit count before it answers; the user lookup, membership read, token issue, rendering and send all run in `afterResponse` (`after()`), so the response path is identical for known and unknown emails and latency cannot leak existence (a structural test asserts none of it has run when the response resolves). Per-email cap 5 / h: past it the same 200, nothing issued or sent, and NO per-email 429; the per-IP 429 (10 / h) is the same for every email. Failures after the response are logged, never surfaced. Accepted residual: a flood of requests for one address can fill its 5 / h budget and delay that user's reset up to an hour, but their already emailed links keep working. |
| Password reset and change revoke sessions (A1) | Reset deletes EVERY session of the user (all businesses), marks the email verified and kills other open reset links in the same transaction as claiming the token; change-password deletes the user's OTHER sessions and keeps the current one. A wrong current password is a 400 on `currentPassword` (a 401 would make the dashboard assume the session ended). Reset does not sign anyone in. |
| Removing a team member (A2 / L3) | `DELETE /api/team/members/{userId}` (OWNER) runs ONE transaction: delete that user's Sessions for THIS business, unlink the login from their StaffMember (`userId = NULL`, the calendar person, hours and appointments stay; the owner deactivates them separately with the existing toggle), delete any open invite for their email here, delete the Membership. The User row and their memberships and sessions in other businesses are never touched. Nothing is soft-deleted: re-inviting works through the normal invite flow (accept with the existing account) and creates a new non-bookable StaffMember. |
| Last owner and self-removal (A2) | The rule is the pure `checkRemoval` (domain); the SERVICE supplies it as a guard that runs INSIDE the removal transaction, after the business's OWNER memberships are locked (`SELECT … FOR UPDATE`, ordered by id), so two owners removing each other at the same moment cannot both pass: the second sees one owner left and gets 409 `LAST_OWNER`. Removing yourself is 409 `CANNOT_REMOVE_SELF`. Another business's member, an unknown id and an already removed member are all 404. |
| Session defense in depth (A2) | `sessionService.resolve` re-reads the Membership on EVERY request (role included), so a session row that somehow survives a removal is still a 401; an integration test deletes only the Membership row and shows the old cookie is rejected. Deleting the session rows in the same transaction keeps the table clean and means a re-added user cannot revive an old cookie. |
| Revoking an invite deletes the row (A2) | `DELETE /api/team/invites/{id}` (OWNER) deletes an unaccepted invite scoped by `businessId`; the public preview/accept then return the same 404 as for an unknown token. Accepted invites are kept (cleanup removes them later) and cannot be revoked (404). |
| Sign out other sessions (A2) | `POST /api/auth/sign-out-others` (any role) deletes every session of the caller in ALL businesses except the current one and returns `{ removed }`; limited per IP (`signOutOthersIp`, 20 / 10 min). The UI lives in the Settings Account card until F35 gives staff their own Account page. |
| Luxon for time | Explicit zone-aware local → UTC conversion; DST handling is covered by tests. |
| WhatsApp via `wa.me` prefilled links | No paid Business API; the receptionist sends from their phone and the server records who sent it. |
| No locale prefix in URLs | Keeps `/b/{slug}` stable for sharing on Instagram and WhatsApp. |
| Fake providers in tests | The fakes record calls, which is how "sent exactly once" is asserted. |
| Login throttle: three dimensions in Postgres (`RateLimitBucket`) | Counted BEFORE the password check (atomic upsert, no read-then-write race): (1) email+IP 5 / 15 min, checked first so hammering one locked account never spends the NAT's budget; (2) IP 20 / 15 min across emails (skipped when the address is unknown); (3) email 30 / hour across IPs, a loose ceiling against rotating addresses. A success clears (1) and refunds its hits in (2) and (3) in the exact window they were taken. IPv6 is keyed by /64, IPv4-mapped addresses by their IPv4. Accepted residual risk: an attacker with many /64s can still burn a victim's 30 / h and lock that email for up to an hour; the alternative (no ceiling) is worse. If the store errors or times out (300 ms) the login guard falls back to per-instance memory counters; route limits fail open and log `rate_limit_fail_open` (alert on it). |
| Client address: Vercel-only trust | `x-vercel-forwarded-for` is set by Vercel's edge and cannot be forged. `x-real-ip` / `x-forwarded-for` are client-controlled anywhere else, so they are honoured only when `VERCEL` is set or `TRUST_PROXY_HEADERS=1`. With no trustworthy address the key is `unknown`: per-IP budgets are skipped (a shared bucket would lock everyone out), email-keyed ones still apply, and production logs a warning once per process. |
| Per-instance argon2 gate | At most 3 concurrent password hashes per server instance, queue wait up to 5 s, then 503 `SERVICE_BUSY` (Retry-After 2). It protects one instance's CPU and memory; on serverless the fleet total is N instances x 3, so the Postgres limits are what bound the whole fleet. |
| Cacheable reads count in memory first | Slots, public page, directory and link/offer GETs write to Postgres only once an instance has seen 50% of the limit for that IP and window; once limited, the instance answers 429 from memory until the window ends. Mutating routes always write. |
| Deposit hold reveals phone history (accepted pilot risk) | A public booking answers `PENDING_PAYMENT` instead of a booking when the phone has reached the no-show threshold, so someone who knows a number can learn it has missed appointments at that business. Mitigations: the answer names no reason or count, and bookings are limited per normalized phone (6 per 15 min, any IP, Postgres limiter). Residual: a slow, patient prober still learns it. Accepted for the pilot; follow-up F29 (email or OTP proof of phone control before a hold is shown). |
| A lapsed deposit hold is not re-offered to its owner (F26-3) | Product-owner decision, to avoid ping-pong: when the claimant's 15-minute hold is swept, the slot goes to the other waiters and the claimant's own link answers `HOLD_LAPSED` (offer view status and claim 409) instead of a misleading "cancelled" or "no longer active". It is derived from the offer's booking (source WAITLIST, CANCELLED, cancelledVia SYSTEM, found by the idempotency key `waitlist-offer-<offerId>`), so no migration; the entry stays OPEN for other openings. |
| Deposit hold lifecycle | `PENDING_PAYMENT` holds the slot in `appointment_no_overlap` for 15 minutes. Paying sets `BOOKED` (no `confirmedAt`; the PAID Payment is the proof of deposit, the client can still confirm by link) and creates the reminders once. A lapsed hold is swept by the booking path (scoped, before availability and once more after a 23P01) and by the 5-minute `waitlist-expiry` cron, both `FOR UPDATE SKIP LOCKED`; availability already treats a lapsed hold as free. A waitlist claim that needs a deposit marks the offer CLAIMED / entry FULFILLED only when it is paid. |
| One shared Postgres rate limiter | Every number lives in `services/rateLimitPolicies.ts` (fixed windows, so up to 2x the limit across a boundary is accepted). State is the `RateLimitBucket` table, written by one atomic upsert, so limits hold across serverless instances; `/api/jobs/cleanup` purges old buckets. Public booking has two budgets: per client address (30 / 10 min) and per phone (6 / 15 min, any address). The phone key is an HMAC of the E.164 number with `LINK_SECRET`, never the bare number. Idempotent replays and 400s get their hit refunded. Route limits fail open if the store errors (and log `rate_limit_fail_open`); `RATE_LIMIT_DISABLED=1` is for tests only. |
| `PENDING_PAYMENT` in the constraint, in two migrations | A new enum value cannot be used in the transaction that adds it. `20261031090000_deposit_columns` adds the value (a no-op, the label existed since init), `Business.depositEnabled` (default false) and `Appointment.holdExpiresAt`. `20261031090100_deposit_overlap_constraint` then drops and re-creates `appointment_no_overlap` with the same definition plus `PENDING_PAYMENT`, in one implicit transaction so the table is never unprotected, and adds the partial index `Appointment_pending_hold_idx`. `ACTIVE_APPOINTMENT_STATUSES` in `domain/appointmentStatus.ts` must always match the constraint predicate. A hold has no reminders and no confirmation email until it is paid (`REMINDABLE_STATUSES`). |
| Deposit rule and pay link | `depositRequired` (pure): deposits enabled, source is not `FRONT_DESK`, and the client's `noShows` (matched by E.164 phone within the business) is at least `max(1, depositThreshold)`. The hold is `now + 15 min`; the pay page uses a `pay`-scoped signed link and shows the server's clock for the countdown. Only the fake payment provider exists: nothing is refunded or credited (follow-up F30) and the pay link is not yet emailed (F31). |
| Plan limit under a business row lock | Free allows one active bookable staff member. Every write that adds or re-enables a bookable staff member runs `assertRoomForBookable` inside its transaction, which takes `SELECT ... FOR UPDATE` on the `Business` row first; plan changes (test checkout, downgrade) take the same lock, so a concurrent upgrade and a staff add cannot interleave. Data already over the limit is grandfathered, never touched. |
| Waitlist reservation and the deposit-claim rule | A claim first reserves the entry atomically (`claimingOfferId` / `claimingAt`, 60 s lease, released on failure) so one entry cannot book two different slots at the same instant (F21). When a claim ends in a deposit hold, the offer, the entry and the refill metric are touched only when the deposit is paid; until then a live hold keeps the entry reserved and a second offer of the same entry answers 409. A lapsed unpaid hold leaves no trace. |
| Directory is opt-in | `Business.listed` defaults to false. Listing requires at least one active service and one bookable staff member with hours (else 409 `NOT_READY` with the missing items). Unlisted businesses keep working by direct link. The directory returns only public fields (slug, name, category, address, service count, from price). |
| Business locale resolved on the server | `src/i18n/request.ts` picks the language in this order: `locale` cookie, client hint cookie, the business default for `/b/{slug}`, `/l/{token}` and `/o/{token}` (resolved by slug or from the signed token), then English. The first visit therefore renders once, in the right language. Known debt: that file calls repositories directly (follow-up F27). |
| Build-time `prisma generate` and the Node 22 pin | The generated client lives in `src/generated` (gitignored). `vercel-build` runs `prisma generate` explicitly before `next build` because build caches can skip `postinstall`. Node is pinned to 22 in `.nvmrc` and `engines`, and in the Vercel project. |
| Vercel production migration guard | Only `VERCEL_ENV=production` builds run `prisma migrate deploy`, after `checkProductionEnv` passes (required names, 32+ character distinct secrets, pooled vs direct strings, `EMAIL_PROVIDER=resend`, no seed or test flags). `EXPECTED_DB_HOST` makes the build refuse any other database host. Previews never migrate. Migrations run before the new code is live, so they must stay additive. |
| E.164 phones | One client per `(businessId, phone)` regardless of how staff typed it. |
