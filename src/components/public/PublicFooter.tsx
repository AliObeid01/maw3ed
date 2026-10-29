import { useTranslations } from 'next-intl';

/** Footer shared by the booking and link pages. */
export function PublicFooter() {
  const t = useTranslations('booking.footer');
  return (
    <footer className="border-t border-divider">
      <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-5 text-[13px] text-muted md:px-8">
        <span>{t('brand')}</span>
        <span>{t('privacy')}</span>
      </div>
    </footer>
  );
}
