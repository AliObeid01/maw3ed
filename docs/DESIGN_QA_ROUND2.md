# Design QA round 2 (origin/main f87bbb5)

Method: production build on local Postgres maw3ed_qa2 (dropped afterwards), Playwright at 360/768/1440 in en and ar,
axe-core (wcag2a/aa/21a/21aa + best-practice) at 360 in both locales, Lighthouse mobile accessibility.
Screenshots: C:\Users\user\AppData\Local\Temp\q\shots\ (outside the repo).

## Summary
1. No horizontal scroll on any tested route at 360/768/1440, en or ar. RTL (dir=rtl, Arabic font) applies everywhere.
2. Lighthouse mobile accessibility: / = 100, /pricing = 100 (the /directory run did not finish, not reported).
3. axe recurring items: label-content-name-mismatch on the header logo link (all public pages, serious); region (fixed FAB outside landmarks) on /app routes; aria-allowed-role on /app/services.
4. Pay page (5.2) works (15:00 countdown, TEST MODE banner, expired state "This hold has expired", Arabic OK) but is visually far from the board.
5. Pricing (5.1) lacks the gradient hero, "Most popular" badge and the fuller Pro feature list.
6. Today (4.1) mobile: "Do this first" card, reminder badge and the "sent by" state render; desktop calendar blocks are below 44 px.
7. Switches are 52x32 px (under 44 px height) on settings, share, services, staff.
8. Home copy has no invented numbers or customers; CTAs render and link.
9. Not verified: board 3.8/3.9 detail side by side, loading skeletons, 409 states, Today desktop with a due reminder (day rolled over at midnight Beirut), populated /directory.
10. The FREE plan callout exists only on the Staff form (red error style); Services has none.

