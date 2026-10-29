# Maw3ed — tasks only you can do

Claude can't create accounts or hold your credentials. Do these early (Phase 0), then put the values in Vercel env vars,
GitHub Actions secrets and your local `.env`. Never commit secrets.

| # | Task | Produces | Needed by |
|---|---|---|---|
| 1 | **Neon**: create a project (region close to Beirut, e.g. `aws-eu-central-1`); create `main` (prod) and `dev` branches. `btree_gist` is enabled by the migration. | `DATABASE_URL` (pooled), `DIRECT_URL` | P1.1 (dev), P2.17 (prod) |
| 2 | **Vercel**: import the GitHub repo; set env vars (below) for Production and Preview; create a token. | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (GitHub secrets) | P0.5 |
| 3 | **Resend**: create an account, add and **verify a sending domain** (SPF + DKIM DNS records; DMARC recommended). Without a verified domain Resend only delivers to your own address. | `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Maw3ed <reminders@yourdomain>`) | P2.4 |
| 4 | **cron-job.org**: two jobs every 5 min, `POST https://<prod>/api/jobs/reminders` and `/api/jobs/waitlist-expiry`, header `x-cron-secret: <CRON_SECRET>`. Turn on failure notifications. | `CRON_SECRET` (also a GitHub secret for the backup workflow) | P2.17 |
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

1. **Secrets** (new values, never the local `.env` ones; never paste them in chat or commit them): generate three with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` for `SESSION_SECRET`, `LINK_SECRET` and `CRON_SECRET`. All three must differ.
2. **Neon** (project `maw3ed`, branch `production`, Connect): pooling ON gives `DATABASE_URL` (host contains `-pooler`); pooling OFF gives `DIRECT_URL`.
3. **Vercel**: import the GitHub repo (Next.js is auto-detected; leave build/install commands, `vercel.json` is not needed because the `vercel-build` script is used), Node.js 22, attach `maw3edlb.com` as the production domain and redirect `www` to it.
   - Production environment variables: `DATABASE_URL`, `DIRECT_URL`, `APP_URL=https://maw3edlb.com`, `NEXT_PUBLIC_APP_URL=https://maw3edlb.com`, `SESSION_SECRET`, `LINK_SECRET`, `CRON_SECRET`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.
   - Preview environment variables: the same names with the DEV Neon strings and `EMAIL_PROVIDER=fake`, so previews never touch production data or send real mail.
   - A production build that is missing or mis-setting any of these fails with the variable NAMES listed (values are never printed).
4. **Resend**: create an API key, add the sending domain (use a subdomain such as `mail.maw3edlb.com`), add the DNS records Resend shows in Vercel DNS, wait for Verified, optionally add a DMARC TXT record (`_dmarc`, `v=DMARC1; p=none`). `EMAIL_FROM` example: `Maw3ed <reminders@mail.maw3edlb.com>`.
5. **First deploy check**: `https://maw3edlb.com/api/health` returns `{"status":"ok","db":"up"}`; sign up a test business at `/signup`.
6. **cron-job.org** (after the first deploy; each job is a POST with header `x-cron-secret: <production CRON_SECRET>`): `/api/jobs/reminders` every 5 minutes, `/api/jobs/waitlist-expiry` every 5 minutes, `/api/jobs/cleanup` daily (once the launch-gates PR is merged). Turn on failure notifications.
7. **GitHub**: Actions variable `APP_URL=https://maw3edlb.com` and secret `CRON_SECRET` (enables the backup scheduler workflow); protect `main` (require a pull request and the CI check).
8. **Phone test**: open `https://maw3edlb.com/b/<slug>` on a real phone, book, check the confirmation email, open the confirm and cancel links.
