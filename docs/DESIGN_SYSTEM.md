# Maw3ed — design system

The full component recipes, tokens and responsive rules are in the `maw3ed-design-system` skill
(`.claude/skills/maw3ed-design-system/SKILL.md`). This page is the human-facing summary and the board → route map.

## Sources
- `maw3ed-design.html`: the original bundle (open it in a browser to see every board).
- `design/screens/*.html`: extracted static markup per board (`node scripts/design/extract-screens.mjs`). Exact inline styles.
- `design/boards/*.png`: reference screenshots (`node scripts/design/snapshot-boards.mjs`, needs Playwright).

## At a glance
- **Font** Outfit (Latin) + IBM Plex Sans Arabic (RTL). Body 15 px; inputs 16 px.
- **Palette** canvas `#F7F5F0` · surface `#FFFFFF` · ink `#252D2D` · muted `#626967` (board `#737C79` darkened for AA, see `scripts/design/contrast.mjs`) · line `#E3DED2` ·
  brand teal `#174C4F` · accent gold `#E8B86D` · success `#2D6A4F` · warning `#9A5800` · danger `#C21F3A`.
- **Shape** pill buttons (44–50 px), 14 px inputs (52 px tall), 18–24 px cards, hairline borders, almost no shadow.
- **Signature** the teal hero band with gold and teal radial glows; gold monogram; gold "send" actions.

## Responsive strategy
The boards are 1440 px desktop. We build **360 px first**:
- Public booking: single column, compact progress + back, sticky bottom summary/CTA; the 3-column layout comes back at `lg`.
- Dashboard: bottom tab bar (Today · Reminders · Outcomes · Clients · More) + More sheet + floating New booking below `lg`;
  the 256 px sidebar at `lg+`. Today's calendar grid becomes an agenda list with staff filter chips on phones.
- Tables become stacked cards on phones. Side cards move above the main content ("Do this first" is the first thing staff see).

## Board → route map
| # | Board | Route | Component root |
|---|---|---|---|
| 01 | Shared public header | — | `components/public/PublicHeader.tsx` |
| 02–05 | 1.1 Choose service · 1.2 Choose staff · 1.3 Day & time · 1.4 Your details | `/b/[slug]?step=service|staff|time|details` | `app/(public)/b/[slug]/BookingFlow.tsx` |
| 06 | 1.5 Booked | `/b/[slug]/booked/[token]` | `…/booked/[token]/page.tsx` |
| 07 | 1.6 Slot just taken | state of step `time`/`details` after 409 | `BookingFlow` |
| 08 | 1.7 Join waitlist | `/b/[slug]/waitlist` | `…/waitlist/page.tsx` |
| 09–10 | 2.1 Confirm or cancel · 2.2 Cancelled | `/l/[token]` | `app/(public)/l/[token]/page.tsx` |
| 11 | 2.3 Waitlist offer | `/o/[token]` | `app/(public)/o/[token]/page.tsx` |
| 12–14 | 3.1 Sign up · 3.2 Sign in · 3.3 Accept invite | `/signup` · `/login` · `/invite/[token]` | `app/(auth)/…` |
| 15 | 3.4 Setup checklist | `/app/setup` | |
| 16 | 3.5 Services | `/app/services` | |
| 17 | 3.6 Staff | `/app/staff` | |
| 18 | 3.7 Hours & time off | `/app/hours` | |
| 19 | 3.8 Business settings | `/app/settings` | |
| 20 | 3.9 Share booking link | `/app/share` | |
| 21 | Shared sidebar | — | `components/app/AppShell.tsx` |
| 22 | 4.1 Today | `/app` | |
| 23 | 4.2 Reminders due | `/app/reminders` | |
| 24 | 4.3 Front-desk booking | `/app/book` | |
| 25 | 4.4 Mark outcome | `/app/outcomes` | |
| 26 | 4.5 Appointment | `/app/appointments/[id]` | |
| 27 | 4.6 Clients | `/app/clients` | |
| 28 | 4.7 Client history | `/app/clients/[id]` | |
| 29 | 4.8 Pilot report | `/app/pilot` | |
| 30 | 5.1 Pricing | `/pricing` | |
| 31 | 5.2 Deposit | `/pay/[token]` | |

Screens not in the boards (design them in the same language): 404 / expired-link page, empty states, the mobile More sheet,
the mobile booking summary sheet, toasts, the language toggle.
