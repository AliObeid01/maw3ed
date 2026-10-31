# Maw3ed — tasks only you can do

Claude can't create accounts or hold your credentials. Do these early (Phase 0), then put the values in Vercel env vars,
GitHub Actions secrets and your local `.env`. Never commit secrets.

## Status as of 30 Oct

Done:
- [x] Production deployed on https://maw3edlb.com (Vercel, Node 22, Neon `production` branch; every migration applied by the production build; `/api/health` green).
- [x] Resend sending domain `mail.maw3edlb.com` verified; real emails arrive in the inbox.
- [x] Three cron-job.org jobs live: `/api/jobs/reminders` and `/api/jobs/waitlist-expiry` every 5 minutes, `/api/jobs/cleanup` daily; failure notifications on.
- [x] GitHub backup scheduler (`reminders-backup.yml`) running with the `APP_URL` variable and `CRON_SECRET` secret.
- [x] Real phone test of booking, confirmation email, and the confirm and cancel links.
- [x] Reserved-slug SQL check (section 9 below) and the pre-deploy migration checks (`EXPECTED_DB_HOST` guard, constraint check) are done.

Open:
- [ ] Recruit 3 to 5 pilot businesses and collect their 14-day baselines (`docs/PILOT_PLAYBOOK.md`).
- [ ] 24 h reminder end-to-end check: book an appointment about 25 hours ahead and confirm the email and the WhatsApp "due" item appear by themselves.
- [ ] Resend: turn click tracking off for the domain (tracking can rewrite the links in emails). It must stay OFF: verify-email, reset-password and invite links carry one-time tokens, and a rewritten or pre-fetched tracking link would break or burn them.
- [ ] Neon usage check (storage and compute hours on the free plan).
- [ ] Optional: DMARC TXT record (`_dmarc`) and a Sentry DSN.
- [ ] Record the 3-minute demo and the 60-second backup video on 12 Nov.
- [ ] Native Arabic review of `messages/ar.json` using the checklist in `docs/ARABIC_REVIEW.md`.

| # | Task | Produces | Needed by |
|---|---|---|---|
| 1 | **Neon**: create a project (region close to Beirut, e.g. `aws-eu-central-1`); create `main` (prod) and `dev` branches. `btree_gist` is enabled by the migration. | `DATABASE_URL` (pooled), `DIRECT_URL` | P1.1 (dev), P2.17 (prod) |
| 2 | **Vercel**: import the GitHub repo; set env vars (below) for Production and Preview; create a token. | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (GitHub secrets) | P0.5 |
| 3 | **Resend**: create an account, add and **verify a sending domain** (SPF + DKIM DNS records; DMARC recommended). Without a verified domain Resend only delivers to your own address. | `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Maw3ed <reminders@yourdomain>`) | P2.4 |
| 4 | **cron-job.org**: two jobs every 5 min, `POST https://<prod>/api/jobs/reminders` and `/api/jobs/waitlist-expiry`, header `x-cron-secret: <CRON_SECRET>`. Add a third job, **daily** (for example 03:00): `POST https://<prod>/api/jobs/cleanup` with the same header. It purges expired sessions, old invites and rate-limit buckets; the backup GitHub workflow also calls it daily at 03:00 UTC. Turn on failure notifications. | `CRON_SECRET` (also a GitHub secret for the backup workflow) | P2.17 |
| 5 | **Sentry**: create a Next.js project. | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | P0.5 |
| 6 | **Whish Money** (optional): request merchant test credentials and API docs from the accelerator or Whish onboarding. Until then the FakePaymentProvider is used. | `WHISH_*` | P3.9 |
| 7 | **Pilots**: recruit 3–5 businesses and collect their 14-day baselines (`docs/PILOT_PLAYBOOK.md`). | baselines | P2.17 |
| 8 | **GitHub**: protect `main` (require the CI check, require a PR). | — | P0.5 |
| 9 | **Demo**: record the 3-min demo and the 60-s backup video. | videos | P4.4 |

## Environment variables
```
DATABASE_URL=            # Neon pooled
DIRECT_URL=              # Neon direct (migrations)
DATABASE_URL_TEST=       # local docker postgres for integration tests
APP_URL=                 # https://maw3ed.vercel.app (used in links and emails)
SESSION_SECRET=          # 32+ random bytes
LINK_SECRET=             # 32+ random bytes, HMAC for confirm/cancel/claim/pay links
CRON_SECRET=             # shared secret for job routes
RESEND_API_KEY=
EMAIL_FROM=
EMAIL_PROVIDER=resend    # or "fake" locally
PAYMENT_PROVIDER=fake    # or "whish"
SENTRY_DSN=
```
Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

