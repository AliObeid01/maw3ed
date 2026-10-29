'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { monogram } from '@/components/public/monogram';
import type { PublicStaff } from '@/lib/api/booking';
import { StepHeading } from './StepHeading';

/** Board 1.2: "Anyone available" first (shows the most free times), then each person who offers the service. */
export function StaffStep({
  eligible,
  onChoose,
  onBack,
  headingRef,
}: {
  eligible: PublicStaff[];
  onChoose: (staffId: string) => void;
  onBack: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const t = useTranslations('booking');
  const group = t('staff.groupLabel');

  return (
    <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
      <StepHeading title={t('staff.title')} onBack={onBack} headingRef={headingRef} />
      {eligible.length === 0 ? (
        <Card>
          <p className="m-0 text-[15px] text-muted">{t('time.noEligibleStaff')}</p>
        </Card>
      ) : (
        <ul aria-label={group} className="m-0 flex list-none flex-col gap-3 p-0">
          <li>
            <button
              type="button"
              onClick={() => onChoose('anyone')}
              className="flex min-h-[72px] w-full items-center gap-3.5 rounded-card-sm border border-line bg-surface p-4 text-start transition-colors duration-200 ease-out hover:border-brand hover:bg-canvas"
            >
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-brand"
              >
                <Users size={24} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[17px] font-semibold">{t('staff.anyone')}</span>
                <span className="text-sm text-muted">{t('staff.anyoneHint')}</span>
              </span>
              <Chip tone="brand">{t('staff.fastest')}</Chip>
            </button>
          </li>
          <li>
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
              {eligible.map((person) => (
                <li key={person.id} className="flex">
                  <button
                    type="button"
                    onClick={() => onChoose(person.id)}
                    className="flex min-h-[72px] w-full items-center gap-3.5 rounded-card-sm border border-line bg-surface p-4 text-start transition-colors duration-200 ease-out hover:border-brand hover:bg-canvas"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-brand-avatar text-lg font-semibold text-brand-deep"
                    >
                      {monogram(person.displayName).slice(0, 1)}
                    </span>
                    <span className="min-w-0 truncate text-[17px] font-semibold">
                      {person.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        </ul>
      )}
    </section>
  );
}
