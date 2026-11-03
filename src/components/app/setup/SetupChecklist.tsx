'use client';

import { Check, ChevronRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { getBusiness, listInvites, listServices, listStaff, type Business } from '@/lib/api/setup';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import { deriveSetupSteps, shareSeenKey, stepHrefs, type SetupStepId } from '@/lib/setup/steps';
import { useAppSession } from '../SessionContext';
import { LoadError, OwnerOnly } from '../states';

type Extras = { serviceCount: number; hasReceptionist: boolean };

/** Reads the extra signals the checklist needs; each call may fail on its own without breaking the page. */
async function loadExtras(signal: AbortSignal): Promise<Extras> {
  const [services, staff, invites] = await Promise.allSettled([
    listServices(signal),
    listStaff(signal),
    listInvites(signal),
  ]);
  return {
    serviceCount: services.status === 'fulfilled' ? services.value.length : 0,
    hasReceptionist:
      (staff.status === 'fulfilled' && staff.value.some((s) => s.role === 'STAFF')) ||
      (invites.status === 'fulfilled' && invites.value.length > 0),
  };
}

const MINUTES: Record<SetupStepId, number> = {
  business: 1,
  services: 3,
  staff: 2,
  hours: 2,
  publish: 1,
  share: 1,
  invite: 1,
};

const subscribeStorage = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};
const readShareSeen = (slug: string) => {
  try {
    return window.localStorage.getItem(shareSeenKey(slug)) === '1';
  } catch {
    return false;
  }
};

function ChecklistSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <Skeleton className="h-[168px] rounded-card md:h-[144px]" />
      <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-card-sm" />
        ))}
      </div>
    </div>
  );
}

function Checklist({
  business,
  extras,
  userName,
}: {
  business: Business;
  extras: Extras;
  userName: string;
}) {
  const t = useTranslations('app.setup');
  const shareSeen = useSyncExternalStore(
    subscribeStorage,
    () => readShareSeen(business.slug),
    () => false,
  );
  const { steps, doneCount, total, percent } = deriveSetupSteps({
    flags: business.setup,
    shareSeen,
    hasReceptionist: extras.hasReceptionist,
    listed: business.listed,
  });

  return (
    <>
      <section className="flex flex-wrap items-center gap-x-6 gap-y-5 rounded-card bg-hero p-5 text-white md:p-7">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
          <span className="text-[15px] text-hero-subtle">{t('welcome', { name: userName })}</span>
          <h2 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.01em] md:text-3xl">
            {t('title', { name: business.name })}
          </h2>
          <span className="text-[15px] text-hero-muted">{t('subtitle')}</span>
        </div>
        <div className="flex flex-[1_1_260px] items-center gap-3.5">
          <div
            role="progressbar"
            aria-label={t('progressLabel')}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={doneCount}
            aria-valuetext={t('progress', { done: doneCount, total })}
            className="h-2.5 flex-1 overflow-hidden rounded-pill bg-white/15"
          >
            <div
              className="h-full rounded-pill bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-base font-semibold whitespace-nowrap">
            {t('progress', { done: doneCount, total })}
          </span>
        </div>
      </section>

      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3.5 p-0">
        {steps.map((step) => {
          // Required steps are numbered 1 to 6; the optional step carries a label instead of a number.
          const number = step.optional ? null : steps.filter((s) => !s.optional).indexOf(step) + 1;
          const hint = step.done
            ? t(`steps.${step.id}.doneHint`, { count: extras.serviceCount })
            : step.current
              ? t('nextHint', { minutes: MINUTES[step.id] })
              : t(`steps.${step.id}.hint`);
          return (
            <li key={step.id}>
              <Link
                href={stepHrefs[step.id]}
                aria-current={step.current ? 'step' : undefined}
                className={cn(
                  'flex min-h-[92px] items-center gap-3.5 rounded-card-sm bg-surface text-ink no-underline transition-shadow duration-200 ease-out',
                  step.current
                    ? 'border-2 border-brand p-[17px] shadow-[0_10px_24px_rgb(11_25_56/0.10)]'
                    : 'border border-line p-[18px] hover:shadow-[0_4px_14px_rgb(11_25_56/0.06)]',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-pill text-base font-semibold',
                    step.done && 'bg-brand text-white',
                    step.current && 'bg-ink text-white',
                    !step.done && !step.current && 'bg-divider text-muted',
                  )}
                >
                  {step.done ? <Check size={18} strokeWidth={3} /> : (number ?? <Sparkles size={18} />)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span
                    className={cn(
                      'text-[17px] font-semibold',
                      step.done && 'text-muted line-through',
                    )}
                  >
                    {t(`steps.${step.id}.title`)}
                    {step.done ? <span className="sr-only"> {t('done')}</span> : null}
                    {step.optional ? (
                      <span className="ms-2 inline-block rounded-chip bg-divider px-2.5 py-0.5 align-middle text-xs font-semibold text-muted no-underline">
                        {t('optional')}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm text-muted">{hint}</span>
                </span>
                {step.current ? (
                  <ChevronRight
                    size={20}
                    aria-hidden="true"
                    className="shrink-0 text-brand rtl:-scale-x-100"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function SetupChecklist() {
  return (
    <OwnerOnly>
      <SetupChecklistInner />
    </OwnerOnly>
  );
}

function SetupChecklistInner() {
  const { userName } = useAppSession();
  const business = useResource(getBusiness, 'business');
  const extras = useResource(loadExtras, 'extras');

  if (business.error) return <LoadError error={business.error} onRetry={business.reload} />;
  if (!business.data || (extras.loading && !extras.data)) return <ChecklistSkeleton />;
  return (
    <Checklist
      business={business.data}
      extras={extras.data ?? { serviceCount: 0, hasReceptionist: false }}
      userName={userName}
    />
  );
}