---

## Production deployment checklist (maw3edlb.com)

The `production` Neon branch exists (the `dev` branch was created from it) but is EMPTY. The first production deploy applies every migration (`scripts/vercel-build.mjs` runs `prisma migrate deploy` for Vercel production builds only; previews never run migrations). Never put the dev connection strings in Vercel Production, and never run the seed against production.

1. **Secrets** (new values, never the local `.env` ones; never paste them in chat or commit them): generate two with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` for `LINK_SECRET` and `CRON_SECRET` (32+ characters, different from each other). `SESSION_SECRET` is not used by the app (sessions are stored in the database).
2. **Neon** (project `maw3ed`, branch `production`, Connect): pooling ON gives `DATABASE_URL` (host contains `-pooler`); pooling OFF gives `DIRECT_URL`.
3. **Vercel**: first add the environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` (all scopes) so Vercel installs with the pnpm version pinned in `package.json` (`packageManager`), because the repo uses pnpm 11 settings. Then import the GitHub repo (Next.js is auto-detected; leave build/install commands, `vercel.json` is not needed because the `vercel-build` script is used), Node.js 22, attach `maw3edlb.com` as the production domain and redirect `www` to it.
   - Production environment variables: `DATABASE_URL`, `DIRECT_URL`, `APP_URL=https://maw3edlb.com`, `NEXT_PUBLIC_APP_URL=https://maw3edlb.com`, `LINK_SECRET`, `CRON_SECRET`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, and (recommended) `EXPECTED_DB_HOST` = the host of the production Neon DIRECT string without `-pooler` (for example `ep-xxx.eu-central-1.aws.neon.tech`): the build then refuses to deploy to Production if either connection string points at a different database, such as dev.
   - **Do the first deploy as a Preview** (open a pull request or push a branch): it proves install, `postinstall` (`prisma generate`) and `next build` on Vercel with no migration risk. Only then deploy `main` to Production.
   - Preview environment variables (the production checks do not run for previews, so only these are needed): `DATABASE_URL` and `DIRECT_URL` with the DEV Neon strings, `APP_URL` (the preview URL or `https://maw3edlb.com`), `NEXT_PUBLIC_APP_URL`, `LINK_SECRET`, `CRON_SECRET`, `EMAIL_PROVIDER=fake`. No Resend key is needed, so previews never send real mail or touch production data.
   - A production build that is missing or mis-setting any of these fails with the variable NAMES listed (values are never printed).
4. **Resend**: create an API key, add the sending domain (use a subdomain such as `mail.maw3edlb.com`), add the DNS records Resend shows in Vercel DNS, wait for Verified, optionally add a DMARC TXT record (`_dmarc`, `v=DMARC1; p=none`). `EMAIL_FROM` example: `Maw3ed <reminders@mail.maw3edlb.com>`.
5. **First deploy check**: `https://maw3edlb.com/api/health` returns `{"status":"ok","db":"up"}`; sign up a test business at `/signup`.
6. **cron-job.org** (after the first deploy; each job is a POST with header `x-cron-secret: <production CRON_SECRET>`): `/api/jobs/reminders` every 5 minutes, `/api/jobs/waitlist-expiry` every 5 minutes, `/api/jobs/cleanup` daily (once the launch-gates PR is merged). Turn on failure notifications.
7. **GitHub**: Actions variable `APP_URL=https://maw3edlb.com` and secret `CRON_SECRET` (enables the backup scheduler workflow); protect `main` (require a pull request and the CI check).
8. **Rollback and safety notes**: migrations run BEFORE the new code goes live, so keep them additive (expand/contract: add a column first, remove the old one in a later release). Prisma has no automatic rollback: if a migration fails halfway, later deploys refuse until it is resolved (`prisma migrate resolve --rolled-back <name>` against the production DIRECT string) or the Neon production branch is restored from a point in time. `vercel build --prod` run on a laptop with pulled production variables WOULD migrate production: do not run it locally. Build logs show the database host name (never the password) and are visible to the Vercel team.
8b. **Before deploying the deposit migrations (P3.9)**: against the production DIRECT string run `psql "$DIRECT_URL" -f scripts/db/check-overlaps.sql` (must return zero rows) and `SELECT count(*) FROM "Appointment" WHERE status = 'PENDING_PAYMENT';` (expected 0: nothing creates that status before this release). The two migrations are additive; after deploy run `scripts/db/check-constraints.sql` (it asserts `appointment_no_overlap` now covers BOOKED, CONFIRMED and PENDING_PAYMENT). No new cron job is needed: holds expire inside the existing `/api/jobs/waitlist-expiry`.
9. **Reserved slugs check** (one-off, before launch): `SELECT slug FROM "Business" WHERE slug IN ('directory','explore');` must return no rows. Reserved slugs are only enforced at signup, so existing rows are not re-validated.
10. **Phone test**: open `https://maw3edlb.com/b/<slug>` on a real phone, book, check the confirmation email, open the confirm and cancel links.

