'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/Button';
import { OUTCOMES, type Outcome } from '@/lib/api/outcomes';
import type { StatusKey } from '@/i18n/keys';
import { cn } from '@/lib/cn';
import type { OptionState } from '@/lib/outcomes/eligibility';

const labelKey: Record<Outcome, StatusKey> = {
  ATTENDED: 'attended',
  NO_SHOW: 'noShow',
  LATE_CANCEL: 'lateCancel',
};

// Board 4.4: Attended is the blue primary, No-show and Late cancel are white with a tinted outline.
const look: Record<Outcome, string> = {
  ATTENDED: 'border-transparent bg-brand text-white hover:bg-brand-hover',
  NO_SHOW: 'border-danger-line bg-surface text-danger hover:bg-danger-soft',
  LATE_CANCEL: 'border-warning-line bg-surface text-warning hover:bg-warning-soft',
};

function OutcomeButton({
  name,
  outcome,
  state,
  pending,
  anyPending,
  onPick,
  describedBy,
  graceHintId,
}: {
  name: string;
  outcome: Outcome;
  state: OptionState;
  pending: boolean;
  anyPending: boolean;
  onPick: (outcome: Outcome) => void;
  describedBy?: string;
  graceHintId?: string;
}) {
  const t = useTranslations('app.outcomes');
  const ts = useTranslations('ui.status');
  const disabled = state !== 'enabled' || anyPending;
  const label = ts(labelKey[outcome]);
  const blocked = state === 'notEnded' || state === 'notStarted' || state === 'locked';
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={state === 'current' ? true : undefined}
      aria-busy={pending || undefined}
      aria-describedby={state === 'grace' ? graceHintId : blocked ? describedBy : undefined}
      aria-label={t('markAria', { name, outcome: label })}
      onClick={() => onPick(outcome)}
      className={cn(
        'inline-flex min-h-[50px] items-center justify-center gap-1.5 rounded-input border px-1.5 text-center text-[15px] leading-tight font-semibold transition-colors duration-200 ease-out disabled:cursor-not-allowed',
        look[outcome],
        state === 'current' && 'ring-2 ring-brand ring-offset-2',
        disabled && state !== 'current' && 'opacity-50',
      )}
    >
      {pending ? <Spinner className="size-4" /> : null}
      {label}
    </button>
  );
}

/**
 * The three outcome buttons (44 px+, always labelled). `states` decides which are tappable; the one already recorded
 * is pressed. `pending` shows a spinner on the button whose request is in flight and blocks the others.
 */
export function OutcomeButtons({
  name,
  states,
  pending = null,
  onPick,
  describedBy,
  graceHintId,
}: {
  name: string;
  states?: Partial<Record<Outcome, OptionState>>;
  pending?: Outcome | null;
  onPick: (outcome: Outcome) => void;
  /** Id of a hint that explains a disabled button. */
  describedBy?: string;
  /** Id of the 'No-show is available from HH:mm' hint, shown while the No-show grace period runs. */
  graceHintId?: string;
}) {
  const t = useTranslations('app.outcomes');
  return (
    <div role="group" aria-label={t('groupLabel', { name })} className="grid grid-cols-3 gap-2">
      {OUTCOMES.map((outcome) => (
        <OutcomeButton
          key={outcome}
          name={name}
          outcome={outcome}
          state={states?.[outcome] ?? 'enabled'}
          pending={pending === outcome}
          anyPending={pending !== null}
          onPick={onPick}
          describedBy={describedBy}
          graceHintId={graceHintId}
        />
      ))}
    </div>
  );
}
