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

## Logo (PR-16b, owner file `design/logo/maw3ed-logo-light.svg`)
A calendar icon with the M inside, then the name; the "3" of Maw3ed is two stacked turquoise arcs (it reads as the Arabic ayn). Flat paths only: no text, fonts, gradients, filters or images (CSP-safe). `design/logo` (with its README) is the source of truth; `node scripts/design/build-logo-assets.mjs` regenerates every variant and raster from the light SVG.
- **In the UI**: `src/components/brand/Logo.tsx` renders inline SVG. Props `label` (accessible name, e.g. "Maw3ed home"; omitted = `aria-hidden`), `className`, `width`, `tone`, `variant`. `tone="brand"` is the LIGHT version (navy wordmark) for white surfaces (public header, sidebar, auth pages, error page); `tone="white"` is the REVERSE version (white wordmark) for navy surfaces (footer, dark bands). `variant`: `full` (icon + name), `wordmark` (name only) or `icon` (the 64 x 64 calendar alone, for tight spaces). Under `MIN_FULL_LOGO_WIDTH` (96 px) `full` automatically becomes the wordmark. Sizes in use: sign-in and sign-up 160, dashboard sidebar 130, public header 132 (104 below `md`), footer 132, error page 120.
- **Reverse on navy**: the icon's navy body would vanish on a navy surface, so ONLY the reverse variant draws it a slightly lighter navy (`#16295E`) with a faint 1.2-unit white outline at 22 % opacity (about 1.5 px at header size); the geometry is identical (a unit test compares the paths).
- **Email**: a Deep Navy `#0B1938` band with the reverse PNG (`/brand/maw3ed-email-logo-reverse-320w.png`, shown at 160 x 48, `alt="Maw3ed"`) as an absolute URL from `APP_URL`; the files live in `public/brand` (160w, 320w and 480w, reverse and light, 160x48, 320x96, 480x144). The plain-text part and the `.ics` carry the plain name Maw3ed.
- **Icons**: `src/app/favicon.ico` (16, 32, 48 PNG entries, packed by the script), `src/app/icon.svg` (the icon alone), `src/app/apple-icon.png` (180, icon on white), `src/app/manifest.ts` (192, 512 and a maskable 512 from `public/brand`: the reverse icon at 60 % on a solid navy square, inside the safe zone). The WhatsApp profile picture (`design/logo/whatsapp-profile-640.png`) is uploaded by the owner by hand.
- Do not recolour, outline (other than the reverse rule above) or redraw it; edit `design/logo` first, then copy the paths.

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

