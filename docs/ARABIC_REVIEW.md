# Arabic review notes

`messages/ar.json` is a machine-assisted draft, tidied in P3.7 (FR-28). A native speaker (ideally from Lebanon) should
review the strings below. Keys and meanings were not changed.

## Conventions applied

- Modern Standard Arabic, polite, short. Tanween fatha is written `ً` before the alef everywhere (غدًا, مرحبًا), never `اً`.
- appointment = موعد, booking = حجز, waitlist = قائمة الانتظار, client = عميل, staff = موظف / الفريق, reminder = تذكير,
  no-show = لم يحضر / غياب, late cancellation = إلغاء متأخر.
- The business is "النشاط" in the dashboard and "المنشأة" on client-facing pages (booking, link, waitlist, offer).
- Latin digits for times, prices and phones (kept copyable); phones and emails are isolated with `bdi`/`dir="ltr"`.
- The product name is written موعد in running Arabic text.

## Strings to confirm

| Key | English | Arabic now | Why unsure |
| --- | --- | --- | --- |
| `app.hours.whose` | Whose hours | ساعات من | Reads oddly as a label for a staff picker. Alternative: "ساعات عمل" or "اختر الموظف". |
| `app.settings.plan.cta` | See Pro | عرض خطة Pro | Brand/plan name left in Latin. |
| `app.today.stats.refilled` | Refilled from waitlist | أُعيد ملؤها من قائمة الانتظار | Needs to fit a small stat tile; may need shortening. |
| `app.pilot.hero.counts` | no-shows of N held or missed | غياب من N موعدًا تم أو فات | "تم أو فات" (held or missed) is a calque; check it reads naturally to owners. |
| `app.pilot.*` (pilot report) | Pilot report | تقرير التجربة | "تجربة" for pilot; confirm vs "التجربة الأولية". |
| `app.clientHistory.deleteBody` | anonymises the client ... removed from Maw3ed | سيُجهَّل هذا العميل ... من منصة موعد | "يُجهَّل" (anonymise) is rare. Alternative: "تُحذف بياناته الشخصية". Legal wording matters here. |
| `booking.details.reminderNote` | Each reminder has one-tap Confirm and Cancel links. | في كل تذكير رابطان للتأكيد أو الإلغاء بنقرة واحدة. | Dual form; confirm it is not stiff. |
| `booking.details.consent` | Email and WhatsApp reminders; no account needed. | تذكيرات عبر البريد الإلكتروني وواتساب؛ لا حاجة لحساب. | Semicolon style. |
| `booking.time.timezoneNote` | Times are shown in {zone} time (UTC{offset}) ... | الأوقات بتوقيت {zone} (UTC{offset}) ... | `UTC+3` inside RTL text may reorder; verify on a device. |
| `link.cancelDialog.late` | ...{name} may charge a fee | ...وقد يفرض {name} رسومًا | Business-name placement when the name is Latin. |
| `link.confirmedScreen.body` | {name} will see you on {when}. | شكرًا! سيراك {name} يوم {when}. | "سيراك" is literal; alternative "بانتظارك {name} يوم {when}". |
| `waitlist.how.s3Title`, `offer.firstToClaim` | First to claim gets it | الأسرع في الحجز يحصل عليه | Idiom; fine but check tone. |
| `offer.minutesLeft` | N minutes left | plural forms zero..other | `many` (11-99) falls to `other`, which is correct, but check "دقيقة متبقية". |
| `app.remindersDue.someone` | A colleague | زميل | Gender-neutral alternative may be needed ("زميل/ة"). |
| `app.frame.role.STAFF` | Staff | موظف | Used for receptionist role; masculine default. |
| `app.nav.main` | Main | الرئيسية | Could be confused with "home". |
| `email.*` (all) | booking confirmation, 24 h / 2 h reminders, offer, invite | see file | Dates use the ICU Arabic month names (نوفمبر, أكتوبر). Lebanese users often say تشرين الثاني / تشرين الأول; decide which to prefer. |
| `email.invite.*` | invite email (new in P3.7) | دعوة للانضمام إلى {business} على موعد | New strings, never reviewed by a native speaker. |
| `email.whatsapp.h24/h2` | prefilled WhatsApp text | see file | Register is polite-neutral rather than Lebanese dialect; confirm it feels natural for a WhatsApp message from a salon. |
| `common.tagline` | Fewer no-shows. More time. | غياب أقل. وقت أكثر. | Marketing copy; "غياب" vs "عدم حضور". |
| `link.confirmedScreen.body` | {name} will see you on {when}. | شكرًا! سيراك {name} يوم {when}. | Calque of the English; a native phrasing is needed. |
| `app.pilot.hero.counts` | ... held or missed | ... تم أو فات | "تم أو فات" is a calque of "held or missed". |
| `app.clientHistory.deleteBody` | anonymises the client | سيُجهَّل هذا العميل | "يُجهَّل" is unusual; legal wording needs a native/legal check. |
| terminology: phone | mobile number | الجوال (and one dev string) | Lebanese users usually say "موبايل" or "رقم الهاتف"; decide الجوال vs الموبايل across booking, waitlist and dashboard. |
| `app.frontDesk.client.returningSummary`, `app.pilot.hero.lower/higher` | plural on count | full Arabic plural forms | Added in review; check the dual and few/many forms read naturally. |
| `pricing.*`, `billing.*` (plan names) | Free / Pro | مجاني / Pro | "Pro" kept in Latin; confirm owners prefer it over "احترافي". Free is the masculine adjective "مجاني" as a plan name, but "الخطة المجانية" in sentences. |
| `pricing.testNote`, `billing.testModeNote`, `*.testBadge` | TEST MODE / checkout is simulated | وضع تجريبي / عملية الدفع محاكاة | Test-mode wording: "تجريبي" vs "اختباري"; "محاكاة" may be too technical for owners. |
| `pricing.free.features.staff`, `billing.staffLimit`, `billing.downgradeBlocked` | one bookable staff member | موظف واحد قابل للحجز | Plural added on count (dual and few/many forms); confirm phrasing matches the Staff screen. |
| `pricing.title` | Simple plans for every chair | خطط بسيطة لكل كرسي | "كرسي" for a chair/seat is a literal image; check it suits clinics too. |
| `billing.price`, `pricing.pro.price` | $9 / month | $9 / شهريًا | Price is isolated left-to-right so the currency sign stays before the number; check the sign placement preference for Arabic. |
| `offer.holdLapsed.title/body` | Your deposit time ran out / The slot was released for other people. You are still on the waitlist and we will email you if another time opens. | انتهت مهلة دفع العربون / تم إطلاق الموعد لغيرك. ما زلت في قائمة الانتظار وسنراسلك بالبريد إذا توفر وقت آخر. | Unreviewed (F26-3). "العربون" for deposit and "مهلة" for the time limit; check they match the deposit/pay page wording. |
| `verify.*`, `email.verify.*`, `app.errors.emailNotVerified` | Confirm your email / Resend email / Confirm your email address to invite staff. | أكّد بريدك الإلكتروني / إعادة إرسال الرسالة / أكّد بريدك الإلكتروني لدعوة الموظفين. | Unreviewed (L4). "أكّد" vs "تأكيد" in headings, "الرسالة" for the email, and the guillemets around the button name inside a sentence. |
| `recovery.*`, `email.reset.*`, `app.settings.account.*` | Forgot your password? / Choose a new password / Change password | نسيت كلمة المرور؟ / اختيار كلمة مرور جديدة / تغيير كلمة المرور | Unreviewed (A1). "إعادة التعيين" for reset and "تسجيل الخروج من كل الأجهزة" in the reset subtitle; check the generic "if an account exists" sentence reads naturally. |
| `team.*`, `app.settings.account.others.*` | Team access / Remove access / They will be signed out immediately and can no longer open the dashboard... / Sign out other devices | صلاحيات الفريق / إزالة الصلاحية / سيتم تسجيل خروجه فورًا ولن يتمكن من فتح لوحة التحكم بعد الآن... / تسجيل الخروج من الأجهزة الأخرى | Unreviewed (A2). Masculine "خروجه" is used for a generic member (check a neutral phrasing); "النشاط" for business; "صلاحيات/صلاحية" for access; plural forms of the summary and the "N devices" message (dual, few, many); "تراجع" for Cancel in the sheet vs "إلغاء" for Revoke. |
| `team.confirmRemove.body`, `team.remainingNote` | ...They will also be hidden from your booking page... / N upcoming appointments remain on their calendar | ...كما سيُخفى من صفحة الحجز... / يبقى N موعد قادم في تقويمه | Unreviewed (A2 review). Masculine pronouns for a generic member; plural forms of the appointment count; "التقويم" and "قسم الموظفين" must match the Staff screen wording. |

## Not covered

- `/directory` and the marketing home page do not exist as routes yet; they have no Arabic copy to review.
