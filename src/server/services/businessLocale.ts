import { cache } from 'react';
import { appointmentRepo } from '@/server/repositories/appointment.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { waitlistRepo } from '@/server/repositories/waitlist.repo';
import { resolveBusinessLocale, type BusinessLocaleDeps } from '@/server/i18n/businessLocale';

/** The repository-backed lookups the locale resolver needs. Overridable so tests need no database. */
export type BusinessLocaleLookups = Pick<
  BusinessLocaleDeps,
  'localeBySlug' | 'localeByAppointment' | 'localeByOffer'
>;

const repoLookups: BusinessLocaleLookups = {
  localeBySlug: async (slug) => (await publicBusinessRepo.findBySlug(slug))?.locale ?? null,
  localeByAppointment: async (id) => {
    const businessId = await appointmentRepo.businessIdOf(id);
    return businessId ? ((await publicBusinessRepo.findById(businessId))?.locale ?? null) : null;
  },
  localeByOffer: async (id) => {
    const businessId = await waitlistRepo.businessIdOfOffer(id);
    return businessId ? ((await publicBusinessRepo.findById(businessId))?.locale ?? null) : null;
  },
};

/** Builds the resolver; `memoise` is React `cache` in production and a plain function in tests. */
export function createBusinessLocaleService(
  lookups: BusinessLocaleLookups,
  memoise: <F extends (pathname: string | null | undefined) => Promise<string | undefined>>(fn: F) => F,
  env: { now: () => Date; secret: () => string | undefined } = {
    now: () => new Date(),
    secret: () => process.env.LINK_SECRET,
  },
) {
  return {
    /**
     * The default language of the business behind a public page path (`/b/<slug>`, `/l/<token>`,
     * `/o/<token>`), or undefined. Memoised per argument, so within one request every caller shares a
     * single lookup.
     */
    forPath: memoise((pathname: string | null | undefined) =>
      resolveBusinessLocale(pathname, { ...env, ...lookups }),
    ),
  };
}

// React `cache` memoises per server request (it is a no-op outside a render and never leaks across requests).
export const businessLocaleService = createBusinessLocaleService(repoLookups, cache);
