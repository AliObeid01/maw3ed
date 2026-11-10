'use client';

import { CalendarCheck, Check, Clock, ListPlus, Search, XCircle, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Reveal } from '@/components/ui/Reveal';
import { CAPABILITIES } from '@/lib/assistant';
import { cn } from '@/lib/cn';
import { useCopyStatus } from './useCopyStatus';

const ICONS: Record<(typeof CAPABILITIES)[number]['id'], LucideIcon> = {
  find: Search,
  book: CalendarCheck,
  waitlist: ListPlus,
  check: Clock,
  manage: XCircle,
};

/**
 * "What Claude can do": five rows, one per capability the nine tools really provide (see CAPABILITIES), each with an
 * example that copies on tap. Sits beside the demo card from lg and under it on phones.
 */
export function CapabilityPanel() {
  const t = useTranslations('assistant.can');
  const { state, copy } = useCopyStatus();
  const copyT = useTranslations('assistant.copy');

  return (
    <div data-testid="capabilities" className="w-full max-w-[420px] min-w-0 lg:max-w-none">
      <Reveal className="grid h-full content-start gap-1 rounded-[22px] border-[1.5px] border-divider bg-surface p-[18px]">
        <h3 className="m-0 text-[19px] leading-tight font-semibold">{t('title')}</h3>
        <p className="m-0 mb-2 text-[14.5px] text-muted">{t('hint')}</p>
        <ul aria-label={t('label')} className="m-0 grid list-none gap-4 p-0">
          {CAPABILITIES.map(({ id }) => {
            const Icon = ICONS[id];
            const example = t(`items.${id}.example`);
            const copied = state?.key === id && state.ok;
            return (
              <li key={id} data-testid={`can-${id}`} className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3">
                <span aria-hidden="true" className="grid size-11 place-items-center rounded-[14px] bg-mint/20">
                  <Icon size={22} />
                </span>
                <div className="grid min-w-0 gap-1.5">
                  <div>
                    <h4 className="m-0 text-[16.5px] leading-snug font-bold">{t(`items.${id}.title`)}</h4>
                    <p className="m-0 text-[14.5px] leading-snug text-muted">{t(`items.${id}.body`)}</p>
                  </div>
                  <button
                    type="button"
                    data-testid={`can-example-${id}`}
                    onClick={() => copy(id, example)}
                    className={cn(
                      'flex min-h-11 w-full items-center justify-between gap-3 rounded-btn border px-3.5 py-2 text-start text-[14.5px] leading-snug transition-colors duration-200 ease-out motion-reduce:transition-none',
                      copied ? 'border-success bg-success-soft text-success' : 'border-line bg-canvas text-ink hover:bg-divider',
                    )}
                  >
                    <q className="min-w-0">{example}</q>
                    {copied ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold">
                        <Check size={16} aria-hidden="true" />
                        {copyT('copied')}
                      </span>
                    ) : null}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p role="status" aria-live="polite" className="sr-only" data-testid="can-status">
          {state ? (state.ok ? copyT('announce') : copyT('failed')) : ''}
        </p>
      </Reveal>
    </div>
  );
}
