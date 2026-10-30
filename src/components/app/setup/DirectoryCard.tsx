'use client';

import { Check, Circle, Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { updateBusiness, type Business } from '@/lib/api/setup';
import { directoryChecklist, missingFromError } from '@/lib/directory/readiness';
import { useErrorMessage } from '../states';

/** "List my business" toggle with the readiness checklist (Share page, opt-in, off by default). */
export function DirectoryCard({
  business,
  onChange,
}: {
  business: Business;
  onChange: (next: Business) => void;
}) {
  const t = useTranslations('directory.owner');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const items = directoryChecklist(business.setup);
  const ready = items.every((i) => i.done);

  async function toggle(next: boolean) {
    if (pending) return;
    setPending(true);
    setMissing([]);
    try {
      const updated = await updateBusiness({ listed: next });
      onChange(updated);
      toast.show(updated.listed ? t('listedToast') : t('unlistedToast'));
    } catch (error) {
      const list = error instanceof ApiError ? missingFromError(error) : [];
      if (list.length > 0) setMissing(list);
      else toast.show(errorMessage(error), 'error');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="directory" size="sm" className="flex scroll-mt-4 flex-col gap-4 p-5">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-input bg-brand-soft text-brand"
        >
          <Globe size={24} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="m-0 text-[17px] font-semibold">{t('title')}</h2>
          <p className="m-0 text-sm leading-[1.45] text-muted">{t('body')}</p>
        </div>
        <Switch
          label={t('switch')}
          checked={business.listed}
          pending={pending}
          disabled={!ready && !business.listed}
          onCheckedChange={toggle}
        />
      </div>

      <p role="status" className="m-0 text-sm font-semibold text-brand">
        {business.listed ? t('statusOn') : t('statusOff')}
      </p>

      {!ready ? (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-sm font-semibold">{t('checklistTitle')}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map((item) => (
              <li key={item.id} className="flex min-h-11 items-center gap-2.5 text-sm">
                {item.done ? (
                  <Check size={18} aria-hidden="true" className="shrink-0 text-success" />
                ) : (
                  <Circle size={18} aria-hidden="true" className="shrink-0 text-muted" />
                )}
                <span className={item.done ? 'text-muted' : 'text-ink'}>
                  {t(`checklist.${item.id}`)}
                  <span className="sr-only"> {item.done ? t('done') : t('todo')}</span>
                </span>
                {!item.done ? (
                  <Link
                    href={item.href}
                    className="ms-auto inline-flex min-h-11 items-center text-sm font-semibold text-brand"
                  >
                    {t('fix')}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <Callout tone="warning">
          <div role="alert">
            {t('notReady', { items: missing.map((m) => t(`checklist.${m}`)).join(', ') })}
          </div>
        </Callout>
      ) : null}
    </Card>
  );
}
