---
name: maw3ed-design-system
description: Use when building or reviewing any Maw3ed UI screen or component. Gives the design tokens extracted from maw3ed-design.html, the Tailwind theme mapping, component recipes, the board-to-route map, and the rules for adapting the 1440 px desktop boards to a phone-first, fully responsive layout.
---

# Maw3ed design system

The source design is `maw3ed-design.html` (31 boards, all 1440 px desktop). **The boards still show the ORIGINAL teal and gold
look and the OLD logo: use them as layout references only (hierarchy, spacing, copy), never for colour, corner radius or logo.**
The shipped look is palette blue v2 and the new calendar-M logo below. Read a board's exact markup in
`design/screens/<nn>-<slug>.html` (index: `design/screens/index.json`). If missing, run
`node scripts/design/extract-screens.mjs`. Reference PNGs: `design/boards/` (`node scripts/design/snapshot-boards.mjs`).

**Character:** calm, modern, premium. Cool near-white canvas, white cards with hairline borders, Royal Blue as the brand on Deep
Navy ink. Flat fills only: **no gradients, glows, blur, gradient text or coloured glow shadows, and no gold** (`palette.test.ts`
fails if the old gold appears). Rounded-rectangle buttons (not pills), neutral small shadows only. Phone-first.

## Tokens (define once in `src/app/globals.css` with Tailwind v4 `@theme`)
| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F3F5FA` | page background |
| `surface` | `#FFFFFF` | cards, header, sidebar |
| `ink` / `navy` | `#0B1938` | primary text (Deep Navy), the hero band |
| `muted` | `#56668A` | secondary text, labels, eyebrows (AA on canvas, white and divider) |
| `subtle` | `#657799` | placeholders, disabled text and struck-out taken slots ONLY (4.5:1 on white); never real copy |
| `line` / `line-strong` | `#D3DCEE` / `#8393B8` | card and input borders / non-text border for "unavailable" things (3:1) |
| `divider` / `row` | `#E9EFF8` / `#EDF1F8` | header and footer borders, neutral chip bg, row dividers |
| `brand` | `#254EDB` | Royal Blue: primary buttons, active step, links |
| `brand-hover` / `brand-deep` | `#1D3FB8` / `#16318F` | hover and pressed / text on brand-soft |
| `brand-soft` / `brand-avatar` | `#E2EBFC` / `#DCE6F8` | active nav bg, info callouts, "Confirmed" chip, active option / avatar |
| `electric` | `#2864F5` | focus ring, selected day, the `accent` button variant |
| `cyan` | `#43C4F0` | small info chips, initials tiles, business monogram, logo check. Navy text only |
| `turquoise` / `mint` | `#21CDB3` / `#20D2AC` | the one highlight tile ("Refilled from waitlist", navy text only) / service icons |
| `whatsapp` | `#12805C` | WhatsApp buttons (white text 4.92:1). Never the bright `#25D366` |
| `success` / `success-soft` / `success-deep` | `#17795A` / `#DDF5EC` / `#0F5139` | attended, claimed |
| `warning` / `warning-soft` / `warning-line` / `warning-deep` | `#9A5800` / `#FFF1D6` / `#F6D49A` / `#6B3D00` | "needs you", outcome badge |
| `amber` / `amber-soft` | `#6B4A10` / `#F6E6C8` | waitlist, offered |
| `danger` / `danger-soft` / `danger-line` | `#C21F3A` / `#FFE4E8` / `#F5B3BD` | no-show badge, 2 h urgency, red count badge |
| `hero-ink` / `hero-muted` / `hero-subtle` | `#E9EFF8` / `#C9D6F2` / `#B9C9EC` | text on the navy hero band |

Cyan and Turquoise are never text on white and never carry white text. There is **no `accent` / gold token**: use `bg-cyan`.
The source of truth is `src/app/globals.css` (`@theme`); `pnpm` runs the contrast script that enforces the pairs above.

**Hero band** (public header strip, "Do this first" card): a FLAT Deep Navy fill with a 4 px Royal Blue bottom edge, utility class
`bg-hero` (`background-color: var(--color-navy); border-bottom: 4px solid var(--color-brand)`). No radial glow, no gradient.

**Type:** Outfit 400/500/600/700 via `next/font/google` (`--font-sans`). Arabic: IBM Plex Sans Arabic, applied when `dir="rtl"`.
Scale: 12, 13, 14, 15 (body), 16, 18, 20, 22 (page title in dashboard header), 24 (section h2), 26 (hero h1), 28 (stat number).
Eyebrow: 12–13 px, 600, uppercase, `tracking-[0.08em]`, `muted`. Inputs use 16 px so iOS doesn't zoom.

