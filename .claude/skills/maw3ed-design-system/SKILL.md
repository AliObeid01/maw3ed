---
name: maw3ed-design-system
description: Use when building or reviewing any Maw3ed UI screen or component. Gives the design tokens extracted from maw3ed-design.html, the Tailwind theme mapping, component recipes, the board-to-route map, and the rules for adapting the 1440 px desktop boards to a phone-first, fully responsive layout.
---

# Maw3ed design system

The source design is `maw3ed-design.html` (31 boards, all 1440 px desktop). Read a board's exact markup in
`design/screens/<nn>-<slug>.html` (index: `design/screens/index.json`). If missing, run
`node scripts/design/extract-screens.mjs`. Reference PNGs: `design/boards/` (`node scripts/design/snapshot-boards.mjs`).

**Character:** calm, warm, premium. Cream canvas, white cards with hairline borders, deep teal as the brand,
gold as the single action accent. Generous radius, pill buttons, no heavy shadows. Phone-first.

## Tokens (define once in `src/app/globals.css` with Tailwind v4 `@theme`)
| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F7F5F0` | page background |
| `surface` | `#FFFFFF` | cards, header, sidebar |
| `ink` | `#252D2D` | primary text |
| `muted` | `#626967` | secondary text, labels, eyebrows. Darkened from the board `#737C79` (3.9:1 on canvas, 3.5:1 on the chip) so it passes AA on canvas, white and divider (5.2 / 5.6 / 4.6:1); same warm hue |
| `subtle` | `#8A918E` | placeholders and disabled text only (3:1); never real copy |
| `line` | `#E3DED2` | card and input borders |
| `divider` | `#ECE8DF` | header/footer borders, neutral chip bg, row dividers (`#EFECE4`) |
| `brand` | `#174C4F` | primary buttons, active step, links |
| `brand-hover` | `#0F3638` | hover/pressed |
| `brand-deep` | `#123F42` | text on brand-soft |
| `brand-soft` | `#E3EDEB` | active nav bg, info callouts, "Confirmed" chip; avatar `#DCE9E7` |
| `accent` | `#E8B86D` | gold CTA (WhatsApp send, "Send now"), completed step dots, business monogram |
| `success` / `success-soft` | `#2D6A4F` / `#DFEFE3` | attended, claimed (deep text `#1B4332`) |
| `warning` / `warning-soft` / `warning-line` | `#9A5800` / `#FFF0D6` / `#F6D49A` | "needs you", outcome badge (deep text `#6B3D00`) |
| `amber` / `amber-soft` | `#6B4A10` / `#F3E3C4` | waitlist, offered |
| `danger` / `danger-soft` / `danger-line` | `#C21F3A` / `#FFE1E4` / `#F5B3BD` | no-show badge, 2 h urgency, red count badge |
| hero text | `#E4EEEC`, `#D4DFDD`, `#D0E0DE` | text on the teal hero band (the last two lightened from the board `#C9D6D4` / `#BCD2D0` to reach 4.5:1 at the teal glow) |

**Hero band** (public header strip, "Do this first" card):
`background: radial-gradient(circle at 85% -40%, rgb(232 184 109 / .24), transparent 50%), radial-gradient(circle at 0% 140%, rgb(46 125 128 / .64), transparent 55%), #174C4F` → utility class `bg-hero`.

**Type:** Outfit 400/500/600/700 via `next/font/google` (`--font-sans`). Arabic: IBM Plex Sans Arabic, applied when `dir="rtl"`.
Scale: 12, 13, 14, 15 (body), 16, 18, 20, 22 (page title in dashboard header), 24 (section h2), 26 (hero h1), 28 (stat number).
Eyebrow: 12–13 px, 600, uppercase, `tracking-[0.08em]`, `muted`. Inputs use 16 px so iOS doesn't zoom.

**Radius:** chips and buttons `999px`; inputs `14px`; small tiles and calendar blocks `10–12px`; nav items `12px`;
stat tiles `18px`; cards `22–24px`; monogram `20px` (64 px) / `12px` (36 px).

**Elevation:** borders, not shadows. At most a soft `0 1px 3px rgb(0 0 0 / .06)` on floating elements (FAB, sheets, toasts).

**Icons:** lucide-react, stroke 2, 18–20 px; the paths in the boards are lucide-style.