| Severity | Route | Viewport / locale | Problem | Suggested fix | Status |
|---|---|---|---|---|---|
| should-fix | /pay/[token] | all, en+ar | Differs from board 5.2: no business header (SN avatar, address), no gradient hero card with "Slot held for mm:ss" chip, no Service/When/Total rows, no "comes off your bill" copy; countdown is a plain tile; marketing nav shown. | rebuild pay page to board 5.2 two-column layout | **Fixed**: business header (monogram, name), teal hero with "Slot held for mm:ss" chip, Service / When / Deposit now rows, TEST MODE callout kept. Address and a service Total are not in the pay contract, so they are not shown (Deferred). |
| should-fix | /pay/[token] | all | Primary CTA is dark green; board uses the amber pill. | accent button variant | **Fixed**: amber `accent` pill button (58 px from `md`). |
| should-fix | /pay/[token] | 360 ar | Date and time range (2 نوفمبر · 10:00 – 10:30) rely on bidi; wrap times and prices in bdi dir=ltr so order is stable. | pay summary component | **Fixed**: when and service lines use `MetaLine` / `TimeRange`; the amount is `dir="ltr"`. |
| polish | /pay/[token] | 360 | Footer copy wraps leaving an orphan word. | shorten copy | **Fixed**: footer note rewritten as one short sentence. |
| should-fix | /pricing | all | Board 5.1 hero gradient band and test-mode top banner missing; cards on plain background. | pricing page layout | **Fixed**: gradient hero (`bg-hero`) with the cards overlapping it. TEST MODE stays on the Pro price chip and the test note; there is no separate top banner. |
| should-fix | /pricing | all | No "Most popular" badge; Pro list omits Unlimited staff, Deposits from repeat no-showers, CSV export (deposits are shipped). | messages pricing.pro.features (en, ar) | **Fixed / by design**: "Recommended" badge on Pro. The Pro list stays "Everything in Free" + "More than one bookable staff member": unlimited staff, CSV export and deposits are not plan-gated, so they are not claimed. |
| polish | /pricing | 360 ar | TEST MODE chip appears twice on one screen (header and Pro price). | drop duplicate | **Fixed**: the hero chip was dropped; one TEST MODE chip remains (on the Pro price). |
| polish | / | 1440 en+ar | Hero card is about half empty (no preview or illustration). | add product preview or narrow hero | **Deferred**: product preview on the home hero is new design work. |
| should-fix | / and all public headers | 360 | Hero "Sign in" link is 41x44 px; logo link aria-label "Maw3ed home" does not contain visible text (axe serious). | min-w-11; drop aria-label or include text | **Fixed**: Sign in link is `min-w-11`; the logo link no longer has its own aria-label; its name comes from the logo image label ("Maw3ed home"), so axe label-in-name no longer applies (Lighthouse a11y on /pricing = 100, 0 failing audits). |
| polish | /directory | all | Empty state has no CTA to list a business; populated card not tested. | link to /app/share | **Deferred**: directory empty-state CTA is new content. |
| polish | /o/[token] (expired), /o/[token]/leave | 360 en+ar | Both render correctly and mirror in RTL; expired page has no way to rejoin the waitlist. | add secondary CTA | **Deferred**: rejoin-waitlist CTA on the expired offer needs a product decision. |
| should-fix | /app/settings, /app/share, /app/services, /app/staff | 360 to 1440 | Switch controls are 52x32 px (target under 44 px). | shared Switch: 44 px hit area | **Stale**: the switch button is already 44 px tall (round 1); the track stays 52x32. |
| should-fix | /app/settings | 360 ar | Deposit helper prints price as "5$." (symbol side wrong in RTL). | bdi dir=ltr or Intl currency | **Fixed**: the deposit hint wraps the price with the shared `ltr()` helper; the directory "From {price}" and the plan confirm price use it too. |
| should-fix | /app/settings | 360 en | Plan card is the last card below the fold; "Compare plans" is a bare link under 44 px tall. | reorder, pad link | **Stale**: board 3.8 also ends with "Your plan", so the order matches the board; "Compare plans" is already `min-h-11`. |
| polish | /app/settings | 360 | Deposit card is open on FREE although pricing frames deposits as Pro; no lock state. Confirm intent. | PRD decision | **Stale**: deposits are not plan-gated (intended), so the card stays open on FREE. |
| should-fix | /app/settings, /app/share, /app/setup, /app/services | 360 en+ar | Fixed FAB overlaps field units and chips; axe region: FAB outside any landmark. | bottom padding, FAB inside landmark | **Fixed**: the FAB stays visible and focusable; the page has 88 px of bottom padding so it never covers the last row or form actions. It is hidden by CSS only while a text-entry field has focus (on-screen keyboard) and returns on blur or when it receives keyboard focus. Region part fixed in round 1. |
| polish | /app/setup | 360 | "5 of 6 done" while 7 steps listed; optional publish step numbering unclear. | label optional, fix numbering | **Deferred**: setup step numbering is a copy/IA change outside this round. |
| should-fix | /app/staff | 360 en+ar | PLAN_LIMIT callout on FREE is a red error with a tiny inline "See plans" link. | StaffForm: amber upsell callout, 44 px link button | **Fixed**: PLAN_LIMIT shows a neutral gold "Your Free plan is full" card with a 44 px "See plans" button to /pricing. |
| should-fix | /app/services | 360 | No PLAN_LIMIT or upgrade handling; axe aria-allowed-role (ul role=rowgroup, row). | native list or table | **Stale**: Services has no plan limit (staff only); the aria-allowed-role issue was fixed in round 1. |
| should-fix | /app | 360 en | FAB sits on the staff filter chips ("Lina") and clips them. | end padding on chip row | **Fixed**: the staff filter chip row has end padding so the last chip scrolls clear of the FAB. |
| should-fix | /app | 1440 en+ar | Calendar blocks for short or late appointments are 20-25 px tall buttons. | min block height | **Deferred**: blocks are placed by time (44 px per 30 min); a 44 px minimum would overlap the next appointment in the same column. |
| polish | /app/reminders | 360 ar | "sent by" shown as a text row, not a disabled button; name/time pair order reads awkwardly. | disabled button per PRD | **Deferred**: disabled "sent by" button needs the reminders redesign. |
| polish | /app | 360 en+ar | Time formats mix "8:00" and "08:00"-style padding across screens. | one formatter | **Deferred**: one time formatter across screens is a separate cleanup. |
