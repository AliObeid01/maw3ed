import { ArrowUp, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/brand/Logo';
import { FooterMyBookingsLink } from '@/components/myBookings/FooterMyBookingsLink';
import { AREA_KEYS } from '@/lib/business/profile';
import { HOME_CATEGORIES } from '@/lib/home/categories';
import { OWNER_START_HREF } from '@/lib/links';
import { contactHref, COPYRIGHT_YEAR, SITE, socialLinks, type SocialId } from '@/lib/site';
import { LanguageToggle } from './LanguageToggle';
import { PendingLink as Link } from './PendingLink';

const AREAS = AREA_KEYS.filter((k) => k !== 'other');

const linkClass =
  'inline-flex min-h-11 items-center text-[15px] text-hero-muted no-underline transition-colors duration-200 ease-out hover:text-white hover:underline aria-busy:opacity-60';

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8.5A.5.5 0 0 1 14 8Z" />
    </svg>
  );
}
const SOCIAL_ICON: Record<SocialId, () => React.ReactNode> = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  whatsapp: () => <MessageCircle size={20} aria-hidden="true" />,
};

/** The marketplace footer (owner design): brand and contact, four link columns, legal line. Server-rendered. */
export function PublicFooter() {
  const t = useTranslations();
  const social = socialLinks();

  return (
    <footer
      data-surface="dark"
      // On phones the fixed bars (summary bar, tab bar) would cover the last lines: leave room for them.
      className="bg-navy text-hero-muted max-lg:[body:has(.public-tabbar)_&]:pb-[calc(4.5rem+env(safe-area-inset-bottom))] max-lg:[body:has(.sticky-summary-bar)_&]:pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto max-w-[1200px] px-4 md:px-6">
        <div className="grid grid-cols-2 gap-x-7 gap-y-9 py-12 md:grid-cols-3 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="col-span-full lg:col-auto">
            <Link href="/" className="inline-flex min-h-11 items-center">
              <Logo label={t('public.header.home')} width={132} tone="white" />
            </Link>
            <p className="mt-3.5 mb-0 max-w-[36ch] text-[15px] leading-normal">{t('public.footer.blurb')}</p>
            <ul aria-label={t('public.footer.contactLabel')} className="mt-4 mb-0 grid list-none gap-1 p-0 text-[15px]">
              <li>
                <a href={contactHref()} className="inline-flex min-h-11 items-center gap-2.5 text-hero-muted no-underline hover:text-white">
                  <Mail size={18} aria-hidden="true" className="text-hero-accent" />
                  <span dir="ltr">{SITE.email}</span>
                </a>
              </li>
              <li className="inline-flex min-h-9 items-center gap-2.5">
                <Phone size={18} aria-hidden="true" className="text-hero-accent" />
                <span dir="ltr">{SITE.phone}</span>
              </li>
              <li className="inline-flex min-h-9 items-center gap-2.5">
                <MapPin size={18} aria-hidden="true" className="text-hero-accent" />
                <bdi>{SITE.address}</bdi>
              </li>
            </ul>
            {social.length > 0 ? (
              <ul aria-label={t('public.footer.socialLabel')} className="mt-3.5 mb-0 flex list-none gap-2.5 p-0">
                {social.map(({ id, url }) => {
                  const Icon = SOCIAL_ICON[id];
                  return (
                    <li key={id}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t(`public.footer.social.${id}`)}
                        className="grid size-11 place-items-center rounded-btn bg-white/10 text-hero-ink transition-colors duration-200 ease-out hover:bg-turquoise hover:text-ink"
                      >
                        <Icon />
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <nav aria-labelledby="footer-categories">
            <h2 id="footer-categories" className="m-0 mb-2 text-base font-semibold text-white">
              {t('public.footer.categories')}
            </h2>
            <ul className="m-0 list-none p-0">
              {HOME_CATEGORIES.map((key) => (
                <li key={key}>
                  <Link href={`/directory?category=${key}`} className={linkClass}>
                    {t(`home.categories.names.${key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-labelledby="footer-areas">
            <h2 id="footer-areas" className="m-0 mb-2 text-base font-semibold text-white">
              {t('public.footer.areas')}
            </h2>
            <ul className="m-0 list-none p-0">
              {AREAS.map((key) => (
                <li key={key}>
                  <Link href={`/directory?area=${key}`} className={linkClass}>
                    {t(`public.area.${key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-labelledby="footer-owners">
            <h2 id="footer-owners" className="m-0 mb-2 text-base font-semibold text-white">
              {t('public.footer.owners')}
            </h2>
            <ul className="m-0 list-none p-0">
              <li><Link href="/for-business" className={linkClass}>{t('public.footer.ownersPage')}</Link></li>
              <li><Link href={OWNER_START_HREF} className={linkClass}>{t('public.footer.putOnMaw3ed')}</Link></li>
              <li><Link href="/login" className={linkClass}>{t('public.footer.businessSignIn')}</Link></li>
              <li><Link href="/how-it-works#reminders" className={linkClass}>{t('public.footer.reminders')}</Link></li>
            </ul>
          </nav>
          <nav aria-labelledby="footer-support">
            <h2 id="footer-support" className="m-0 mb-2 text-base font-semibold text-white">
              {t('public.footer.support')}
            </h2>
            <ul className="m-0 list-none p-0">
              <li><Link href="/how-it-works" className={linkClass}>{t('public.footer.howItWorks')}</Link></li>
              <li><a href={contactHref()} className={linkClass}>{t('public.footer.contactUs')}</a></li>
              <FooterMyBookingsLink className={linkClass} />
            </ul>
          </nav>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/15 pt-5 pb-7 text-sm text-hero-subtle">
          <span>{t('public.footer.rights', { year: COPYRIGHT_YEAR })}</span>
          <nav aria-label={t('public.footer.legalNav')} className="flex flex-wrap items-center gap-x-4">
            <LanguageToggle className="border-white/30 bg-transparent text-white hover:bg-white/10" />
            <Link href="/privacy" className="inline-flex min-h-11 items-center font-medium text-white no-underline hover:underline">
              {t('public.footer.privacy')}
            </Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center font-medium text-white no-underline hover:underline">
              {t('public.footer.terms')}
            </Link>
            <a href="#top" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-white no-underline hover:underline">
              {t('public.footer.top')}
              <ArrowUp size={18} aria-hidden="true" />
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
