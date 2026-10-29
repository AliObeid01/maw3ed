# Maw3ed — pilot playbook

Goal: 3–5 businesses live by **Tue 3 Nov**, each compared only with its own book for the 14 days before go-live.

## Recruit (start 29 Oct)
- At least **one salon or barber** (walk-in heavy) and **one clinic** (appointment heavy: dental, beauty, physio).
- The owner agrees to put **every** appointment into Maw3ed during the pilot, including phone bookings and walk-ins.
- The owner can count appointments and no-shows from their paper book or calendar for the previous 14 days.
- Clinics: appointments only. No treatment notes or health information, ever.

## Onboard in one 20-minute visit (on the owner's phone)
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
