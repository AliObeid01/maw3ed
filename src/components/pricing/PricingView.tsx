import { Check } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Chip } from '@/components/ui/Chip';
import { BOOKABLE_STAFF_LIMIT, PLAN_PRICE } from '@/server/domain/plan';

const FREE_FEATURES = ['staff', 'page', 'email', 'whatsapp', 'waitlist'] as const;
const PRO_FEATURES = ['everything', 'staff'] as const;

function Feature({ children }: { children: string }) {
  return (
    <li className="flex gap-2.5">
      <Check
        size={20}
        strokeWidth={2.5}
        aria-hidden="true"
        className="mt-px shrink-0 text-success"
      />
      <span>{children}</span>
    </li>
  );
}

/** Board 5.1: Free vs Pro. Lists only what the app really enforces; the price is a test-mode placeholder. */
export function PricingView() {
  const t = useTranslations('pricing');
  const freeLimit = BOOKABLE_STAFF_LIMIT.FREE ?? 1;
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-hero px-4 pt-10 pb-20 text-white md:px-8 md:pt-14 md:pb-24">
        <div className="mx-auto flex max-w-[1000px] flex-col items-center gap-3.5 text-center">
          <h1 className="m-0 text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] md:text-[48px]">
            {t('title')}
          </h1>
          <p className="m-0 max-w-[620px] text-base leading-normal text-hero-muted md:text-lg">
            {t('subtitle')}
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-12 flex w-full max-w-[1000px] flex-1 flex-col gap-8 px-4 pb-12 md:px-8 md:pb-16">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <section
            aria-labelledby="plan-free"
            className="flex flex-col gap-[18px] rounded-card border border-line bg-surface p-6 md:p-7"
          >
            <div className="flex flex-col gap-1">
              <h2 id="plan-free" className="m-0 text-2xl font-semibold">
                {t('free.name')}
              </h2>
              <span className="text-[15px] text-muted">{t('free.tagline')}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span dir="ltr" className="text-[44px] leading-none font-semibold">
                {t('free.price')}
              </span>
              <span className="text-[15px] text-muted">{t('perMonth')}</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px]">
              {FREE_FEATURES.map((key) => (
                <Feature key={key}>{t(`free.features.${key}`, { count: freeLimit })}</Feature>
              ))}
            </ul>
            <Link
              href="/signup"
              className={buttonClasses({
                variant: 'secondary',
                size: 'lg',
                block: true,
                className: 'mt-auto',
              })}
            >
              {t('free.cta')}
            </Link>
          </section>

          <section
            aria-labelledby="plan-pro"
            className="flex flex-col gap-[18px] rounded-card border-2 border-brand bg-surface p-[23px] shadow-[0_1px_2px_rgb(0_0_0/0.08),0_3px_8px_rgb(0_0_0/0.08)] md:p-[27px]"
          >
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 id="plan-pro" className="m-0 text-2xl font-semibold">
                  {t('pro.name')}
                </h2>
                <Chip tone="amber">{t('popular')}</Chip>
              </div>
              <span className="text-[15px] text-muted">{t('pro.tagline')}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span dir="ltr" className="text-[44px] leading-none font-semibold">
                {t('pro.price', { amount: PLAN_PRICE.PRO.amount })}
              </span>
              <span className="text-[15px] text-muted">{t('perMonth')}</span>
              <Chip tone="warning">{t('testBadge')}</Chip>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px]">
              {PRO_FEATURES.map((key) => (
                <Feature key={key}>{t(`pro.features.${key}`)}</Feature>
              ))}
            </ul>
            <Link
              href="/app/settings"
              className={buttonClasses({
                variant: 'accent',
                size: 'lg',
                block: true,
                className: 'mt-auto',
              })}
            >
              {t('pro.cta')}
            </Link>
            <p className="m-0 text-center text-[13px] text-muted">{t('testNote')}</p>
          </section>
        </div>
      </main>
    </div>
  );
}
