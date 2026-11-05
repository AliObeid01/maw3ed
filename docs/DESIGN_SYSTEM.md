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
  success `#17795A` · warning `#9A5800` · danger `#C21F3A`. **There is no gold**: the old `#E8B86D` wordmark underline was removed with the new logo (F69-C); `palette.test.ts` fails if it reappears anywhere.
  Cyan and Turquoise are never a text colour on white and never carry white text. The old `--color-accent` alias is gone: use `bg-cyan` (`--color-cyan`), never `accent`. `--color-subtle` (#657799) is 4.5:1 on white and only for placeholders, disabled text and struck-out taken slots on white.
- **Shape** rounded-rectangle buttons (12 px, `rounded-btn`), chips 8 px (`rounded-chip`), inputs 12 px (52 px tall), cards 14 to 16 px, hairline borders, neutral shadows only. `rounded-pill` is kept for the Switch, avatars, dots and count badges.
- **Signature** a FLAT Deep Navy hero band (`bg-hero`) with a 4 px Royal Blue bottom edge. No gradients, radial glows, blurred blobs, gradient text, coloured glow shadows or frosted glass anywhere.

> **Palette change (3 Nov 2026).** The shipped palette is the v2 blue above. `maw3ed-design.html` and the boards in `design/screens` and `design/boards`
> still show the ORIGINAL teal and gold design: use them as **layout references only** (hierarchy, spacing, copy), never for colour or corner radius.
> The tokens live in `src/app/globals.css`; `tests/unit/ui/palette.test.ts` pins them and `node scripts/design/contrast.mjs` checks every text pair (AA).
> The boards also still show the OLD logo (a slanted calendar with a gold underline): they stay as the old reference; the logo is now the one in `design/logo` (see **Logo** below).
> F66 also moved the Plan box next to Deposits on Settings (lg+), put the Account page cards side by side (lg+) and made the Sign up card 640 px with a two-column form from md.

## Logo (F69-C, owner files in `design/logo`, option B)
A calendar icon with the M inside; the "3" of Maw3ed is two stacked arcs (navy over turquoise). Flat paths only: no text, gradients or filters. `design/logo` (with its README) is the source of truth.
- **In the UI**: `src/components/brand/Logo.tsx` renders inline SVG built from `1-platform`. Props `label` (accessible name; omitted = `aria-hidden`), `className`, `width`, `tone` (`brand` = the light version on white surfaces, `white` = the reverse version on the navy hero or header), `variant` (`full` | `wordmark`). Under `MIN_FULL_LOGO_WIDTH` (96 px) the full logo automatically becomes the written wordmark, because the calendar icon is unreadable there. Sizes in use: sign-in and sign-up 160, dashboard sidebar 130, public header 132 (112 below `md`), error page 120.
- **Email**: a Deep Navy `#0B1938` band with the reverse PNG (`/brand/maw3ed-email-logo-reverse-320w.png`, shown at 160 x 44, `alt="Maw3ed"`) as an absolute URL from `APP_URL`; the files live in `public/brand` (160w, 320w and 480w, reverse and light). The plain-text part and the `.ics` carry the plain name Maw3ed.
- **Icons**: `src/app/favicon.ico`, `src/app/icon.svg` (the no-band favicon: bigger letter, readable at 16 px), `src/app/apple-icon.png` (180), `src/app/manifest.ts` (192, 512 and a maskable 512 from `public/brand`). The WhatsApp profile picture (`5-whatsapp`) is uploaded by the owner by hand.
- Do not recolour, outline or redraw it; edit `design/logo` first, then copy the paths.

## Pickers (F69-D): Select, TimePicker, DatePicker
No native `<select>`, `type="date"` or `type="time"` anywhere (the browser versions look different on every phone and ignore the app's language and 24-hour clock). One look, three controls, one open/close primitive.
- **Closed**: a 52 px field-looking button, `role="combobox"`, named by the visible label, with the value (or the placeholder) and a trailing icon (chevron, clock, calendar). Focus ring, invalid (danger border, `aria-invalid`), disabled (60 % opacity), required (`aria-required`).
- **Open**: below `md` a bottom sheet (the shared Sheet: focus trap, Esc, backdrop, focus return, 16 px top corners, never taller than 88 dvh, content scrolls inside); from `md` an anchored popover under the field (flips above when there is no room, scrolls inside, closes on Esc, outside click and Tab, neutral `0 2px 8px` shadow). Both live in `src/components/ui/pickers/PickerSurface.tsx`; the popover position is written through the CSS object model, never an inline `style=""` attribute, so the strict nonce CSP is untouched.
- **Select** (`ui/Select.tsx`): `options`, `onChange(value)`, `placeholder`, groups, a check mark on the chosen option, 44 px options, arrows / Home / End / PageUp / PageDown / typeahead / Enter / Space. `searchable` adds a search box (time zones, country codes).
- **TimePicker** (`ui/TimePicker.tsx`): `HH:mm`, 24 h, Latin digits, always left to right. Hours column then minutes column (5-minute grid; an off-grid saved minute stays selectable). `endOfDay` (Closes) offers 01 to 24 where 24 is "24:00 (midnight)" with the minutes locked to 00.
- **DatePicker** (`ui/DatePicker.tsx`): `yyyy-MM-dd` in the business time zone; the field shows "Jul 10, 2036" (Latin digits). Month grid, Monday first, 44 px day cells on phones (40 px from `md`), today marker, selected day, `min` / `max` disabled days, previous / next month (chevrons mirror in RTL), PageUp / PageDown (Shift for years), Home / End, Today and optional Clear. In RTL the grid is mirrored and ArrowLeft goes forward.
- Tests drive them with `tests/e2e/helpers/pickers.ts` (`selectOption`, `searchAndSelect`, `pickTime`, `pickDate`); each closed field exposes `data-value` with the raw value.

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
