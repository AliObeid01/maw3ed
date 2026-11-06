'use client';

import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { copyStaffHours, type StaffMember } from '@/lib/api/setup';
import { useErrorMessage, useSharedText } from '../states';

/**
 * Owner only: copy the SAVED weekly hours of `source` to other staff (time off and services are not changed).
 * One request, all or nothing; the server merges touching blocks.
 */
export function CopyHoursSheet({
  source,
  others,
  open,
  onOpenChange,
}: {
  source: StaffMember;
  others: StaffMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('app.hours.copy');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('intro', { name: source.displayName })}
      closeLabel={t('close')}
    >
      {open ? <Body source={source} others={others} onClose={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function Body({
  source,
  others,
  onClose,
}: {
  source: StaffMember;
  others: StaffMember[];
  onClose: () => void;
}) {
  const t = useTranslations('app.hours.copy');
  const shared = useSharedText();
  const errorText = useErrorMessage();
  const toast = useToast();
  const groupId = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const all = picked.length === others.length;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const apply = async () => {
    if (pending || picked.length === 0) return;
    setPending(true);
    setError(undefined);
    try {
      const done = await copyStaffHours(source.id, picked);
      toast.show(t('done', { count: done.length }));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  const row =
    'flex min-h-11 cursor-pointer items-center gap-3 rounded-input px-3.5 text-[15px] transition-colors duration-200 ease-out hover:bg-canvas has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand';
  const box = 'size-5 shrink-0 accent-[var(--color-brand)]';

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="warning" icon={<TriangleAlert />}>
        {t('warning')}
      </Callout>
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" aria-describedby={groupId}>
        <legend className="mb-1 p-0 text-[15px] font-medium">{t('who')}</legend>
        <label className={`${row} border-b border-row font-semibold`}>
          <input
            type="checkbox"
            className={box}
            checked={all}
            onChange={() => setPicked(all ? [] : others.map((m) => m.id))}
          />
          {t('selectAll')}
        </label>
        {others.map((member) => (
          <label key={member.id} className={row}>
            <input
              type="checkbox"
              className={box}
              checked={picked.includes(member.id)}
              onChange={() => toggle(member.id)}
            />
            {member.displayName}
          </label>
        ))}
      </fieldset>
      <p id={groupId} className="m-0 text-[13px] text-muted">
        {t('savedOnly')}
      </p>
      {error ? (
        <div role="alert">
          <Callout tone="danger" icon={<CircleAlert />}>
            {error}
          </Callout>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <Button variant="secondary" size="lg" block onClick={onClose} disabled={pending}>
          {shared.cancel}
        </Button>
        <Button
          size="lg"
          block
          loading={pending}
          disabled={picked.length === 0}
          onClick={apply}
        >
          {pending ? shared.saving : t('apply')}
        </Button>
      </div>
    </div>
  );
}
