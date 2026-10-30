# Maw3ed design QA (P4.1), 30 Oct 2026

Method: production build on a local QA database (not Neon), seeded Studio Nour plus extra bookings, 28 routes x 360/768/1440 x en/ar captured with Playwright, plus the booking flow, slot-taken state, More sheet, and axe-core (wcag2a/aa/21aa + best-practice) at 360 in en and ar. Comparison with boards was visual (layout, hierarchy, tokens, components), not pixel diff. Screenshots are outside the repo (session scratchpad `shots/`).

> **Round 1 status (fix/design-qa-round-1).** This report was produced against a stale copy of the code (7 merges behind). Stale findings, now built and ignored: /pricing, /directory, /pay/[token], the home page, the Settings deposit card, and /o/[token]/leave (exists). Each row below ends with **Fixed**, **Stale** or **Deferred** and a one-line note.

## Findings

| Severity | Route | Viewport / locale | Problem | Suggested fix | Status |
|---|---|---|---|---|---|
| blocking | /pricing | all | 404 (board 5.1 not built, P3.8). Linked from the public header (all widths, `md+` nav and mobile menu) and from the Settings plan card ("See Pro"). | Build page, or hide links until it exists (`PublicHeader.tsx`, `SettingsView.tsx:371`) | **Stale**: /pricing exists (P3.8). |
| blocking | /help | all | Header "Help" link goes to a 404. | Build or remove the link (`PublicHeader.tsx`, `helpHref`) | **Fixed**: no Help page exists, so the header link and its message key were removed. |
| blocking | /directory, /pay/[token] | all | 404 (D2 and P3.9 not built). Settings has no deposit card either. | Per PLAN, build or cut | **Stale**: both exist (D2, P3.9), and Settings has the deposit card. |
| blocking | / | all | Only logo and tagline, no heading, no CTAs, no language toggle (P4.5). | Build the home page | **Stale**: home page built (P4.5). |
| blocking | global 404 (`/nope`, `/o/[token]/leave`) | all, ar | Default unstyled Next 404: white, English only in Arabic mode, no landmark, no heading link home, "404" and sentence wrongly ordered in RTL. | Add `app/not-found.tsx` using the branded `PageState` (en/ar) | **Fixed**: `src/app/not-found.tsx` (branded, en/ar, heading, link home, in `<main>`). /o/[token]/leave exists, so that part is stale. |
| should-fix | /l/[token] | 360 ar | Time range renders reversed ("9:30 – 9:00") and "Haircut مع $15 · Karim" is scrambled: LTR runs inside RTL text. | Wrap times, prices, phone, and Latin names in `<bdi>`/`dir="ltr"` spans, or format with `Intl` plus LRM | **Fixed**: shared `Bidi`/`TimeRange`/`MetaLine` (`src/components/ui/Bidi.tsx`); ranges, prices and names are isolated. |
| should-fix | /app/clients/[id], /app/appointments/[id], /app/outcomes | 360 ar | Separator dots dangle at line ends ("... · 20:08 ·", "Haircut · Lina ·") when a Latin service or staff name sits in an Arabic line. Same bidi cause. | Same fix; build the meta line from separate inline-flex items rather than a joined string | **Fixed**: meta lines built from isolated items with `MetaLine`. |
| should-fix | /app/services | 360 | Active toggles are 52x32 px (< 44 px target); `ul role=rowgroup` and `role=row` flagged by axe (aria-allowed-role). | Give the switch a 44 px hit area (`before:` pseudo or wrapper); use native table/list semantics | **Fixed**: switch button is 44 px tall (track stays 52x32); rowgroup/row now on `div`s. |
| should-fix | /app/outcomes | 360 | Client-name links 28 px high. | `min-h-11` on the row link or make the whole header the tap target | **Fixed**: link padded to a 44 px target. |
| should-fix | /app/clients/[id] | 360 | Appointment history links 23 px high. | Pad the row to 44 px | **Fixed**: row link is `min-h-11`. |
| should-fix | /app/* | 360 | Floating New booking button (`.end-4`) is outside any landmark (axe `region`); on 360 it overlaps content only at the very bottom, bottom padding is adequate (last content 595 px vs FAB 644 px). | Render the FAB inside the shell landmark, e.g. in `<nav>`/`<aside aria-label>` | **Fixed**: FAB rendered inside `<main>`. |
| should-fix | /b/[slug], /l, /o | all | `region` (axe): hero/summary content outside landmarks. | Put `BusinessHero` inside `<main>` or label as `<header>` | **Fixed**: `BusinessHero` is a named region (`aria-label`). |
| should-fix | /app/pilot | 360 | Baseline form precedes the headline KPI hero, so the first screen is a form with empty inputs rather than the board's metric band. `figure role=img` flagged by axe. | Move the hero/KPI band above the baseline card on mobile; drop `role=img` on `figure` (use `role="group"` or `<img>`/aria-label on svg) | **Fixed**: KPI band first on phones; chart is a `div role="img"` instead of `figure`. |
| should-fix | /app/settings | 1440 ar | Settings page: plan card is half-width and has no deposit rules card; board 3.8 shows a three-block layout. Layout otherwise mirrors correctly. | Add deposit card (P3.9); align card widths | **Stale/skipped**: deposit card exists; the 2-column grid at lg has equal-width cards, no change. |
| polish | /b/[slug] | all | Hero shows raw category "salon" (lowercase, untranslated in Arabic). | Map category to an i18n label (`BusinessHero.tsx`) | **Fixed**: `useCategoryLabel` maps known categories (en/ar), unknown shown as typed. |
| polish | /b/[slug] | 768, 1440 | Prefetch of 404 targets (/pricing, /help) produces console 404s on every public page. | Resolved by building or removing links | **Fixed**: no more 404 prefetch targets. |
| polish | /signup | 360 ar | Empty gap between the slug field and "اسمك" (reserved slug-status line with no content). | Collapse the helper row when empty, or use `min-h` only while checking | **Fixed**: status row only reserves height once a slug is typed. |
| polish | /app/hours, /app/pilot | 360 en/ar | Native date/datetime inputs show US `mm/dd/yyyy --:-- --` regardless of locale, and are 12-hour while the rest of the UI is 24-hour. | Use separate date and 24-hour time controls, or accept as browser-native | **Deferred**: native date input redesign out of scope. |
| polish | /app/clients | 360 | Meta line wraps with orphan "Last: Sat, Oct 17" split across lines. | `whitespace-nowrap` on the last-visit chunk | **Fixed**: `whitespace-nowrap` on the last-visit chunk. |
| polish | /app (Today) | 360 | With nothing booked today the page shows four zero tiles, then reminders, then an empty card; the board's calendar grid/agenda not exercised (seed data was tomorrow). | Re-check with data for today at 360/1440; consider hiding zero tiles | **Deferred**: hiding zero tiles out of scope. |
| polish | /app/outcomes | 360 | "Late cancel" label wraps to two lines while the other buttons are one line. | Shorten label or allow equal two-line height for all three | **Stale**: buttons sit in an equal-width grid with equal row height; no change needed. |
| polish | /invite, /login, /signup | all | Decorative glow `div`s extend off-screen (clipped by the container, no horizontal scroll). No action needed beyond confirming `overflow-hidden` stays. | None | **Deferred**: no action needed. |
| polish | /o/[token]/leave | all | Not a route (404). If the board expects a standalone page, missing; if it is an in-page action, ignore. | Confirm with the design | **Stale**: the route exists now. |

## What passed
- No horizontal scroll on any captured route at 360, 768 or 1440 in en or ar (the overflow checker only flagged the decorative glows).
- Dashboard layout rules hold: sidebar at 1440, bottom tab bar with More sheet and floating New booking at 360. Booking is 4 steps (service, staff, day and time, details) plus the booked screen. Validation error and slot-taken states render, with fresh-slot guidance, in en and ar.
- RTL: `dir=rtl`, `lang=ar`, IBM Plex Sans Arabic computed on body, layout and chevrons mirror, the slug field and phone numbers stay LTR.
- Contrast: axe reports zero `color-contrast` violations in en and ar on all captured routes. Current `muted` is `#626967` (5.2:1 on canvas, 5.6:1 on white), already darkened from the board's `#737C79` (3.9:1 on canvas). Recommendation: keep `#626967` and mark PLAN item F8 done. Keep `subtle` (#8a918e, about 3.2:1) for placeholders and decorative text only.
- Focus: links and buttons show a 2 px solid outline on keyboard focus (sampled on /app/reminders).
- Heading order: a single h1 per page on every route. Public pages use h1 for the business name and h2 for the step, which is acceptable.
- Tap targets: only the items in the table are under 44 px.

## Accessibility scores
Lighthouse could not be run: `npx lighthouse` could not download over the network from this machine (npm network error), so there are no Lighthouse numbers and no performance scores. As a substitute, axe-core (same engine as the Lighthouse accessibility audit) found zero serious or critical violations on all 20 existing routes at 360 in en and ar. Remaining axe items: `region` (moderate, every route), `aria-allowed-role` (minor, /app/services and /app/pilot). Estimated Lighthouse accessibility is therefore at or above 90, but it is not measured. Run `npx lighthouse` on /b/studio-nour, /app and /app/reminders where the network works to confirm.

## Not covered
Pay page, directory and pricing do not exist, so nothing to compare. Today with appointments on the current day, the waitlist-offer expired state and the disabled "sent by ..." WhatsApp button (no reminders were due) were not visually verified.