**Radius** (tokens in `globals.css`): buttons `12px` (`rounded-btn`), inputs and selects `12px` (`rounded-input`), chips `8px`
(`rounded-chip`), nav items `10px`, stat tiles `14px`, small cards `14px`, cards `16px` (`rounded-card`). `rounded-pill` only for
the Switch, avatars, dots and count badges. The business monogram is a cyan tile (`14px` at 48 px, `rounded-tile` at 64 px).

**Elevation:** borders, not shadows. At most a neutral small `0 1px 3px rgb(0 0 0 / .06)` on floating elements (FAB, sheets, toasts) and
`0 2px 8px rgb(0 0 0 / .10)` on the picker popover. Never coloured or blurred glow shadows.

**Icons:** lucide-react, stroke 2, 18–20 px; the paths in the boards are lucide-style.

## Component recipes (in `src/components/ui` unless noted)
- **Button**: variants `primary` (brand bg, white, 600), `accent` (electric bg, white), `secondary` (white, `line` border, ink),
  `ghost`, `danger`, `whatsapp`, `call`. Rounded rectangle (12 px), not a pill. Height 44 (default) / 50 (lg, full-width on mobile) / 46 (row action).
  Icon gap 6–8 px. Loading spinner + `aria-busy`.
- **IconButton**: 44×44 circle, `line` border, white. Back / prev / next. Mirror chevrons in RTL.
- **Input**: 52 px tall, radius 12, `line` border, 16 px text, label above (14 px, 500), 6 px gap; error text in danger below.
- **Select / TimePicker / DatePicker** (F69-D, no native `<select>`, `type="date"` or `type="time"` anywhere): field-looking 52 px
  button (`role="combobox"`, `aria-expanded`) that opens a **bottom sheet below `md`** and an **anchored popover from `md`**
  (one primitive: `ui/pickers/PickerSurface.tsx`). `Select` (`ui/Select.tsx`) takes `options` and `onChange(value)`, has a
  `searchable` variant for long lists (time zones, country codes). `TimePicker` shows `HH:mm` (24 h, Latin digits, always LTR) with
  hours and 5-minute columns; `endOfDay` adds `24:00 (midnight)`. `DatePicker` holds `yyyy-MM-dd` in the BUSINESS time zone, month grid,
  Monday first, 44 px day cells on phones. Phone field = searchable country-code Select (`+961` default) + tel input.
  Tests use `tests/e2e/helpers/pickers.ts` (`selectOption`, `pickTime`, `pickDate`).
- **Card**: white, 1 px `line`, radius 16 (`rounded-card`; 14 for small cards), padding 20–24.
- **StatTile**: white card radius 14, padding 16, number 28/600 (tone colour optional) + 14 px muted label.
- **Chip/StatusChip**: 8 px radius (`rounded-chip`), 12 px 600, padding 4×10. Map: Booked → divider/muted; Confirmed → brand-soft/brand;
  Attended → success-soft/success; No-show → danger-soft/danger; Late cancel → warning-soft/warning; Cancelled → divider/muted with strike-through;
  Waitlist/Offered → amber-soft/amber; Claimed → success-soft/success; reminder "2 h" → danger-soft/danger, "24 h" → divider/muted.
- **NoShowBadge** (`src/components/app`): white pill, 1 px `danger-line`, danger text, 11 px 600, "● N no-shows". Shows on every booking of a repeat no-shower.
- **CountBadge**: min 22 px pill, 12 px 700; red (`danger` bg, white) for reminders due, amber (`warning-soft`/`warning`) for outcomes.
- **StepRail** (`src/components/public`): white card radius 16, eyebrow "Book in 4 steps", 30 px circles: current = ink/white,
  done = brand/white with a check + the chosen value under the label, todo = divider/muted. `aria-current="step"`.
- **ServiceCard**: button, min-height 112, radius 16, name 18/600, duration 14 muted, price 20/600.
- **SlotGrid**: rounded buttons of times, selected = brand; day strip of date pills above.
- **Callout**: brand-soft bg, radius 14, padding 16, icon + 14 px `brand-deep` text.
- **BookingSummary** (`public`): "Your booking" card with a 2-column grid of label/value (muted when empty).
- **PublicHeader + BusinessHero** (`public`): white header with the logo (light version); flat navy hero band with a 64 px cyan monogram tile (48 px on phones), name 26/600, meta line, facts as small rounded chips.
- **AppShell** (`app`): see responsive rules. Sidebar nav item: min-height 44, radius 12, active = brand-soft bg + brand text 600.
- **DataRow list**: on `md+` a grid table (uppercase 13 px header, `#EFECE4` row dividers); on mobile, stacked cards with the action full width.
- **CalendarGrid** (`app`, `lg+`): 64 px time column + one column per staff, 44 px rows per 30 min, blocks radius 10–12 tinted by status,
  breaks with a diagonal stripe pattern.
