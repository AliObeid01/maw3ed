import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { Reveal } from '@/components/ui/Reveal';

/** The navy closing band of the home page (owner design): a short pitch to business owners with the two actions. */
export function FinalCta() {
  const t = useTranslations('home.final');
  return (
    <section data-surface="dark" aria-labelledby="final-cta-title" className="mt-16 bg-navy text-white md:mt-[88px]">
      <Reveal className="mx-auto grid max-w-[1200px] items-center gap-6 px-4 py-14 md:px-6 lg:grid-cols-[1fr_auto] lg:gap-16 lg:py-[72px]">
        <div>
          <h2
            id="final-cta-title"
            className="m-0 max-w-[20ch] text-[clamp(28px,5vw,42px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:max-w-[26ch] rtl:leading-[1.3] rtl:tracking-normal"
          >
            {t('title')}
          </h2>
          <p className="m-0 mt-3 max-w-[48ch] text-[17px] text-hero-muted">{t('body')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={buttonClasses({ variant: 'turquoise', size: 'hero', className: 'h-auto min-h-12 max-w-full min-w-0 shrink py-2 text-center whitespace-normal' })}>
            {t('cta')}
            <ArrowRight size={20} aria-hidden="true" className="rtl:-scale-x-100" />
          </Link>
          <Link href="/login" className={buttonClasses({ variant: 'onDark', size: 'hero' })}>
            {t('signIn')}
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