## Marketplace home (PR-7a, owner design `design/Home page/Maw3ed_Home_Page.html`)
PR-11 restructure (owner decision H1: match the design's STRUCTURE). The home `/` is SHORT, like the design: header, hero (`HomeHero`), Browse by category (`CategoryExplorer`), the NAVY closing band (`FinalCta`: "Run a salon, barbershop or clinic?", turquoise "Put your business on Maw3ed", outline "Business sign in"), footer. The long sections moved to their own pages, same components: `/how-it-works` (`HowItWorks`: 3 steps, the reminder email preview built from the REAL `email.h24` / `email.actions` texts and labelled "Illustration", "A reminder you can act on", FAQ in native `<details>`, anchors `#reminders` and `#faq`) and `/for-business` (`OwnerBand` in the SAME flat navy as the home hero, with the fake "Today" card, `SetupSteps`, `PlansSection` on a Soft Blue Gray band, `id="plans"`; see PR-13 below). All server components except the pieces that fetch.
- **Header and tab bar:** `publicNav.ts` is the single model. Wide: Explore (`/`), My bookings (only with saved bookings), How it works (`/how-it-works`), then the small Sign in link, the language toggle and the navy "For business owners" button (`/for-business`); no Pricing link (it lives on `/for-business` and in the footer). Phone tab bar: Explore, How it works and, with saved bookings, My bookings (2 to 3 equal columns, no layout shift); the owners button stays in the header. `aria-current="page"` on the current item (Explore also on `/directory`; the owners button on `/for-business`).
- **Hero "Next free" panel (lg+):** ONE Royal Blue card holding ONE white card with up to four rows (`NextFreePanel`): navy `BusinessAvatar`, bold name, "Category · Street", one outlined time chip ("Today 09:30", "Mon 09:30", business zone, Latin digits). The whole row opens `/b/<slug>`; no time is preselected. Hidden gracefully on empty, error or 429; its column keeps its height while loading and collapses when there is nothing to show.
- **Categories on the home:** categories with 0 places are hidden (live data), one quiet line under the list ("More categories are coming soon. Own a salon or clinic? List your business.") appears only when some are hidden; with none a "Be the first on Maw3ed" block replaces the two-pane; a stable skeleton shows while loading; the default selection is the first category with places. The chips heading is "Popular services" only with 3 or more places, else "Services". Hero Popular chips come from the live data (fallback: the static four), on ONE non-wrapping line so the row never changes height.
- **Navigation feedback (PR-11):** `PendingLink` wraps `next/link` (`useLinkStatus`): the clicked link gets `aria-busy` and fades slightly, and a slim turquoise bar (`NavProgress`, pure CSS, `.nav-progress` in `globals.css`) shows at the top after 150 ms; with reduced motion it is static. `loading.tsx` skeletons (`PageLoading`) for `/directory`, `/how-it-works`, `/for-business`, `/pricing`.
- **Anchors:** `html { scroll-padding-top: 5.5rem }` clears the 65 px sticky header for every in-page anchor; headings that carry an id add `scroll-mt-4`; smooth scrolling only under `prefers-reduced-motion: no-preference`. Legal pages: `LegalToc` (active section with `aria-current="location"`, a collapsed "On this page" `<details>` on phones, the sticky sidebar on lg).
- **Tokens added:** `--radius-btn-lg: 14px` (button size `hero`, 48 px), `--radius-panel: 24px`, `--color-navy-hover`, `--color-turquoise-hover`, `--color-hero-accent` (Cyan, ONLY as text on navy). Button variants `navy`, `turquoise` (navy text) and `onDark`.
- **Shared:** `PublicHeader` (see the PR-11 notes above), `PublicFooter` (navy, columns, legal line), `PlaceCard` (business with up to 3 service chips, "Free times for <service>" chips in the business zone, `BusinessAvatar`; used in the category panel). Free-time chips link to the business page: the booking page shows what is free now.
- **Mobile adaptation:** the six categories are a snap-scrolling row (opted out of the overflow guard with `data-allow-overflow`) above the panel; the "Next free" panel is not rendered below lg (and not fetched).
- **Copy rules:** never "no availability" or "fully booked" (next free only looks at the shortest service); prices as `8 USD` (the API has no currency field, USD is the default); legal pages carry a draft notice.

## Explore listing (PR-7b, the design's Explore view)
`/directory` follows the owner's Explore view with the PR-7a tokens (Outfit, flat colours, no gradients or glows). Components in `src/components/explore`: `ExploreView` (state, URL, layout), `FilterControls` (Area and Category Selects, When pills + DatePicker, Service chips; one component for the inline bar and the sheet), `FilterPill` (44 px pill toggle with `aria-pressed`: outline when off, solid Royal Blue when on), `ResultCard` (20 px card, 1.5 px divider border, 52 px initials avatar, service chips, free-time chips, 48 px "View & book" button with the 14 px radius), `useExploreResults` (requests).
- **Layout:** 360 px: the text box with a 52 px Search button, then a "Filters" button with a count badge (Filters sheet with Apply and Clear) and a result grid of one column; md: inline bar (search, Area, Category, When, Service); lg: three columns (search | Area | Category, then When over two columns and Service). Results use `repeat(auto-fill, minmax(min(340px, 100%), 1fr))`.
- **States:** skeleton sized like the final cards, results dimmed (not replaced) while a new request is pending, empty (with or without `when`), error banner that keeps the previous results, polite live region ("N places found").
- **Copy rules:** "Free today / tomorrow / <day>" (never a promise: the times can already be taken), "No free times soon" (never "fully booked", "no availability" or "sold out"), "Showing N places" (the API has no total), "Times are shown in each business's local time."

## My bookings on this device (PR-8, `/my-bookings`)
Built from the PR-7a/7b parts (header, footer, `Card`, `Chip`, `Callout`, `ConfirmSheet`, `Skeleton`): no new colours, flat surfaces, no gradients or glows. Components in `src/components/myBookings`: `MyBookingsView` (list, empty, blocked-storage notice, privacy card, Forget sheet), `BookingCards` (`UpcomingCard` live, `PastCard` summary only), `YourBookingsStrip` (on `/b/[slug]`), `FooterMyBookingsLink`, and the hooks `useSavedBookings` (a `useSyncExternalStore` over the storage module) and `useLiveBookings` (pool of 3 link reads).
- **360 px first:** one column of cards: a 64x68 date tile, business name, "service with staff", "Fri 6 Nov · 10:30 – 11:00" (business zone, 24 h, Latin digits), a status chip and "Reference ABC234", then full-width 46 px Confirm / Cancel (two columns from `sm`), then a ghost "View booking page" link. `lg`: cards in two columns.
- **States:** skeleton until the browser has read storage (never a flash of "empty"), empty (icon, "Your bookings will appear here.", Explore businesses), per-card status skeleton, per-card "Could not refresh" + Retry (summary kept), blocked-storage warning callout, cancel sheet (free or late text from the API), Forget sheet.
- **Privacy copy (always visible):** "Only booking details, never your name, phone or email. For past visits we ask Maw3ed whether the visit was completed and keep only that answer and when we asked. Anyone using this browser can see this list." and the shared-computer line. Previous visits show at most a muted success "Completed" chip (text with a check mark, from `GET /api/links/{token}/outcome`, PR-11) and never any other outcome.
- **Entry points:** header nav (lg), phone tab bar (4th tab, `grid-flow-col auto-cols-fr` so 3 and 4 tabs share the same bar), footer Support column, the per-business strip, the booked-step hint. All render only when the device has saved bookings.

## TestCardForm and checkout (PR-11b)

`src/components/billing/TestCardForm.tsx` is the one card form (Pro checkout and `/pay/[token]`). Order: heading + privacy line, warning Callout (test mode), a canvas tile with the custom `Select` "Simulated result" (Payment succeeds / Card declined, hint "Test card 4242 4242 4242 4242") and a secondary "Fill test card" button, then Card number, Expiry + CVC (two columns), Name on card, an optional alert slot (danger Callout, `role="alert"`), and the accent Pay button (`lg`, block, 52 px). Card number, expiry and CVC are `dir="ltr"`, `inputMode="numeric"`, `tabular-nums`, with `cc-number`, `cc-exp`, `cc-csc`, `cc-name` autofill hints; errors are inline (`aria-invalid`, focus moves to the first). No `name` attributes. Flat colours only; no motion beyond the shared button spinner. `/app/checkout` is an order-summary Card (plan, price, perk, total, test note) beside the form (stacked below `lg`); the success state is a centred Card with the check badge and a "Go to dashboard" button. The "Finish upgrading to Pro" banner is a brand-soft bordered section with an accent button, never dismissible. In My bookings a held entry gets a warning "Deposit due" chip and a warning-soft panel with the clock, "Time left m:ss" and a primary full-width "Pay deposit" button.

## Motion (PR-12)

Subtle, fast, CSS-first. Tokens in `globals.css` (`@theme static`): `--motion-fast` 150 ms, `--motion-base` 220 ms, `--motion-slow` 400 ms, `--motion-ease` `cubic-bezier(0.2, 0.8, 0.2, 1)` (ease-out), `--motion-rise` 12 px, `--motion-stagger` 60 ms. Only `transform` and `opacity` move (plus the link underline offset), so there is no layout shift; no `will-change`, no parallax, no auto-playing anything, no shake. Everything sits inside `prefers-reduced-motion: no-preference`; with `reduce` one safety net in the base layer makes every animation and transition instant (`0.01ms`, no delay, one iteration) and turns smooth scrolling off, and the JS side (Reveal) never hides anything.

- **Reveal** (`src/components/ui/Reveal.tsx`, state machine in `src/lib/motion/reveal.ts`): fade + 12 px rise once when a block BELOW the fold enters the viewport. The server HTML has no hidden state at all (a no-JS visitor, a crawler and the LCP element see everything). After mount the block is hidden only if it starts below the fold, so what the visitor can already see never flashes; reduced motion and a missing IntersectionObserver leave it visible. `data-revealed="false|true"` and `data-step` (stagger, 0 to 6, a CSS custom property chosen by an attribute selector, never an inline style). Used on the home (Browse by category, closing band), `/how-it-works` (steps, reminder block, FAQ) and `/for-business` (setup steps, plans, "Every plan includes"); never on the hero.
- **Rows that arrive with data**: `.motion-row-in` (hero panel rows, 60 ms apart). **Soft fade**: `.motion-fade-in` (My bookings entries and chips, the confirmation cards). **Check draw**: `.motion-check` + `DrawnCheck` on checkout and pay success. A declined card never moves anything: the one `role="alert"` (`PaymentProblem`) fades in and takes focus.
- **Pointer feedback**: `.motion-press` (scale .98 on `:active`, in `buttonClasses` and the category buttons and chips), `.motion-lift` (translateY -2 px and a softer shadow on hover and keyboard focus, only under `(hover: hover)`, on place cards, result cards and time chips).
- **Chrome**: the public header gets `data-scrolled` (passive scroll listener, one rAF per burst, `isScrolled` in `src/lib/motion/scrolled.ts`) and a shadow that fades in through a pseudo-element's opacity; the phone tab bar has ONE indicator element that slides with a transform (`tabIndicator`), RTL mirrored by `rtl:-translate-x-*`; the top progress bar stays up while a route skeleton is on screen (`LoadingFlag`).
- Keyframes for `fade-in`, `sheet-in` and `dialog-in` were named in the theme but never defined, so sheets, dialogs, popovers and the category panel never animated; PR-12 defines them.

## Board → route map
| # | Board | Route | Component root |
|---|---|---|---|
| 01 | Shared public header | — | `components/public/PublicHeader.tsx` (+ `PublicFooter.tsx`, PR-7a) |
| H1 | Marketplace home (owner file `design/Home page`, Explore view) | `/` | `app/(public)/page.tsx`, `components/home/*` |
| H2 | How it works view | `/how-it-works` | `app/(public)/how-it-works/page.tsx`, `components/home/HowItWorks.tsx` |
| H3 | For business owners view | `/for-business` | `app/(public)/for-business/page.tsx`, `components/home/OwnerSections.tsx`, `PlansSection.tsx` |
| L1 | Privacy policy · Terms of use (drafts) | `/privacy` · `/terms` | `components/legal/LegalDocument.tsx` |
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
| 30 | 5.1 Pricing | `/for-business#plans` (PR-13: the `/pricing` page was removed and redirects here) | |
| 31 | 5.2 Deposit | `/pay/[token]` | |

Screens not in the boards (design them in the same language): 404 / expired-link page, empty states, the mobile More sheet,
the mobile booking summary sheet, toasts, the language toggle.

## PR-13 owner adjustments (10 Nov 2026)

- **One navy.** The `/for-business` hero (`OwnerBand`) uses the same flat `bg-navy` as the home hero (`HomeHero`): white text, turquoise primary button with navy text, outlined "Business sign in" (`onDark`), white "Today" card. Royal Blue stays for accents (links, the 4 px edge of `bg-hero`), never for a large band on the public pages.
- **One header button.** "For business owners" is the `navy` button variant on every page, also on `/for-business`. The current page is signalled with `aria-current="page"` only, never with another colour (no `aria-[current=page]:bg-*` on that button). Test: `tests/e2e/forBusinessPlans.spec.ts` compares the computed colours on `/`, `/for-business`, `/how-it-works`, `/directory`.
- **Plans.** `PlansSection` (`components/home/PlansSection.tsx`) is the only place the plans are shown. `id="plans"` is on the section wrapper, OUTSIDE any `Reveal`. Each card owns its button, pinned to the bottom (cards are flex columns of equal height): Free "Start Free" (outlined, `/signup`), Pro "Upgrade to Pro" (turquoise on the navy card, `/signup?plan=pro`). No "See all plans" and no "Every plan includes". The price is `PLAN_PRICE.PRO.amount` ($20, test mode).
- **Owner CTAs.** One constant, `OWNER_START_HREF` in `src/lib/links.ts` (= `/for-business#plans`), for the home closing band, the "List your business" line, "Be the first", the footer link, Explore and the directory. "Business sign in" stays `/login`.
- **Settings.** Business | Booking rules (with "Deposits for repeat no-shows" inside, below a divider, with its own Save button). The plan is a 44 px chip next to the page title (`PlanMenu`, portal into `TITLE_SLOT_ID`): "Free"/"Pro" + TEST MODE tag (tag moves into the menu below `sm`); it opens the `PickerSurface` popover (bottom sheet on phones) with the staff usage line and the menu items.

## Assistant page (PR-15a, `/assistant`)
Same frame as `/how-it-works`: kicker, h1 ("Book by chatting"), subtitle, three numbered step cards (22 px radius, 1.5 px divider border, mint icon tile, brand number badge), an honest requirements line, a privacy card (ShieldCheck tile) and a native `<details>` FAQ. Interactive parts only in step 1 (read-only connector URL field plus a 44 px Copy button) and step 3 (three prompt chips that copy). Announcements through a polite `role=status` region; no inline styles; Reveal for below-the-fold blocks. No `loading.tsx` on purpose: the page fetches nothing, and a loading boundary would commit HTTP 200 before `notFound()` runs while the connector is off. Footer link under Support, only when `MCP_ENABLED=true`.

## Claude entry points (PR-15b)
Everything below renders only while `MCP_ENABLED=true` (the server pages read `isAssistantEnabled()` and hand it down; the routes were already dynamic, so no page changed from static to dynamic). Copy always says "Works with Claude", Claude "normally asks" for approval, no "Beta", no directory-listing claim, no availability promise. en and ar, 360 first, logical CSS, no inline styles, 44 px targets.
- **Home strip** (`ClaudeStrip`): one slim card between the hero and "Browse by category" (22 px radius, 1.5 px divider border, mint chat tile, title, one muted line, "See how" link to `/assistant` through `PendingLink`). Server-rendered, no motion, below the hero so the above-the-fold content and the LCP element are untouched.
- **Business page button** (`ClaudeButton`): an outlined (`onDark`) pill, "Book with Claude" with a sparkles icon, in the `BusinessHero` row after the reminders pill; shown only for a LISTED business (`business.listed` from `GET /api/public/{slug}`). Opens the shared `Sheet` (bottom sheet on phones, dialog from md; focus trap, Escape, focus returns to the button): intro line, read-only prompt box (`textarea`, `dir=auto`) with a 44 px Copy button announced through a polite status region, "How to connect Claude" (to `/assistant`), "Open Claude" (`https://claude.ai`, new tab, `rel="noopener noreferrer"`, no prefill parameter) and the honest note. The prompt uses the business name through the connector's sanitizer, only inside quotes.
- **Owner card** (`ClaudeShareCard`, Booking link page, owner only like the page): "Let clients book from Claude". Listed: a ready-to-send message (read-only), Copy message, WhatsApp share (`https://wa.me/?text=`) and a QR code that opens `/assistant` (the same `QrCard` as the booking-link QR). Not listed: a quiet note and a link to the "List my business" card on the same page (`#directory`).
- **Demo chat** (`AssistantDemo` + `DemoPlayer`, on `/assistant` between the requirements line and the privacy card): a phone-width card with the "Illustration" pill, fake names (Beauty Center, Leen, Sara), six bubbles and four tool chips in eight steps. The server HTML is the finished conversation. After mount, with motion allowed, the card is armed (`data-demo="armed"`) and plays once when 30 % of it is visible (`data-demo="play"`): each `data-demo-step` fades in with an 8 px rise (`row-in` keyframes), 800 ms apart, about 6 s in all, no loop, `transform` and `opacity` only. Reduced motion or no IntersectionObserver: never armed, fully static and visible. The card is `aria-hidden`; the heading and the sentence above it say it is made up.
