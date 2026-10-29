import type { TokenAction } from './tokens';

export type LinkAction = 'confirm' | 'cancel';

/** A `view` token may do either; a `confirm` token only confirms; a `cancel` token only cancels. */
export function linkActionAllowed(tokenAct: TokenAction, action: LinkAction): boolean {
  return tokenAct === 'view' || tokenAct === action;
}

/** Last instant a cancellation is free: startAt minus the business's cancel cutoff. */
export function cancelCutoffAt(startAt: Date, cancelCutoffMin: number): Date {
  return new Date(startAt.getTime() - cancelCutoffMin * 60_000);
}

export type ConfirmOutcome = 'confirm' | 'already_confirmed' | 'conflict';

export function confirmOutcomeFor(status: string): ConfirmOutcome {
  if (status === 'BOOKED') return 'confirm';
  if (status === 'CONFIRMED') return 'already_confirmed';
  return 'conflict';
}

export type CancelOutcome = 'cancel' | 'late_cancel' | 'already_cancelled' | 'conflict';

/** From the cutoff on (now >= cutoff) a cancellation is a late cancel. */
export function cancelOutcomeFor(
  status: string,
  now: Date,
  startAt: Date,
  cancelCutoffMin: number,
): CancelOutcome {
  if (status === 'CANCELLED' || status === 'LATE_CANCEL') return 'already_cancelled';
  if (status !== 'BOOKED' && status !== 'CONFIRMED' && status !== 'PENDING_PAYMENT')
    return 'conflict';
  return now.getTime() >= cancelCutoffAt(startAt, cancelCutoffMin).getTime()
    ? 'late_cancel'
    : 'cancel';
}
