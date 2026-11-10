# Demo data: owner's run guide

> **Demo data: all businesses, people and results are simulated for demonstration.**
> Use exactly this sentence in the README, on the landing page and in the video. Never present the numbers as real pilot results.

This guide is for the owner. It loads a believable, clearly simulated marketplace into a database so evaluators and
videos have something to look at, and it removes every row again with one command. Nothing here ever sends an
email: the demo clients have no email address at all.

## What it makes

| What | How many |
| --- | --- |
| Businesses (all listed, complete profile) | 18: three in each of barbers, hair salons, dental clinics, beauty clinics, spa and massage, physiotherapy |
| Areas | Beirut, Sidon, Tripoli, Jounieh, Tyre, Zahle |
| Logos / initials | 10 businesses have a generated logo, 8 show initials |
| Plan | PRO for the 9 businesses with more than one bookable person, FREE for the rest |
| Staff (first names only), services, working hours | 29 staff, 89 services (3 to 6 each), weekly hours (Sunday closed, Saturday shorter, a lunch split for clinics) |
| Clients | about 430: 140 at the flagship, 9 to 25 at each other business. Lebanese-style first and last names, valid Lebanese mobile numbers, **no email** |
| Appointments | about 1250: about 470 at the flagship (six weeks back plus the next week), 30 to 65 at each other business |
| Users | 19: the demo owner, a receptionist "Rana" (flagship), and 17 placeholder owners |
| Reminder jobs | about 1900: WhatsApp history and due items, and only SKIPPED email history (see Safety) |
| Waitlist | about 6 open entries at the flagship plus a history of offers and refills |
| Pilot baseline | the flagship only |

### The flagship: Cedar Smile Dental Clinic (Hamra Street, Beirut)

* PRO, four bookable people: three dentists (Rami, Lina, Karim) and a hygienist (Maya), part-time hours so the
  chairs look busy (about 65 to 70 percent of the working time is booked on weekdays).
* Six services: check-up and cleaning 35, filling 60, root canal treatment 140, teeth whitening 150, braces
  consultation 25, emergency visit 30 (USD).
* Deposit rule on: after 2 missed appointments, a 10 USD deposit.
* Created about six weeks ago, with a **baseline** of 20 no-shows in 112 appointments (17.9 percent, the two weeks before
  reminders) and a pilot that trends down week by week to about 8 to 10 percent (about 9 to 10 percent over the whole
  report).
* A confirm rate of about 60 to 70 percent, link cancellations of about 8 to 12 percent of bookings, and about a third of
  freed slots refilled from the waitlist.
* About 6 appointments of yesterday and today are **not yet marked** (the "Mark outcome" queue and its badge), some of
  today's earlier visits are already marked attended, and 8 clients have two or three no-shows (the repeat no-show
  badge). One or two no-shows were excused.
* Upcoming bookings for today, tomorrow and the rest of the week, WhatsApp reminders due now (and some already marked
  sent by Rana), and a few time-off days.

The other 17 businesses are lighter but alive: about 20 to 45 appointments over the last four weeks (mostly past, with
outcomes), some upcoming bookings, free times today or tomorrow, and no baseline.

## Logins

* **Demo owner**: the email and password you choose (below). One login opens the **flagship only**. In Maw3ed a login
  belongs to the business it is a member of; a person who is in several businesses is signed into the most recently
  created membership (there is no business switcher yet), so this one login cannot open the other 17.
* **Placeholder owners** (`owner+<slug>@demo.invalid`, plus `rana+cedar-smile-dental-clinic@demo.invalid`): their
  password is an unusable random hash that nobody keeps, and `.invalid` is a reserved domain that never resolves, so no
  mail can reach anyone and nobody can log in as them.

## Safety rules

> **Warning: the demo businesses are PUBLIC and BOOKABLE** (on the website and also through the Claude connector). If anyone
> books one with a **real email address**, Maw3ed sends that person real confirmation and reminder emails. Tell testers and
> evaluators to use throwaway addresses, or make phone-only front-desk bookings. The demo clients themselves have no email.

* **Never press "send" in WhatsApp for a demo number.** The numbers are valid in format but only plausible: they are
  not guaranteed to be unassigned. The Reminders screen opens WhatsApp with a ready message; do not send it.
* **No email is ever sent.** Clients have no email, so the reminder runner skips every email job
  (`no_email`). The seeder creates no email job that could ever be PENDING, and `demo:check` proves it.
* The real owner email and password live only in your terminal session. They are never written to a file, a log or the
  repository (tests use `demo-owner@demo.invalid`).
