# Maw3ed — design system

The full component recipes, tokens and responsive rules are in the `maw3ed-design-system` skill
(`.claude/skills/maw3ed-design-system/SKILL.md`). This page is the human-facing summary and the board → route map.

## Sources
- `maw3ed-design.html`: the original bundle (open it in a browser to see every board).
- `design/screens/*.html`: extracted static markup per board (`node scripts/design/extract-screens.mjs`). Exact inline styles.
- `design/boards/*.png`: reference screenshots (`node scripts/design/snapshot-boards.mjs`, needs Playwright).

## At a glance
- **Font** Outfit (Latin) + IBM Plex Sans Arabic (RTL). Body 15 px; inputs 16 px.
- **Palette (v2 blue, shipped 3 Nov 2026)** canvas `#F3F5FA` · surface `#FFFFFF` · ink / Deep Navy `#0B1938` · muted `#56668A` (darkened from `#5B6B8C` so it also passes on brand-soft) ·
  line `#D3DCEE` · divider / Soft Blue Gray `#E9EFF8` · brand / Royal Blue `#254EDB` (hover `#1D3FB8`) · Electric `#2864F5` (selected day, focus ring, accent button) ·
  Cyan `#43C4F0` (info chips, initials tiles, logo check; navy text only) · Turquoise `#21CDB3` (the one highlight tile "Refilled from waitlist"; navy text only) · Mint `#20D2AC` (service icons) ·
  success `#17795A` · warning `#9A5800` · danger `#C21F3A` · gold `#E8B86D` only as the thin underline under the wordmark in the Logo and emails.
  Cyan and Turquoise are never a text colour on white and never carry white text. The old `--color-accent` alias is gone: use `bg-cyan` (`--color-cyan`), never `accent`. `--color-subtle` (#657799) is 4.5:1 on white and only for placeholders, disabled text and struck-out taken slots on white.
- **Shape** rounded-rectangle buttons (12 px, `rounded-btn`), chips 8 px (`rounded-chip`), inputs 12 px (52 px tall), cards 14 to 16 px, hairline borders, neutral shadows only. `rounded-pill` is kept for the Switch, avatars, dots and count badges.
- **Signature** a FLAT Deep Navy hero band (`bg-hero`) with a 4 px Royal Blue bottom edge. No gradients, radial glows, blurred blobs, gradient text, coloured glow shadows or frosted glass anywhere.

> **Palette change (3 Nov 2026).** The shipped palette is the v2 blue above. `maw3ed-design.html` and the boards in `design/screens` and `design/boards`
> still show the ORIGINAL teal and gold design: use them as **layout references only** (hierarchy, spacing, copy), never for colour or corner radius.
> The tokens live in `src/app/globals.css`; `tests/unit/ui/palette.test.ts` pins them and `node scripts/design/contrast.mjs` checks every text pair (AA).
> F66 also moved the Plan box next to Deposits on Settings (lg+), put the Account page cards side by side (lg+) and made the Sign up card 640 px with a two-column form from md.

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