## Component recipes (in `src/components/ui` unless noted)
- **Button**: variants `primary` (brand bg, white, 600), `accent` (gold bg, ink text), `secondary` (white, `line` border, ink),
  `ghost`, `danger`. Height 44 (default) / 50 (lg, full-width on mobile) / 46 (row action). Pill. Icon gap 6–8 px. Loading spinner + `aria-busy`.
- **IconButton**: 44×44 circle, `line` border, white. Back / prev / next. Mirror chevrons in RTL.
- **Input / Select**: 52 px tall, radius 14, `line` border, 16 px text, label above (14 px, 500), 6 px gap; error text in danger below.
  Phone field = country-code select (`+961` default) + tel input.
- **Card**: white, 1 px `line`, radius 24 (22 for side cards), padding 20–24.
- **StatTile**: white card radius 18, padding 16, number 28/600 (tone colour optional) + 14 px muted label.
- **Chip/StatusChip**: pill, 12 px 500–600, padding 4×10. Map: Booked → divider/muted; Confirmed → brand-soft/brand;
  Attended → success-soft/success; No-show → danger-soft/danger; Late cancel → warning-soft/warning; Cancelled → divider/muted with strike-through;
  Waitlist/Offered → amber-soft/amber; Claimed → success-soft/success; reminder "2 h" → danger-soft/danger, "24 h" → divider/muted.
- **NoShowBadge** (`src/components/app`): white pill, 1 px `danger-line`, danger text, 11 px 600, "● N no-shows". Shows on every booking of a repeat no-shower.
- **CountBadge**: min 22 px circle, 12 px 700; red (`danger` bg, white) for reminders due, amber (`warning-soft`/`warning`) for outcomes.
- **StepRail** (`src/components/public`): white card radius 24, eyebrow "Book in 4 steps", 30 px circles: current = brand/white,
  done = gold with a check + the chosen value under the label, todo = divider/muted. `aria-current="step"`.
- **ServiceCard**: button, min-height 112, radius 22, name 18/600, duration 14 muted, price 20/600.
- **SlotGrid**: pill buttons of times, selected = brand; day strip of date pills above.
- **Callout**: brand-soft bg, radius 20, padding 16, icon + 14 px `brand-deep` text.
- **BookingSummary** (`public`): "Your booking" card with a 2-column grid of label/value (muted when empty).
- **PublicHeader + BusinessHero** (`public`): white header with logo; hero band with a 64 px gold monogram, name 26/600, meta line, pill facts.
- **AppShell** (`app`): see responsive rules. Sidebar nav item: min-height 44, radius 12, active = brand-soft bg + brand text 600.
- **DataRow list**: on `md+` a grid table (uppercase 13 px header, `#EFECE4` row dividers); on mobile, stacked cards with the action full width.
- **CalendarGrid** (`app`, `lg+`): 64 px time column + one column per staff, 44 px rows per 30 min, blocks radius 10–12 tinted by status,
  breaks with a diagonal stripe pattern.
- **Sheet / Dialog**: bottom sheet on mobile (radius 24 top corners, drag handle), centered dialog on `md+`.
- **Toast**: bottom-center on mobile above the tab bar.

## Responsive rules (build at 360 px first)
Breakpoints: base (360–767), `md` 768, `lg` 1024, `xl` 1280. Content max widths: public 1240, dashboard 1180.

| Desktop board pattern | Phone (base) | Tablet (`md`) |
|---|---|---|
| Public 3-column (step rail · content · summary) | Single column. Step rail → compact "Step 2 of 4" progress bar + back button. Summary → sticky bottom bar (price + primary CTA), tap to expand as a sheet. | Content + summary side by side; rail as a horizontal stepper on top |
| Hero band | Monogram 48 px, name 22 px, facts wrap as pills | as desktop |
| Dashboard sidebar (256 px) | **Bottom tab bar**: Today, Reminders (red badge), Outcomes (amber badge), Clients, More. "More" opens a sheet with Pilot report + the Business section (Setup, Services, Staff, Hours, Settings, Booking link) and sign out. **FAB** "New booking" (56 px gold/brand circle) above the tab bar, end side. | Same as phone up to `lg` |
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
- Focus ring: 2 px brand outline with 2 px offset. Never remove outlines.
- Copy from the boards is the default English copy; keep its tone (short, warm, direct).
