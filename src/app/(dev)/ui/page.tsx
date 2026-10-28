import { ChevronLeft, ChevronRight, Info, Plus } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/Logo';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip, StatusChip, statusTones, type Status } from '@/components/ui/Chip';
import { CountBadge } from '@/components/ui/CountBadge';
import { Input, Select } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatTile } from '@/components/ui/StatTile';
import { ShellDemo } from './Demos';
import { SheetDemo } from './SheetDemo';

export const dynamic = 'force-dynamic';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{title}</h2>
      {children}
    </Card>
  );
}

/** Dev-only component gallery inside the AppShell (fixture data). 404 in production. */
export default async function UiPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const t = await getTranslations('dev.ui');

  return (
    <ShellDemo
      business={{ name: t('businessName'), subtitle: t('businessRole') }}
      activeId="today"
      badges={{ reminders: 4, outcomes: 2 }}
      eyebrow={t('date')}
      title={t('greeting', { name: 'Lina' })}
      actions={
        <div className="hidden items-center gap-1.5 md:flex">
          <IconButton label={t('button.prev')}>
            <ChevronLeft size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          </IconButton>
          <Button variant="secondary">{t('button.todayButton')}</Button>
          <IconButton label={t('button.next')}>
            <ChevronRight size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          </IconButton>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile value={12} label={t('stats.appointments')} />
        <StatTile value={8} label={t('stats.confirmed')} tone="brand" />
        <StatTile value={3} label={t('stats.noReply')} />
        <StatTile value={1} label={t('stats.refilled')} tone="amber" />
      </div>

      <div className="flex flex-col gap-3.5 md:max-w-[360px]">
        <a
          href="#"
          className="bg-hero flex flex-col gap-3 rounded-card p-5 text-white no-underline"
        >
          <span className="text-[13px] tracking-[0.06em] text-hero-subtle uppercase">
            {t('doFirst')}
          </span>
          <span className="text-2xl font-semibold">{t('remindersDue', { count: 4 })}</span>
          <span className="inline-flex h-11 w-fit items-center rounded-pill bg-accent px-[18px] text-[15px] font-semibold text-ink">
            {t('sendNow')}
          </span>
        </a>
        <a
          href="#"
          className="flex items-center gap-3 rounded-card-sm border border-warning-line bg-warning-soft p-[18px] text-warning-deep no-underline"
        >
          <span className="flex flex-1 flex-col gap-[3px]">
            <span className="text-[13px] tracking-[0.06em] uppercase">{t('needsYou')}</span>
            <span className="text-lg font-semibold">{t('outcomesToMark', { count: 2 })}</span>
          </span>
          <ChevronRight size={22} aria-hidden="true" className="rtl:-scale-x-100" />
        </a>
      </div>

      <h2 className="mt-2 text-2xl font-semibold">{t('gallery')}</h2>

      <Section title={t('sections.buttons')}>
        <div className="flex flex-wrap items-center gap-2">
          <Button>{t('button.primary')}</Button>
          <Button variant="accent">{t('button.accent')}</Button>
          <Button variant="secondary">{t('button.secondary')}</Button>
          <Button variant="ghost">{t('button.ghost')}</Button>
          <Button variant="danger">{t('button.danger')}</Button>
          <Button loading>{t('button.loading')}</Button>
          <Button disabled>{t('button.disabled')}</Button>
          <Button size="row" variant="secondary">
            {t('button.row')}
          </Button>
          <ButtonLink href="#" size="lg">
            <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
            {t('button.large')}
          </ButtonLink>
        </div>
        <div className="bg-hero flex flex-wrap gap-2 rounded-card-sm p-4">
          <Button variant="accent">{t('button.accent')}</Button>
          <Button>{t('button.primary')}</Button>
          <Logo tone="white" width={132} />
        </div>
      </Section>

      <Section title={t('sections.fields')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label={t('fields.name')}
            placeholder={t('fields.namePlaceholder')}
            autoComplete="name"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ui-phone" className="text-sm font-medium">
              {t('fields.phone')}
            </label>
            <div className="flex gap-2">
              <Select
                label={t('fields.countryCode')}
                wrapperClassName="[&>label]:sr-only w-28"
                autoComplete="tel-country-code"
                dir="ltr"
                defaultValue="+961"
              >
                <option>+961</option>
                <option>+971</option>
              </Select>
              <Input
                id="ui-phone"
                label={t('fields.phone')}
                wrapperClassName="min-w-0 flex-1 [&>label]:sr-only"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
              />
            </div>
          </div>
          <Input
            label={t('fields.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            defaultValue="maya@"
            error={t('fields.emailError')}
          />
          <Select label={t('fields.service')} hint={t('fields.serviceHint')}>
            <option>{t('fields.haircut')}</option>
            <option>{t('fields.blowDry')}</option>
          </Select>
        </div>
      </Section>

      <Section title={t('sections.chips')}>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(statusTones) as Status[]).map((s) => (
            <StatusChip key={s} status={s} />
          ))}
          <Chip tone="outline" className="border-danger-line text-danger">
            {t('noShowBadge', { count: 2 })}
          </Chip>
          <CountBadge count={4} label="4" />
          <CountBadge count={2} tone="warning" label="2" />
          <CountBadge count={120} />
        </div>
      </Section>

      <Section title={t('sections.feedback')}>
        <Callout icon={<Info />}>{t('callout')}</Callout>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[52px]" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div>
          <SheetDemo />
        </div>
      </Section>

      <Section title={t('sections.logo')}>
        <Logo width={180} />
      </Section>
    </ShellDemo>
  );
}
