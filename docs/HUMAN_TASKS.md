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
