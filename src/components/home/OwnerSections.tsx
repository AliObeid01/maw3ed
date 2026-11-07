import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { cn } from '@/lib/cn';

const ROWS = [
  { id: 'one', time: '09:00', tone: 'success' },
  { id: 'two', time: '10:30', tone: 'neutral' },
  { id: 'three', time: '12:00', tone: 'danger' },
] as const;
const STEPS = ['profile', 'services', 'staff', 'hours', 'publish'] as const;

const statusTone = {
  success: 'bg-turquoise text-ink',
  neutral: 'bg-divider text-ink',
  danger: 'bg-danger-soft text-danger',
} as const;

/** The dark "for business owners" band with a decorative phone of the owner's Today (fake names only). */
export function OwnerBand() {
  const t = useTranslations('home.owners');
  return (
    <section data-surface="dark" aria-labelledby="owners-title" className="mt-16 bg-brand text-white md:mt-[88px]">
      <div className="mx-auto grid max-w-[1200px] items-center gap-8 px-4 py-14 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:py-[72px]">
        <div>
          <h2 id="owners-title" className="m-0 max-w-[17ch] text-[clamp(32px,6vw,52px)] leading-[1.08] font-bold tracking-[-0.025em] rtl:max-w-[20ch] rtl:leading-[1.25] rtl:tracking-normal">
            {t('title')}
          </h2>
          <p className="m-0 mt-3.5 max-w-[46ch] text-lg text-brand-soft">{t('body')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClasses({ variant: 'turquoise', size: 'hero' })}>
              {t('cta')}
              <ArrowRight size={20} aria-hidden="true" className="rtl:-scale-x-100" />
            </Link>
            <Link href="/login" className={buttonClasses({ variant: 'onDark', size: 'hero' })}>
              {t('signIn')}
            </Link>
          </div>
        </div>

        <div aria-hidden="true" data-testid="owner-phone" className="rounded-[20px] bg-surface p-[18px] text-ink">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="m-0 text-lg font-semibold">{t('phone.title')}</h3>
            <span className="rounded-chip bg-divider px-2.5 py-1 text-xs font-semibold text-muted">{t('phone.example')}</span>
          </div>
          {ROWS.map((r) => (
            <div key={r.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 border-t border-divider py-3 first-of-type:border-t-0">
              <span dir="ltr" className="font-bold tabular-nums">{r.time}</span>
              <span className="min-w-0">
                <b className="block font-semibold">{t(`phone.rows.${r.id}.name`)}</b>
                <small className="block text-muted">{t(`phone.rows.${r.id}.detail`)}</small>
              </span>
              <span className={cn('rounded-chip px-2.5 py-1 text-xs font-semibold', statusTone[r.tone])}>
                {t(`phone.rows.${r.id}.status`)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "Set up in five steps": only what the product really asks an owner to do. */
export function SetupSteps() {
  const t = useTranslations('home.owners');
  return (
    <section aria-labelledby="setup-title" className="mx-auto max-w-[1200px] px-4 pt-16 md:px-6 md:pt-[88px]">
      <div className="grid gap-7 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <h2 id="setup-title" className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
            {t('setupTitle')}
          </h2>
          <p className="m-0 mt-2 text-[17px] text-muted">{t('setupSubtitle')}</p>
        </div>
        <ol className="m-0 grid list-none gap-3 p-0">
          {STEPS.map((id, i) => (
            <li key={id} className="flex items-center gap-3.5 rounded-[16px] border-[1.5px] border-divider bg-surface px-4 py-3.5 font-semibold">
              <span aria-hidden="true" className="grid size-[34px] shrink-0 place-items-center rounded-full bg-navy text-white">
                {i + 1}
              </span>
              <span>
                {t(`setup.${id}.title`)}
                <small className="block font-normal text-muted">{t(`setup.${id}.body`)}</small>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