---

## Real-email waitlist check on production (F26, about 20 minutes, two inboxes)

The automated journey (`tests/e2e/waitlistJourney.spec.ts`) proves the flow with a stub for the email network call. Only a real send proves that Resend, your sending domain and the spam filters deliver the offer. Do this once on `https://maw3edlb.com` before the demo, and again after any change to the sending domain.

You need: two real inboxes you can read (call them **Inbox A** and **Inbox B**, for example two Gmail addresses; a third person's inbox is even better), a phone, and a test business you own (create one at `/signup`, slug for example `test-f26`, add one service, make yourself bookable, add weekly hours). Use a time at least two days away so every reminder window applies.

1. **Book.** On the phone open `https://maw3edlb.com/b/test-f26`, book the service for two days from now at 09:00 as "Client A" with **Inbox A** as the email. Expect the "You're booked" screen.
2. **Join the waitlist twice.** In two separate browser windows (the second one private or on another device) open `/b/test-f26/waitlist`, pick the same service, leave the dates as they are, and join as "Waiter B1" with **Inbox B** and as "Waiter B2" with Inbox B again but a different name and phone (or a third inbox). Expect "You're on the waitlist" both times.
3. **Wait for the confirmation email** in Inbox A. The booking confirmation is sent by the reminders job (cron-job.org, every 5 minutes), so allow up to 6 minutes. It must show the right business, the time in the business's time zone, a Confirm link and a Cancel link.
4. **Cancel from Inbox A.** Open the Cancel link, press "I can't come, cancel", confirm. Expect "Appointment cancelled".
5. **Offer emails.** Within about a minute both waiters receive "A spot opened up: <service> on <date> at 09:00" in Inbox B. Check: subject, business name, service, date and 09:00 in the business time zone, "held for you until HH:mm" (about 30 minutes from now), the green "Take this spot" button, and the grey "Remove me from the waitlist" link at the bottom. Check the spam folder too and note where it landed.
6. **Claim at the same time.** Open both claim links on two devices and press "Book this slot" on both within a second or two. Exactly one shows "You're booked"; the other shows "Someone else got this slot" and the line saying they stay on the waitlist.
7. **Owner view.** Log in as the owner. On Today the "Waitlist activity" card shows "<name> took 9:00 with <staff>". Move to the booking's day: the appointment is badged "Waitlist" and the "Refilled from waitlist" counter reads 1.
8. **Winner's email.** The winner gets a normal "Booking confirmed" email within 6 minutes (again the reminders job).
9. **Leave link.** In the loser's inbox open "Remove me from the waitlist", press the button, expect "You're off the waitlist". Press the link again: still fine.
10. **Expiry** (optional, 35 minutes): cancel the winner's booking from its Cancel link, do not claim the new offers, and wait for the cron job. After 30 minutes the offers show "This offer has expired" and, if a third waiter exists, they get the next offer.

Where to look when an email does not arrive:
- **Resend dashboard, Emails tab** (resend.com/emails): search the recipient address. Status `Delivered` means Resend handed it over (check spam, and Gmail's "Promotions"); `Bounced` or `Complained` shows the reason; `Suppressed` means that address was blocked earlier. No row at all means the app never called Resend: check the Vercel function logs for `waitlist offer email failed` or `offer not emailed: entry has no contact email`.
- **Idempotency**: an offer email key is `waitlist-offer-<offerId>`; Resend shows one row per key. Two rows for the same offer would be a bug: report it.
- **Domain**: Resend, Domains must be Verified (SPF and DKIM green). A new domain often lands in spam for the first sends.
- **Cron**: cron-job.org history for `/api/jobs/reminders` and `/api/jobs/waitlist-expiry` must show recent HTTP 200 runs (a 401 means the `x-cron-secret` header is wrong).
- Offers are only sent to entries that have an email, and never to the person who cancelled the slot.

Record the result (what landed in inbox or spam, how long each email took) in `docs/PLAN.md` next to F26.
