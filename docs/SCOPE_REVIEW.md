# Maw3ed Scope Review

Scope: leen-aliobeid-alimostafa-team

## 1. Team

Members and what each one owns. We divide the project into complete full-stack flows. Each member builds the screens, APIs, business logic, database operations and tests for their area.

- **Ali Mustafa**: Business onboarding and setup. Owner registration and sign-in, business profile, services, staff and which services each performs, working hours and time off, business settings, and the business's unique booking URL.
- **Leen Farhat**: Business discovery and guest booking. The public directory of published businesses, the public booking page at /b/{slug}, service and staff selection (including "anyone"), availability, guest contact details, booking submission, and prevention of double and duplicate bookings.
- **Ali Obeid**: Appointment follow-up. Owner and staff dashboards, booking confirmation emails, 24 hour and 2 hour reminders, the one-tap WhatsApp list, confirm and cancel links, the waitlist, and CI and deployment.

Each member documents and tests their own features. Leen coordinates visual consistency, Ali Obeid assembles the demo recording, and Ali Mustafa prepares the business-problem introduction. All three review the final pitch.

## 2. Product in one sentence

Maw3ed helps appointment-based small businesses, such as barbers, hair salons and spas, take bookings online and follow up automatically, so they lose fewer appointments to no-shows and late cancellations.

## 3. The users

- **Business owners**: set up the business, services, staff and hours, publish the booking page, and oversee appointments.
- **Staff**: see the business calendar, book phone and walk-in clients, send due WhatsApp reminders, and mark each finished appointment as attended, no-show or late cancel.
- **Clients**: book without an account, and confirm or cancel through signed links in their reminders.

Initial focus: small salons, barbers and spas in Lebanon that coordinate appointments manually.

Real businesses we have talked to: We spoke with one business. Its main challenges differed from what Maw3ed addresses, so it was not a suitable pilot. We are looking for businesses, ideally 3 to 5 including at least one salon or barber and one clinic, whose booking, cancellation and no-show problems match the product.

## 4. The problem today

How they do it now: Appointments arrive by WhatsApp, phone and social media and are written on paper or in a calendar. Reminders depend on the owner or receptionist remembering to send them, so they go out late, unevenly or not at all. When someone cancels, the business must contact other clients by hand to fill the slot.

What it costs them: Every no-show or unfilled cancellation is paid time that stays empty. As an illustration only, six unfilled appointments at $20 each is $120 of potential weekly booking value. This is an assumption to validate with businesses, not measured loss or guaranteed recoverable income. Manual coordination also costs staff time and causes scheduling errors, which is a secondary cost.

How Maw3ed helps: Every booking gets automatic email reminders 24 hours and 2 hours before, each with confirm and cancel links, plus a one-tap WhatsApp message for the receptionist. When a client cancels in advance, the slot is offered to matching clients on a waitlist. A no-show discovered at appointment time is usually too late to replace, which is why early reminders and early cancellation matter most.

## 5. The one core flow

1. The owner signs up, adds services, staff and working hours, and publishes the business.
2. A client finds the business in the public directory (or opens its shared booking link) and opens the booking page on a phone, picks a service, a person or "anyone", and a time, enters name, phone and email, and is booked. A confirmation email with a calendar file arrives.
3. Reminders go out 24 hours and 2 hours before by email, and the receptionist sends the WhatsApp version with one tap. Every reminder has confirm and cancel links.
4. The client cancels from the link. The slot is freed and the remaining reminders are skipped.
5. Clients on the waitlist who match the service, person and dates receive an email offer.
6. The first client to claim gets the slot through the same booking path. Everyone else sees a clear "no longer available" message and stays on the waitlist.
7. The replacement booking appears on the dashboard as refilled from the waitlist, and after the appointment staff mark the outcome.

## 6. Where the AI fits

What the model does in this flow: N/A. Maw3ed does not integrate AI.

What goes in, what comes out: N/A.

How we check the output before the user sees it: Not applicable to a model. Application rules validate services, staff eligibility, working hours and availability on the server. A database constraint rejects overlapping appointments for the same staff member.

What happens when the model is wrong or slow: N/A. Application failures show clear messages and recovery options, for example fresh available times when a slot was just taken.

## 7. Tech stack and hosting

- Stack: Next.js (App Router) with TypeScript, Prisma on PostgreSQL, Zod validation on every route with an OpenAPI contract generated from the same schemas, Tailwind CSS, next-intl (English and Arabic with right-to-left layout), Resend for email, Vitest and Playwright for tests, GitHub Actions for CI.
- Scheduler: cron-job.org calls the reminder job every 5 minutes, with a GitHub Actions schedule as a harmless backup, because the job is safe to run twice.
- Where it will be deployed: Vercel for the app and Neon for PostgreSQL, deployed from the main branch after CI passes, with a preview deployment for every pull request.

## 8. Must work on stage (max five)