* The seeder refuses to write unless `--confirm-host` equals the database host, refuses a pooled (`-pooler`) host,
  honours `EXPECTED_DB_HOST` if you set it, and refuses if any demo business or demo login already exists.
* `demo:remove` deletes only the 18 demo businesses (by slug), their rows, the placeholder owners and the demo owner
  (and only if that user belongs to no other business). Nothing else is selected.

## Before you start

1. Node 22 and the repository checked out. In the repository folder:
   ```
   pnpm install --frozen-lockfile
   pnpm prisma generate
   ```
   (`pnpm install` already runs `prisma generate`; the second command only matters if you skipped scripts.)
2. **Make a Neon backup branch** of the production database first (Neon console: Branches, Create branch from
   the current point in time). If anything surprises you, you can go back to it.
3. **Clear the production database** with the two tested SQL files in `scripts/db/` (see
   [scripts/db/README.md](../scripts/db/README.md); the exact commands are in "Clear the database" below). Do this only if
   you really want an empty production database: the seeder needs the demo slugs and emails to be free, and the demo is meant
   to be the only content. Clearing is irreversible once committed.
4. Find the **non-pooled** connection string: Neon console, your project, **Connect**, turn **Connection pooling off**, copy
   the string whose host does **not** contain `-pooler`. This is your `DIRECT_URL`. Never paste it into a chat or a file.

## Run it

Set the variables for **this terminal only**, so they vanish when you close it. Pick a password of at least 12
characters; the seeder refuses anything shorter.

PowerShell:

```powershell
$env:DIRECT_URL = 'postgresql://...non-pooled...'        # from Neon, host has no -pooler
$env:DEMO_OWNER_EMAIL = 'you@your-real-address.example'
$env:DEMO_OWNER_PASSWORD = 'choose-a-long-password'
$env:DEMO_OWNER_NAME = 'Your Name'                       # optional, default "Demo Owner"
```

Git Bash:

```bash
export DIRECT_URL='postgresql://...non-pooled...'
export DEMO_OWNER_EMAIL='you@your-real-address.example'
export DEMO_OWNER_PASSWORD='choose-a-long-password'
export DEMO_OWNER_NAME='Your Name'
```

Optional but recommended, a second line of defence: tell the tools which database is the right one. Use the host of your
production `DIRECT_URL` with `-pooler` removed (for example `ep-xxxx.eu-central-1.aws.neon.tech`). If the host ever
differs, the seeder refuses to write.

```powershell
$env:EXPECTED_DB_HOST = 'ep-xxxx.eu-central-1.aws.neon.tech'
```

```bash
export EXPECTED_DB_HOST='ep-xxxx.eu-central-1.aws.neon.tech'
```

### Clear the database (only if you want an empty production database)

You need Docker Desktop running (this uses a throwaway `postgres:16` container as the `psql` program; if you have `psql`
installed you can use `psql "$DIRECT_URL" -f <file>` instead). Do the Neon backup branch first. `DIRECT_URL` must already be
set (above). Run these from the repository folder.

1. **Preview** (read-only, changes nothing; prints the row count of every table):

   PowerShell:
   ```powershell
   Get-Content scripts/db/preview-counts.sql -Raw | docker run --rm -i postgres:16 psql $env:DIRECT_URL
   ```
   Git Bash:
   ```bash
   docker run --rm -i postgres:16 psql "$DIRECT_URL" < scripts/db/preview-counts.sql
   ```
2. **Dry-run clear** (really deletes inside a transaction, prints the counts after, then rolls everything back; the file ends
   with `ROLLBACK;`):

   PowerShell:
   ```powershell
   Get-Content scripts/db/clear-all-data.sql -Raw | docker run --rm -i postgres:16 psql $env:DIRECT_URL
   ```
   Git Bash:
   ```bash
   docker run --rm -i postgres:16 psql "$DIRECT_URL" < scripts/db/clear-all-data.sql
   ```
   Check that the "after" counts are all 0 and the protected objects (overlap constraint, btree_gist, migrations) still show 1 or more.
3. **Real clear** (irreversible). The last line of the file is `ROLLBACK;`; these commands switch it to `COMMIT;` on the fly, so
   you do not have to edit the file (you may also edit the last line by hand and run step 2 again):

   PowerShell:
   ```powershell
   (Get-Content scripts/db/clear-all-data.sql -Raw) -replace 'ROLLBACK;\s*$', 'COMMIT;' | docker run --rm -i postgres:16 psql $env:DIRECT_URL
   ```
   Git Bash:
   ```bash
   sed 's/^ROLLBACK;$/COMMIT;/' scripts/db/clear-all-data.sql | docker run --rm -i postgres:16 psql "$DIRECT_URL"
   ```
   Run the preview again: every count must now be 0.

