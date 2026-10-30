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
6. Invite the receptionist; show them **Reminders due** (it's their first screen) and **Mark outcome**.
7. Share the booking link: Instagram bio, WhatsApp status, Google Maps profile.
8. Enter the **baseline** on the Pilot page: from/to dates (up to 31 days, ending today or earlier), **appointments held or missed** (people who came plus no-shows; do NOT count cancellations or late cancels), no-shows, and late cancels (entered separately). Baseline rate = no-shows / appointments, the same measure as the pilot rate.

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

With a few dozen appointments, one no-show moves the rate by several points. Always show the raw counts next to the rate,
and claim a **direction**, not statistical significance.
