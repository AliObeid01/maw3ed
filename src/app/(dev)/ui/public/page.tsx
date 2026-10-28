import { Bell } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { BookingSummary } from '@/components/public/BookingSummary';
import { BusinessHero } from '@/components/public/BusinessHero';
import { PublicHeader } from '@/components/public/PublicHeader';
import { StickySummaryBar } from '@/components/public/StickySummaryBar';
import { Callout } from '@/components/ui/Callout';
import { StepRailDemo } from '../Demos';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

/** Dev-only preview of the public booking chrome (fixtures). 404 in production. */
export default async function PublicPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const t = await getTranslations('dev.ui');
  const format = await getFormatter();

  const steps = [
    { id: 'service', label: t('step1'), value: t('fields.haircut') },
    { id: 'staff', label: t('step2'), value: 'Lina' },
    { id: 'time', label: t('step3') },
    { id: 'details', label: t('step4') },
  ];
  const price = format.number(15, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const rows = [
    {
      id: 'service',
      label: t('summaryService'),
      value: t('fields.haircut'),
      empty: t('serviceNotChosen'),
    },
    { id: 'with', label: t('summaryWith'), value: 'Lina' },
    { id: 'when', label: t('summaryWhen') },
    { id: 'price', label: t('summaryPrice'), value: price },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <BusinessHero
        name={t('businessName')}
        meta={t('heroMeta')}
        facts={[t('heroFact1'), t('heroFact2')]}
      />
      <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-wrap items-start gap-6 px-4 pt-5 pb-28 md:px-8 md:pt-7 lg:pb-10">
        <StepRailDemo steps={steps} current={3} />
        <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
          <h2 className="text-2xl font-semibold">{t('publicTitle')}</h2>
          <Card>
            <p className="text-muted">{t('heroMeta')}</p>
          </Card>
        </section>
        <aside className="hidden max-w-[290px] flex-[1_1_240px] flex-col gap-3.5 lg:flex">
          <BookingSummary rows={rows} />
          <Callout icon={<Bell />}>{t('callout')}</Callout>
        </aside>
      </main>
      <StickySummaryBar rows={rows} price={price} cta={t('continue')} />
    </div>
  );
}
