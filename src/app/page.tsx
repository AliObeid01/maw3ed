import { BellRing, CalendarCheck, TrendingDown } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { HeroPreview } from '@/components/public/HeroPreview';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home');
  return { title: t('pageTitle'), description: t('subtitle') };
}

const STEPS = [
  { id: 'book', Icon: CalendarCheck },
  { id: 'remind', Icon: BellRing },
  { id: 'drop', Icon: TrendingDown },
] as const;

/** Public home: the value line, how it works in three steps, and the three ways in. */
export default async function Home() {
  const t = await getTranslations('home');
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-10 px-4 py-6 md:gap-14 md:px-8 md:py-10">
        <section className="flex flex-col gap-6 rounded-[28px] bg-hero p-6 text-white md:p-12 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16">
          <div className="flex flex-col gap-6">
          <div className="flex max-w-2xl flex-col gap-3">
            <h1 className="m-0 text-[32px] leading-[1.15] font-semibold tracking-[-0.015em] md:text-5xl">
              {t('title')}
            </h1>
            <p className="m-0 text-base text-hero-ink md:text-lg">{t('subtitle')}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/directory" variant="accent" size="lg">
              {t('findBusiness')}
            </ButtonLink>
            <ButtonLink
              href="/signup"
              variant="ghost"
              size="lg"
              className="border border-white/35 font-medium text-white hover:bg-white/10"
            >
              {t('setUp')}
            </ButtonLink>
          </div>
          <p className="m-0 text-sm text-hero-muted">
            {t('haveAccount')}{' '}
            <Link
              href="/login"
              className="inline-flex min-h-11 min-w-11 items-center justify-center font-semibold text-white underline"
            >
              {t('signIn')}
            </Link>
          </p>
          </div>
          <HeroPreview />
        </section>

        <section aria-labelledby="how-title" className="flex flex-col gap-5">
          <h2 id="how-title" className="m-0 text-2xl font-semibold md:text-3xl">
            {t('how.title')}
          </h2>
          <ol className="m-0 grid list-none gap-3.5 p-0 md:grid-cols-3">
            {STEPS.map(({ id, Icon }, index) => (
              <Card as="li" key={id} size="sm" className="flex flex-col gap-3">
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-12 items-center justify-center rounded-input bg-brand-soft text-brand"
                  >
                    <Icon size={24} />
                  </span>
                  <span className="text-sm font-semibold text-muted">
                    {t('how.step', { number: index + 1 })}
                  </span>
                </span>
                <h3 className="m-0 text-[19px] font-semibold">{t(`how.${id}.title`)}</h3>
                <p className="m-0 text-[15px] leading-[1.5] text-muted">{t(`how.${id}.body`)}</p>
              </Card>
            ))}
          </ol>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