1. Owner setup and publish: sign up, add a service, staff and hours, and get a working booking link.
2. Discovery and guest booking on a phone: find a published business in the directory, then book in four screens or fewer, including a clear message and fresh times when the slot was just taken.
3. Automatic reminders with confirm and cancel links, and no duplicate reminders.
4. Cancellation from the link frees the slot and triggers a waitlist offer by email.
5. One waitlisted client claims the slot and appears as a replacement booking on the dashboard, while a second claimant is told it is unavailable.

## 9. Cut list (not building before Demo Day)

- Deposits and Whish Money payment processing.
- Pricing page with a test checkout.
- Directory search, filters, ratings and maps (the directory is a simple list of published businesses).
- "My bookings" and same-device booking-access recovery.
- Advanced client history, attendance-correction workflows and detailed pilot analytics beyond a basic report.
- CSV export.
- Push notifications and PWA installation.
- Automated WhatsApp sending (version one uses a prefilled one-tap link).
- Additional interface languages and Arabic polish beyond the booking page and messages.

## 10. The outcome number

The number of cancelled appointments successfully refilled through the waitlist.

In the controlled demonstration we will show one cancelled appointment replaced by one new booking. This shows the recovery flow. It is not evidence of real revenue or a proven recovery rate.

In a business pilot we will count actual replacement bookings linked to cancellation openings. As a supporting signal we will compare each pilot business's no-show rate with its own two weeks before the pilot, showing raw counts next to the rate and claiming a direction, not statistical significance.

## 11. Biggest risk

What could stop the demo from working: A cancelled slot might not trigger a waitlist notification, several notified clients might claim it at once, or email delivery might be delayed or blocked. Email also needs a verified sending domain before it reaches real inboxes.

Our plan if it happens:

- Test the full cancel, notify, claim and rebook flow repeatedly.
- Match offers by service, staff and date range, in order of signup.
- Recheck availability when the claim arrives and accept it through the same booking insert, so the database allows only one booking per slot and the others get a clear unavailable message.
- Send offers through the same reminder machinery, with a stable idempotency key per offer so a retry cannot send twice.
- Verify the sending domain early and prepare sample clients and inboxes before rehearsals.
- Record the full working flow as the stage backup.

## 12. Checkpoint plan

### Checkpoint 1, Tuesday 3 November: core booking working and deployed

What will work by then:

- Owner registration, business setup, services, staff, working hours and the unique booking URL.
- Public directory listing published businesses, linking to each business's booking page.
- Guest booking on a phone with conflict protection and idempotent submission.
- Saved appointments on the owner and staff dashboards.
- Confirm and cancel links, staff cancellation, and the automated reminder job.
- Waitlist signup stored in PostgreSQL.
- Public Vercel deployment with CI running on every pull request.

Who owns each part:

- Ali Mustafa: owner access, business setup, services, staff, hours and the booking URL.
- Leen Farhat: directory, booking page, availability, booking transaction and conflict checks.
- Ali Obeid: dashboards, reminders, links, waitlist storage, CI and deployment.

What is still mocked or incomplete:

- Sample businesses and clients are clearly labelled seed data.
- Waitlist offer emails and the offer page may still be in progress.
- Emails use the recording fake provider until the sending domain is verified.
- Booking, cancellation and waitlist storage use the real database.

We will agree with Sami whether the complete recovery flow must also be delivered by 3 November to satisfy the checkpoint gate.

### Checkpoint 2, Tuesday 10 November: feature complete

What we will add after Checkpoint 1:

- Real emails through a verified sending domain, with the 5-minute reminder job live.
- Cancellation-triggered waitlist matching and offer emails, the offer page, and the claim going through the shared booking path.
- Safe handling of expired offers, duplicate notifications and competing claims.
- Outcome marking, the client no-show badge and a basic pilot report.
- Mobile polish, completed permission and tenant-isolation tests, and updated documentation.

Who owns each part:

- Ali Mustafa: setup edge cases, account permissions, invites and business-data contracts.
- Leen Farhat: replacement-booking integration, availability rechecks, concurrent-claim protection and mobile booking.
- Ali Obeid: waitlist matching, notification delivery, offer page, dashboards and deployment verification.

The three-minute demo script draft is due Monday 9 November, followed by a full rehearsal on Tuesday 10 November. Feature freeze begins at the end of 10 November.

### Submission, Friday 13 November: polished and recorded

What we will fix and polish:

- Rehearse the complete book, remind, cancel, offer and replace flow.
- Fix mobile layout, validation, unavailable-slot messages and expired-link handling.
- Verify permissions, notification retries and duplicate-booking protection.
- Check production data, CI, documentation and the public URL.

Owners:

- Ali Mustafa: setup and authentication fixes and documentation review.
- Leen Farhat: guest and replacement-booking polish, concurrency verification and outcome evidence.
- Ali Obeid: waitlist and follow-up fixes, release checks and video assembly.

Backup recording: Ali Obeid records the three-minute demo and the 60-second stage backup on Thursday 12 November. Leen and Ali Mustafa review both that day. Friday 13 November is reserved for final checks, any rerecording and submission.
