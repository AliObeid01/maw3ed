# Maw3ed — pilot playbook

Goal: 3–5 businesses live by **Tue 3 Nov**, each compared only with its own book for the 14 days before go-live.

## Recruit (start 29 Oct)
- At least **one salon or barber** (walk-in heavy) and **one clinic** (appointment heavy: dental, beauty, physio).
- The owner agrees to put **every** appointment into Maw3ed during the pilot, including phone bookings and walk-ins.
- The owner can count appointments and no-shows from their paper book or calendar for the previous 14 days.
- Clinics: appointments only. No treatment notes or health information, ever.

## Good to know before the visit
- **Plan.** Every new business starts on the **Free** plan: one bookable staff member (the owner counts if bookable). Adding or turning on a second bookable practitioner needs **Pro**. Upgrading is a free test-mode button: Settings, "Your plan", See Pro, then confirm the test upgrade. No card is taken. The receptionist is not bookable and does not count.
- **Deposits are OFF by default.** To turn them on: Settings, "Deposits for repeat no-shows", switch on "Ask for a deposit", set how many missed appointments trigger it (default 1) and the amount, then Save. A client with at least that many no-shows at this business, booking from the public page, sees "Deposit needed", a 15 minute countdown that holds their time, and a pay button. It is test mode, so no real money moves; paying confirms the booking. Front-desk bookings never ask for a deposit. Nothing is refunded or credited yet, so keep deposits off unless the owner wants to try the flow.
- **Directory listing is optional.** By default only people with the booking link can book. The owner can list the business in the public directory from the Booking link page (or the "List in the directory" step of the Setup checklist). It needs at least one service and one bookable staff member with hours. It can be switched off again at any time.
- **Language.** The language toggle (English or Arabic) is on the public pages and in the dashboard menu. Visitors' choice is remembered; Arabic is a draft pending native review, so tell Arabic-speaking owners to report odd wording.
- **Email cap.** Resend's free plan allows about 100 emails a day. The job log warns at 80 sent in a day and, from 95, booking confirmations are skipped so reminders still go out. The count covers booking confirmations, reminders and waitlist offers for all businesses together (not invites), per UTC day. With several busy pilots, watch it daily.
- **A returning client's new email applies to the new booking.** The confirmation and reminders of each appointment go to the address typed for THAT booking, so a client who changes address simply types the new one when booking (their old appointments keep the old address). The saved client profile (name and email) is set only by staff at the front desk or by the client's very first booking; a later public booking never fills or changes it, so nobody can redirect another client's history or learn their name by knowing their phone number. A booker can still type someone else's email and any name, so that person's inbox reads "Hi <typed name>" (spoofing only, nothing is disclosed); tell owners that unexpected reminders can be ignored. A booking made without an email uses the profile email. At the front desk, typing a different email also corrects the profile email, as before. A staff correction of the client's profile email does NOT change appointments that already have their own address: to correct an upcoming appointment, cancel it and book again (there is no edit). Emails to an address other than the profile email greet with the name typed for that booking. Deleting a client on request also erases the email and name stored on their appointments and the email on their waitlist requests.

## Onboard in one 20-minute visit (on the owner's phone)

Checklist, in the order the screens appear (Setup page):
- [ ] Sign up (business name, link, timezone), 2 min
- [ ] Services: name, duration, buffer, price, 3 min
- [ ] Staff: bookable practitioners and their services; receptionist as not bookable, 3 min
- [ ] Hours and time off, 3 min
- [ ] Settings: slot step, booking window, minimum notice, cancel cutoff (defaults are fine), 1 min
- [ ] Booking link page: copy the link, show the QR, share to WhatsApp or Instagram; decide on the directory, 2 min
- [ ] New booking: enter next week's existing appointments, 4 min
- [ ] Pilot report: baseline, 2 min
- [ ] Invite the receptionist and show Reminders and Mark outcome

Details for each step:

1. Sign up: business name, slug (short, e.g. `studio-nour`), timezone (Asia/Beirut).
2. Services: name, duration, buffer, price. Keep it to the top 5–8 services.
3. Staff: add each practitioner as bookable; tick their services. Add the receptionist (not bookable).
4. Hours: weekly intervals per staff member (split shifts allowed) + any known time off.
5. Enter **next week's existing appointments** from the book through front-desk booking.
6. **The owner must confirm their email first** (the link in the message sent at signup; the dashboard shows a banner with **Resend email**, 3 per hour) before they can invite staff or list the business in the directory. Everything else works before that. If someone forgets their password: **Forgot password?** on the sign-in page emails a one-hour link (signing out every device). Then invite the receptionist; show them **Reminders due** (it's their first screen) and **Mark outcome**. **When someone leaves:** Staff > **Team access** > **Remove access** on their row (confirm). They are signed out at once and cannot open the dashboard again; their calendar entry and appointments stay, but they are hidden from your booking page at once (a note tells you how many upcoming appointments remain on their calendar; move or cancel those, or make them bookable again in the staff list). You cannot remove yourself or the last owner. A wrong or no-longer-needed invitation: the same section lists **Pending invites**; **Revoke** makes its link stop working immediately. To bring someone back, just invite them again. **If a phone or laptop is lost:** Settings > Account > **Sign out other devices**.
7. Share the booking link: Instagram bio, WhatsApp status, Google Maps profile.
8. Enter the **baseline** on the Pilot page: from/to dates (up to 31 days, ending today or earlier), **appointments held or missed** (people who came plus no-shows; do NOT count cancellations or late cancels), no-shows, and late cancels (entered separately). Baseline rate = no-shows / appointments, the same measure as the pilot rate. Apply the same excuse standard to the baseline no-shows you enter by hand as you use in the app, because an excused no-show leaves the weekly rate.

**No-show definition (both periods):** the client neither came nor cancelled before the cutoff. Late cancels are counted separately, and cancellations are excluded from the denominator. **Rate (both periods) = no-shows / (attended + no-shows).**

## During the pilot (daily)
- Staff mark every appointment's outcome **the same day**; the Mark-outcome badge nags until they do.
- Check the job log: failed or skipped reminders, the daily email count (alert at 80 of 100), and that cron ran every 5 minutes.
- Check that WhatsApp-due reminders are being sent (sent-by names in the list).
- Collect one quote from each owner or receptionist for the demo.

## Report per business (Pilot page / CSV)
| Field | Shown |
|---|---|
| Baseline | appointments (held or missed), no-shows, late cancels, rate |
| Pilot | attended, no-shows, late cancels, rate, days covered |
| Change | absolute points and relative % |
| Supporting | confirm rate, cancellations via link, waitlist refills (freed slots rebooked from the waitlist / freed slots offered) |

A no-show can be recorded from 10 minutes after the start (a late client is not lost), and staff can **Excuse** a no-show or late cancel from the appointment page when the client had a good reason. An excused no-show becomes a normal cancellation and **leaves the no-show count of the week it happened in**, so a past week's rate can change after the fact. Re-export the CSV after an excuse.

With a few dozen appointments, one no-show moves the rate by several points. Always show the raw counts next to the rate,
and claim a **direction**, not statistical significance.
