import { useTranslations } from 'next-intl';

/** Footer shared by the booking and link pages. */
export function PublicFooter() {
  const t = useTranslations('booking.footer');
  return (
    // On phones the fixed summary bar (marked `.sticky-summary-bar`) would cover the last lines: leave room for it.
    <footer className="border-t border-divider max-lg:[body:has(.sticky-summary-bar)_&]:pb-24">
      <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-5 text-[13px] text-muted md:px-8">
        <span>{t('brand')}</span>
        <span>{t('privacy')}</span>
      </div>
    </footer>
  );
}
