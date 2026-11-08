import { BellRing, CalendarClock, Check, ChevronDown, Users, X } from 'lucide-react';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { useTranslations } from 'next-intl';
import { buttonClasses } from '@/components/ui/buttonStyles';

const STEPS = [
  { id: 'choose', Icon: Users },
  { id: 'pick', Icon: CalendarClock },
  { id: 'remind', Icon: BellRing },
] as const;
const BULLETS = ['confirm', 'cancel', 'details'] as const;
const FAQ = ['account', 'cancel', 'mine', 'taken', 'zone'] as const;

/**
 * The "How it works" page: three steps, the reminder email preview (static illustration made of the REAL email texts), what
 * the reminder lets you do, and the FAQ accordion. Anchors `#reminders` and `#faq` (the sticky header is cleared by
 * `scroll-padding-top` on `html`, plus `scroll-mt-4`).
 */
export function HowItWorks() {
  const t = useTranslations('home.how');
  const te = useTranslations('email');
  // The preview is made of the REAL reminder texts (email.h24 and email.actions), read here so they cannot drift.
  const mail = {
    heading: te('h24.heading'),
    intro: te('h24.intro', { business: t('mail.business') }),
    confirm: te('actions.confirm'),
    cancel: te('actions.cancel'),
  };
  return (
    <section aria-labelledby="how-title" className="mx-auto max-w-[1200px] px-4 pt-12 pb-16 md:px-6 md:pt-[72px] md:pb-[88px]">
      <div className="max-w-[640px]">
        <span className="mb-2.5 inline-block text-[15px] font-bold text-brand">{t('kicker')}</span>
        <h1 id="how-title" className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
          {t('title')}
        </h1>
        <p className="m-0 mt-2 text-[17px] text-muted">{t('subtitle')}</p>
      </div>

      <ol className="m-0 mt-9 grid list-none gap-4 p-0 md:grid-cols-3">
        {STEPS.map(({ id, Icon }, i) => (
          <li key={id} className="grid content-start gap-3 rounded-[22px] border-[1.5px] border-divider bg-surface p-[26px]">
            <div className="flex items-center justify-between">
              <span aria-hidden="true" className="grid size-[58px] place-items-center rounded-[18px] bg-mint/20">
                <Icon size={28} />
              </span>
              <span aria-hidden="true" className="grid size-[34px] place-items-center rounded-full bg-brand font-bold text-white">
                {i + 1}
              </span>
            </div>
            <h3 className="m-0 text-[21px] leading-tight font-semibold">
              <span className="sr-only">{t('step', { number: i + 1 })}: </span>
              {t(`steps.${id}.title`)}
            </h3>
            <p className="m-0 text-muted">{t(`steps.${id}.body`)}</p>
          </li>
        ))}
      </ol>

      <div id="reminders" className="mt-[72px] grid scroll-mt-4 items-center gap-10 lg:grid-cols-2 lg:gap-[72px]">
        <div>
          <h3 className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
            {t('reminderTitle')}
          </h3>
          <ul className="m-0 mt-5 grid list-none gap-3.5 p-0">
            {BULLETS.map((b) => (
              <li key={b} className="flex items-start gap-3 text-[17.5px]">
                <Check size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                {t(`bullets.${b}`)}
              </li>
            ))}
          </ul>
        </div>

        <div aria-hidden="true" data-testid="email-preview" className="grid gap-3.5 rounded-[22px] border-[1.5px] border-divider bg-surface p-[22px]">
          <div className="flex items-center justify-between gap-3 text-sm text-muted">
            <span className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-nav bg-brand text-white">
                <BellRing size={18} />
              </span>
              {t('mail.brand')}
            </span>
            <span className="rounded-chip bg-divider px-2.5 py-1 text-xs font-semibold">{t('mail.label')}</span>
          </div>
          <h4 className="m-0 text-[21px] leading-tight font-semibold">{mail.heading}</h4>
          <p className="m-0 text-[15.5px] text-muted">{mail.intro}</p>
          <div className="grid gap-0.5 rounded-tile border border-divider p-3.5 text-[15.5px]">
            <b className="font-semibold">{t('mail.business')}</b>
            <span className="text-muted">{t('mail.service')}</span>
            <span className="text-muted">{t('mail.when')}</span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <span className={buttonClasses({ variant: 'navy', size: 'hero', className: 'flex-1 basis-[140px]' })}>
              <Check size={18} /> {mail.confirm}
            </span>
            <span className={buttonClasses({ variant: 'secondary', size: 'hero', className: 'flex-1 basis-[140px]' })}>
              <X size={18} /> {mail.cancel}
            </span>
          </div>
        </div>
      </div>

      <div id="faq" className="mt-16 max-w-[760px] scroll-mt-4">
        <h3 className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
          {t('faqTitle')}
        </h3>
        <div className="mt-4" data-testid="faq">
          {FAQ.map((id) => (
            <details key={id} className="group border-b border-line">
              <summary className="flex min-h-[58px] cursor-pointer list-none items-center justify-between gap-3 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                {t(`faq.${id}.q`)}
                <ChevronDown
                  size={22}
                  aria-hidden="true"
                  className="shrink-0 text-brand transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="m-0 max-w-[60ch] pb-[18px] text-muted">{t(`faq.${id}.a`)}</p>
            </details>
          ))}
        </div>
        <Link href="/directory" className={buttonClasses({ variant: 'secondary', size: 'hero', className: 'mt-6' })}>
          {t('explore')}
        </Link>
      </div>
    </section>
  );
}
