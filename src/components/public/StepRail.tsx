'use client';

import { Check, ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';

enum StepState {
  Done,
  Current,
  Todo,
}

function stepState(n: number, current: number): StepState {
  if (n < current) return StepState.Done;
  if (n === current) return StepState.Current;
  return StepState.Todo;
}

export type Step = {
  id: string;
  label: string;
  /** The chosen value, shown under the label once the step is done. */
  value?: string;
};

export type StepRailProps = {
  steps: Step[];
  /** 1-based index of the current step. */
  current: number;
  /** Phones: back button on the compact progress bar. Hidden on step 1 unless provided. */
  onBack?: () => void;
  className?: string;
};

/**
 * Desktop (`lg+`): the card rail from board 02. Below `lg`: "Step N of 4" with a progress bar and back button.
 * The current step carries `aria-current="step"` in both.
 */
export function StepRail({ steps, current, onBack, className }: StepRailProps) {
  const t = useTranslations('public.steps');
  const total = steps.length;
  const active = steps[current - 1];

  return (
    <>
      <nav
        aria-label={t('navLabel')}
        className={cn(
          'hidden w-full max-w-[250px] flex-[1_1_220px] flex-col gap-4 rounded-card border border-line bg-surface p-5 lg:flex',
          className,
        )}
      >
        <span className="text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">
          {t('title', { count: total })}
        </span>
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
          {steps.map((step, i) => {
            const n = i + 1;
            const state = stepState(n, current);
            return (
              <li
                key={step.id}
                aria-current={state === StepState.Current ? 'step' : undefined}
                className="flex items-center gap-3"
              >
                <span
                  className={cn(
                    'flex size-[30px] shrink-0 items-center justify-center rounded-pill text-sm font-semibold tabular-nums',
                    state === StepState.Current && 'bg-brand text-white',
                    state === StepState.Done && 'bg-accent text-ink',
                    state === StepState.Todo && 'bg-divider text-muted',
                  )}
                >
                  {state === StepState.Done ? (
                    <Check size={16} strokeWidth={3} aria-hidden="true" />
                  ) : (
                    n
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      'text-[15px]',
                      state === StepState.Current ? 'font-semibold' : 'text-muted',
                      state === StepState.Done && 'font-medium text-ink',
                    )}
                  >
                    {step.label}
                    {state === StepState.Done ? (
                      <span className="sr-only"> ({t('done')})</span>
                    ) : null}
                  </span>
                  {state === StepState.Done && step.value ? (
                    <span className="truncate text-[13px] text-muted">{step.value}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <nav
        aria-label={t('navLabel')}
        className={cn('flex w-full items-center gap-3 lg:hidden', className)}
      >
        {onBack && current > 1 ? (
          <IconButton label={t('back')} onClick={onBack}>
            <ChevronLeft size={20} aria-hidden="true" className="rtl:-scale-x-100" />
          </IconButton>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current="step">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold">{t('progress', { current, total })}</span>
            <span className="truncate text-muted">{active?.label}</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={current}
            aria-valuetext={t('progress', { current, total })}
            className="h-1.5 overflow-hidden rounded-pill bg-divider"
          >
            <div
              className="h-full rounded-pill bg-brand transition-[width] duration-200 ease-out"
              style={{ width: `${(current / total) * 100}%` }}
            />
          </div>
        </div>
      </nav>
    </>
  );
}
