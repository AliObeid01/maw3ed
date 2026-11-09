import { Check } from 'lucide-react';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { useTranslations } from 'next-intl';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Chip } from '@/components/ui/Chip';
import { Reveal } from '@/components/ui/Reveal';
import { FREE_FEATURES, PRO_FEATURES } from '@/components/pricing/planCopy';
import { FREE_START_HREF, PRO_START_HREF } from '@/lib/links';
import { BOOKABLE_STAFF_LIMIT, PLAN_PRICE } from '@/server/domain/plan';

function Feature({ children, dark }: { children: string; dark?: boolean }) {
  return (
    <li className="flex items-start gap-2.5 text-base">
      <Check size={20} strokeWidth={2.5} aria-hidden="true" className={dark ? 'mt-0.5 shrink-0 text-hero-accent' : 'mt-0.5 shrink-0 text-success'} />
      <span>{children}</span>
    </li>
  );
}

/**
 * The real plans, Free and Pro (`pricing.*` messages, `PLAN_PRICE`): the ONE plans component, the only place plans are
 * shown (the old /pricing page redirects here). `id="plans"` sits on this wrapper, OUTSIDE any Reveal, so a link to
 * `/for-business#plans` always finds a visible target. Each card carries its own call to action, pinned to the bottom.
 */
export function PlansSection() {
  const t = useTranslations();
  const freeLimit = BOOKABLE_STAFF_LIMIT.FREE ?? 1;
  return (
    <section id="plans" aria-labelledby="teaser-title" className="mt-16 bg-divider py-16 md:mt-[88px] md:py-[88px]">
      <div className="mx-auto max-w-[1200px] px-4 md:px-6">
        <div className="max-w-[640px]">
          <span className="mb-2.5 inline-block text-[15px] font-bold text-brand">{t('home.pricing.kicker')}</span>
          <h2 id="teaser-title" className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
            {t('home.pricing.title')}
          </h2>
          <p className="m-0 mt-2 text-[17px] text-muted">{t('home.pricing.subtitle')}</p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Reveal className="grid">
          <article aria-labelledby="teaser-free" className="flex flex-col gap-[18px] rounded-[24px] bg-surface p-7">
            <div>
              <h3 id="teaser-free" className="m-0 text-[22px] font-bold">{t('pricing.free.name')}</h3>
              <p className="m-0 mt-1 text-muted">{t('pricing.free.tagline')}</p>
            </div>
            <div className="flex items-baseline gap-2">
              <b dir="ltr" className="text-[54px] leading-none font-bold tracking-[-0.03em]">{t('pricing.free.price')}</b>
              <span className="font-medium text-muted">{t('pricing.perMonth')}</span>
            </div>
            <ul className="m-0 grid list-none gap-3 border-t border-divider p-0 pt-[18px]">
              {FREE_FEATURES.map((k) => (
                <Feature key={k}>{t(`pricing.free.features.${k}`, { count: freeLimit })}</Feature>
              ))}
            </ul>
            <Link href={FREE_START_HREF} data-testid="plan-cta-free" className={buttonClasses({ variant: 'secondary', size: 'hero', block: true, className: 'mt-auto' })}>
              {t('pricing.free.cta')}
            </Link>
          </article>
          </Reveal>

          <Reveal step={1} className="grid">
          <article aria-labelledby="teaser-pro" className="flex flex-col gap-[18px] rounded-[24px] bg-navy p-7 text-white">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <h3 id="teaser-pro" className="m-0 text-[22px] font-bold">{t('pricing.pro.name')}</h3>
                <Chip tone="refill" className="px-3 py-1.5 text-[13px]">{t('pricing.popular')}</Chip>
              </div>
              <p className="m-0 mt-1 text-hero-muted">{t('pricing.pro.tagline')}</p>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <b dir="ltr" className="text-[54px] leading-none font-bold tracking-[-0.03em]">
                {t('pricing.pro.price', { amount: PLAN_PRICE.PRO.amount })}
              </b>
              <span className="font-medium text-hero-muted">{t('pricing.perMonth')}</span>
              <Chip tone="warning">{t('pricing.testBadge')}</Chip>
            </div>
            <ul className="m-0 grid list-none gap-3 border-t border-white/15 p-0 pt-[18px]">
              {PRO_FEATURES.map((k) => (
                <Feature key={k} dark>{t(`pricing.pro.features.${k}`)}</Feature>
              ))}
            </ul>
            <p className="m-0 text-[13px] text-hero-muted">{t('pricing.testNote')}</p>
            <Link href={PRO_START_HREF} data-testid="plan-cta-pro" className={buttonClasses({ variant: 'turquoise', size: 'hero', block: true, className: 'mt-auto' })}>
              {t('pricing.pro.cta')}
            </Link>
          </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