- **Sheet / Dialog**: bottom sheet on mobile (16 px top corners, drag handle), centered dialog on `md+`. Pickers reuse the Sheet below `md`.
- **Logo** (`src/components/brand/Logo.tsx`): the calendar icon with an M inside; the "3" of Maw3ed is two stacked turquoise arcs (PR-16b logo).
  Source files in `design/logo` (with its README); two versions: **light** (`tone="brand"`, on white surfaces) and **reverse**
  (`tone="white"`, on the navy hero, sidebar and email band). Flat paths only: **no gold, no gradient, no filter**. Under 96 px wide the
  full logo becomes the written wordmark. Never recolour or redraw it. Variants: `full`, `wordmark`, `icon`; the reverse icon body is a lighter navy with a faint outline.
- **Toast**: bottom-center on mobile above the tab bar.

## Responsive rules (build at 360 px first)
Breakpoints: base (360–767), `md` 768, `lg` 1024, `xl` 1280. Content max widths: public 1240, dashboard 1180.

| Desktop board pattern | Phone (base) | Tablet (`md`) |
|---|---|---|
| Public 3-column (step rail · content · summary) | Single column. Step rail → compact "Step 2 of 4" progress bar + back button. Summary → sticky bottom bar (price + primary CTA), tap to expand as a sheet. | Content + summary side by side; rail as a horizontal stepper on top |
| Hero band | Monogram 48 px, name 22 px, facts wrap as chips | as desktop |
| Dashboard sidebar (256 px) | **Bottom tab bar**: Today, Reminders (red badge), Outcomes (amber badge), Clients, More. "More" opens a sheet with Pilot report + the Business section (Setup, Services, Staff, Hours, Settings, Booking link) and sign out. **FAB** "New booking" (56 px brand circle) above the tab bar, end side. | Same as phone up to `lg` |
| Dashboard header (title + date nav + New booking) | Title + date; date nav becomes a swipeable day strip; New booking via FAB | as desktop |
| Calendar grid (staff columns) | **Agenda list** grouped by time, with horizontal staff filter chips ("All", Lina, Karim…) | 2 staff columns or agenda |
| Data tables (reminders, clients, outcomes) | Stacked cards; primary action full width at the bottom of each card | table if it fits, otherwise cards |
| Stat tile row | 2×2 grid | 4 across |
| Side cards ("Do this first", "Needs you") | Shown **above** the agenda: the WhatsApp card is the first thing staff see | right column |

General: no horizontal page scroll at 360; safe-area insets (`env(safe-area-inset-bottom)`) on the tab bar and sticky CTAs;
tap targets ≥ 44 px with ≥ 8 px spacing; one primary action per screen, reachable by thumb.

## Board → route map
See `docs/DESIGN_SYSTEM.md`. Public: `/b/[slug]` (1.1–1.6), `/b/[slug]/waitlist` (1.7), `/l/[token]` (2.1–2.2), `/o/[token]` (2.3).
Auth: `/signup`, `/login`, `/invite/[token]` (3.1–3.3). Setup: `/app/setup|services|staff|hours|settings|share` (3.4–3.9).
Dashboard: `/app`, `/app/reminders`, `/app/book`, `/app/outcomes`, `/app/appointments/[id]`, `/app/clients`, `/app/clients/[id]`, `/app/pilot` (4.1–4.8).
Extras: `/pricing` (5.1), `/pay/[token]` (5.2).

## Premium polish checklist
- Consistent 4/8 px spacing rhythm (gaps of 8, 12, 14, 16, 18, 24 as in the boards).
- Skeletons that match the final layout; empty states with a one-line explanation and one action.
- Transitions 150–250 ms ease-out on sheets, step changes and chips; respect `prefers-reduced-motion`.
- Tabular numbers (`tabular-nums`) for times, prices and stats.
- Focus ring: 2 px `electric` outline with 2 px offset (white on dark surfaces). Never remove outlines.
- Copy from the boards is the default English copy; keep its tone (short, warm, direct).
