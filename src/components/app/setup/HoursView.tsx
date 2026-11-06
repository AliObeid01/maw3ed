'use client';

import { Clock } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  getStaffHours,
  listStaff,
  listTimeOff,
  type StaffMember,
  type TimeOff,
} from '@/lib/api/setup';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import { radioGroupKeyDown } from '@/components/ui/radioKeys';
import { HeaderActions } from '../HeaderActions';
import { EmptyState, LoadError, OwnerOnly } from '../states';
import { TimeOffPanel } from './TimeOffPanel';
import { WeeklyHours } from './WeeklyHours';

function StaffSwitcher({
  staff,
  selectedId,
  onSelect,
  className,
}: {
  staff: StaffMember[];
  selectedId: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations('app.hours');
  return (
    <div
      role="radiogroup"
      aria-label={t('whose')}
      data-allow-overflow
      onKeyDown={(e) => radioGroupKeyDown(e, (i) => onSelect(staff[i]!.id))}
      className={cn(
        'flex max-w-full gap-1 overflow-x-auto rounded-btn bg-divider p-1 [scrollbar-width:none]',
        className,
      )}
    >
      {staff.map((member) => {
        const checked = member.id === selectedId;
        return (
          <button
            key={member.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onSelect(member.id)}
            className={cn(
              'min-h-11 shrink-0 rounded-btn px-4 text-[15px] transition-colors duration-200 ease-out',
              checked ? 'bg-brand font-semibold text-white' : 'text-muted hover:text-ink',
            )}
          >
            {member.displayName}
          </button>
        );
      })}
    </div>
  );
}

function HoursSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-5">
      <Card className="flex min-w-0 flex-[999_1_480px] flex-col gap-3">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </Card>
      <Skeleton className="h-[320px] flex-[1_1_300px] rounded-card lg:max-w-[380px]" />
    </div>
  );
}

function StaffHours({ staffId, schedulable }: { staffId: string; schedulable: StaffMember[] }) {
  const hours = useResource((signal) => getStaffHours(staffId, signal), `hours:${staffId}`);
  const timeOff = useResource((signal) => listTimeOff(staffId, signal), `timeoff:${staffId}`);

  if (hours.error && !hours.data) return <LoadError error={hours.error} onRetry={hours.reload} />;
  if (!hours.data || (!timeOff.data && !timeOff.error)) return <HoursSkeleton />;

  // The API returns only upcoming and ongoing time off by default, so no client-side date filter.
  const upcoming = [...(timeOff.data ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const onChange = (update: (current: TimeOff[]) => TimeOff[]) =>
    timeOff.setData((current) => update(current ?? []));

  return (
    <div className="flex flex-wrap items-start gap-5">
      <WeeklyHours
        staffId={staffId}
        source={schedulable.find((m) => m.id === staffId)!}
        others={schedulable.filter((m) => m.id !== staffId)}
        initial={hours.data}
        onSaved={hours.setData}
      />
      {timeOff.error && !timeOff.data ? (
        <LoadError error={timeOff.error} onRetry={timeOff.reload} className="flex-[1_1_300px]" />
      ) : (
        <TimeOffPanel staffId={staffId} items={upcoming} onChange={onChange} />
      )}
    </div>
  );
}

export function HoursView() {
  return (
    <OwnerOnly>
      <HoursInner />
    </OwnerOnly>
  );
}

function HoursInner() {
  const t = useTranslations('app.hours');
  const staff = useResource(listStaff, 'staff');
  const [selected, setSelected] = useState<string | null>(null);

  if (staff.error && !staff.data) return <LoadError error={staff.error} onRetry={staff.reload} />;
  if (!staff.data) return <HoursSkeleton />;

  const schedulable = staff.data.filter((m) => m.active && m.bookable);
  if (schedulable.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={22} />}
        title={t('emptyTitle')}
        body={t('emptyBody')}
        action={
          <Link href="/app/staff" className={buttonClasses({})}>
            {t('emptyCta')}
          </Link>
        }
      />
    );
  }
  const selectedId = schedulable.some((m) => m.id === selected) ? selected! : schedulable[0]!.id;

  return (
    <>
      <HeaderActions>
        <StaffSwitcher
          staff={schedulable}
          selectedId={selectedId}
          onSelect={setSelected}
          className="hidden md:flex"
        />
      </HeaderActions>
      <StaffSwitcher
        staff={schedulable}
        selectedId={selectedId}
        onSelect={setSelected}
        className="md:hidden"
      />
      <StaffHours key={selectedId} staffId={selectedId} schedulable={schedulable} />
    </>
  );
}
