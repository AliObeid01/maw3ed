'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import type { PublicBusiness } from '@/lib/api/booking';
import { StepHeading } from './StepHeading';
import { useBookingFormat } from './useBookingFormat';
import type { Ref } from 'react';

/** Board 1.1: one big button per service; tapping it moves on. */
export function ServiceStep({
  data,
  onChoose,
  headingRef,
}: {
  data: PublicBusiness;
  onChoose: (serviceId: string) => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const t = useTranslations('booking.service');
  const f = useBookingFormat(data.business.timezone);
  const offered = data.services.filter((s) => data.staff.some((p) => p.serviceIds.includes(s.id)));

  return (
    <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
      <StepHeading title={t('title')} headingRef={headingRef} />
      {offered.length === 0 ? (
        <Card className="flex flex-col gap-1.5 text-center">
          <h3 className="m-0 text-lg font-semibold">{t('emptyTitle')}</h3>
          <p className="m-0 text-[15px] text-muted">
            {t('emptyBody', { name: data.business.name })}
          </p>
        </Card>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
          {offered.map((service) => (
            <li key={service.id} className="flex">
              <button
                type="button"
                onClick={() => onChoose(service.id)}
                className="flex min-h-[88px] w-full items-center justify-between gap-4 rounded-card-sm border border-line bg-surface p-[18px] text-start transition-colors duration-200 ease-out hover:border-brand hover:bg-canvas md:min-h-28 md:p-5"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-lg font-semibold">{service.name}</span>
                  <span className="text-sm text-muted">{f.duration(service.durationMin)}</span>
                </span>
                <span className="text-xl font-semibold tabular-nums">{f.money(service.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ServiceSkeleton() {
  return (
    <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-card-sm md:h-28" />
        ))}
      </div>
    </section>
  );
}