### Seed, check

1. **Dry run** (writes nothing; shows the plan, the counts and any conflict):
   ```
   pnpm demo:seed
   ```
   It prints the database host. Copy that host.
2. **Apply** (the host you copied must be typed exactly):
   ```
   pnpm demo:seed --apply --confirm-host ep-xxxx.eu-central-1.aws.neon.tech
   ```
   It writes one business at a time, prints progress, then a summary table. If anything fails it stops and tells you to run
   `demo:remove`.
3. **Check**:
   ```
   pnpm demo:check
   ```
   Every line must say PASS. It also prints the flagship's pilot report figures (baseline, current rate, relative change,
   confirm rate, link cancellations, refill rate).
4. **Look**: open the marketplace home and `/directory` (18 places), open a business, then log in at `/login` with the
   demo owner email and password. You land in the flagship dashboard: Today, Reminders, Mark outcome, Clients, Waitlist,
   Pilot report (baseline against current, weekly chart), Setup.

The data is anchored to "now" when you run the seeder (appointments are around that moment). If you seed in the evening
the "today" screens show the day that is nearly over; seed in the morning for the best "today" view. You can pass
`--now 2026-11-12T08:00:00Z` for a fixed moment, and `--seed 7` for a different but equally repeatable data set.

WhatsApp "due" reminders only appear while the clinic has appointments in the next 24 hours (the clinic is closed on Sunday).

## Remove everything

```
pnpm demo:remove                                        # dry run: lists what would go
pnpm demo:remove --apply --confirm-host <the same host>
```

Set `DEMO_OWNER_EMAIL` as well if you want the demo owner user removed too (it is removed only if it belongs to no other
business). After a removal you can seed again.

## Troubleshooting

| You see | Meaning and fix |
| --- | --- |
| `Refused: Writing needs --confirm-host ...` | You ran `--apply` without `--confirm-host`. Add it with the host printed by the dry run. |
| `--confirm-host "x" does not match the database host "y"` | The value differs from the host of `DIRECT_URL` (check spelling, no `https://`, no port). |
| `points at a pooled host` | You used the pooled string. Use the non-pooled one (no `-pooler` in the host). |
| `does not match EXPECTED_DB_HOST` | `EXPECTED_DB_HOST` is set to another database. Unset it or fix `DIRECT_URL`. |
| `DEMO_OWNER_PASSWORD must be at least 12 characters` | Choose a longer password. |
| `REFUSED: the database already contains demo rows` | Some demo slug or login already exists. Run `pnpm demo:remove` (dry run, then `--apply`), then seed again. |
| A timeout or `Transaction already closed` | Neon was slow. Run `pnpm demo:remove --apply ...`, then seed again (each business has a 10 minute transaction limit). |
| `demo:check` says a free slot is missing | You are checking at a time when a business is closed for two days. Run it in working hours, or pass `--now`. |
| It stops half way | Run `pnpm demo:remove` (dry run, then `--apply`), fix the cause, seed again. |

## For developers

* Everything lives in `scripts/demo/`: `manifest.ts` (the 18 businesses), `names.ts` (clients), `schedule.ts` and `plan.ts` (a
  pure, seeded, clock-injected generator), `logos.ts`, `guards.ts`, `runner.ts` (database writes), `checks.ts`, and the
  three CLIs. It needs no migration and changes no service or domain behaviour.
* Logos are original geometric monograms (two block letters on a plain colour field, brand palette, no text rendering, no
  photos) rasterised with sharp and passed through the app's own `processLogo` (256x256 WebP, metadata stripped, sha256
  hash), then stored in `BusinessLogo` exactly as a logo upload does.
* The seeder runs as a script with its own Prisma client; it does not go through the services, so it sets `plan`,
  `createdAt`, outcomes and reminder rows directly. Rows are built to be what the real flows would have left (client
  counters equal the appointment history, reminder jobs come from the same `plannedJobs` function).
* Phone numbers are valid Lebanese mobile numbers (03, 70, 71, 76, 78, 79, 81) from one fixed fake block (`+961` prefix
  followed by `77xxxx`), plausible but not guaranteed unassigned.
* Business names are fictional and descriptive. A name could still coincide with a real business somewhere; the
  simulated label above covers that, and a name is easy to change in `manifest.ts` (then `demo:remove` still works for
  data seeded earlier only if you keep the old slug).
* Tests: `tests/unit/demo/*` (generators, guards, manifest, logos) and `tests/integration/demo.seed.test.ts` (seed, check,
  the real directory, slots, login and pilot report, remove scope, re-seed) on a scratch schema.
