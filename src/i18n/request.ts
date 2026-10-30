import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { appointmentRepo } from '@/server/repositories/appointment.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { waitlistRepo } from '@/server/repositories/waitlist.repo';
import { resolveBusinessLocale } from '@/server/i18n/businessLocale';
import { LOCALE_COOKIE, LOCALE_HINT_COOKIE, PATH_HEADER, isLocale, pickLocale } from './config';

// No URL prefix. Order: the `locale` cookie (set by the toggle or by `?lang=` in src/proxy.ts), then the
// client hint cookie, then the business default resolved on the SERVER for /b/<slug>, /l/<token> and
// /o/<token> (so the first visit renders once, in the right language), then English.
export default getRequestConfig(async () => {
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const hint = jar.get(LOCALE_HINT_COOKIE)?.value;
  let business: string | undefined;
  if (!isLocale(stored) && !isLocale(hint)) {
    business = await resolveBusinessLocale((await headers()).get(PATH_HEADER), {
      now: () => new Date(),
      secret: () => process.env.LINK_SECRET,
      localeBySlug: async (slug) => (await publicBusinessRepo.findBySlug(slug))?.locale ?? null,
      localeByAppointment: async (id) => {
        const businessId = await appointmentRepo.businessIdOf(id);
        return businessId ? ((await publicBusinessRepo.findById(businessId))?.locale ?? null) : null;
      },
      localeByOffer: async (id) => {
        const businessId = await waitlistRepo.businessIdOfOffer(id);
        return businessId ? ((await publicBusinessRepo.findById(businessId))?.locale ?? null) : null;
      },
    });
  }
  const locale = pickLocale(stored, hint, business);
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
