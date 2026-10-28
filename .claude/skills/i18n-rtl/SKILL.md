---
name: i18n-rtl
description: Use whenever adding user-facing text, dates, times, prices, emails or WhatsApp messages to Maw3ed, and when building or fixing Arabic right-to-left layouts. Covers next-intl message files, formatting in the business timezone, logical CSS, icon mirroring and Arabic templates.
---

# Maw3ed i18n and RTL

Locales: `en` (default) and `ar`. Files: `messages/en.json`, `messages/ar.json`. No locale prefix in URLs.
- Public pages (`/b`, `/l`, `/o`, `/pay`): `?lang=` → cookie → `Business.locale` → `en`.
- Dashboard: user cookie → `Business.locale` → `en`.
- Emails and WhatsApp messages: `Business.locale` (per business, as the PRD specifies).

## Adding strings
1. Add the key to **both** files in the same change, namespaced by screen: `booking.details.title`, `app.reminders.send`.
   Draft Arabic is fine before Phase 3; never leave a key missing (CI runs `scripts/i18n/check-keys.mjs`, which fails on missing or extra keys).
2. Use ICU for plurals and variables: `"noShowBadge": "{count, plural, one {# no-show} other {# no-shows}}"`.
   Arabic needs the `zero, one, two, few, many, other` forms.
3. In components: `const t = useTranslations('booking.details')` (client) or `getTranslations` (server). No literal JSX text:
   ESLint `i18next/no-literal-string` fails the build.
4. Server-side copy (emails, WhatsApp text, error messages shown to users) also goes through message files,
   via `getTranslator(locale)` in the service/provider layer.

## Formatting
- Dates and times: `useFormatter().dateTime(date, { timeZone: business.timezone, ... })`. Always pass the **business timezone**.
- Prices: `format.number(price, { style: 'currency', currency: business.currency ?? 'USD' })`.
- Use Latin digits in Arabic for times and phone numbers (`numberingSystem: 'latn'`); clients and staff in Lebanon read both, and phones must stay copyable.
- Phones are displayed with `libphonenumber-js` `formatInternational()` and wrapped in `<bdi dir="ltr">` inside Arabic text.

## RTL layout
- `<html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>` in the root layout.
- Only logical utilities: `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/rounded-s`. Never `ml/mr/pl/pr/left/right/text-left`.
- Directional icons (chevrons, arrows, back) get `rtl:-scale-x-100`. Don't mirror clocks, checkmarks or brand logos.
- Fonts: Outfit for Latin; IBM Plex Sans Arabic via `next/font/google` as `--font-arabic`; `:root[dir=rtl] { font-family: var(--font-arabic), var(--font-sans) }`.
- Watch for clipped Arabic: no fixed heights on text containers; line-height ≥ 1.5 for Arabic body.
- Check every screen at 360 px in `ar` (`node scripts/design/snapshot-app.mjs --rtl`).

## Templates that clients see (highest priority to translate well)
- WhatsApp prefilled message (`reminders.whatsapp.h24|h2`): greeting with the client's name, business name, day/time in the
  business timezone, service, staff, then the confirm and cancel links on their own lines. Keep it under 600 characters.
  Built server-side and URL-encoded into `https://wa.me/<E164 without +>?text=`.
- Emails: booking confirmation (+ .ics), 24 h reminder, 2 h reminder, waitlist offer, staff invite. react-email components take `t`.
- The booking page (1.1–1.7) and link pages (2.1–2.3).
