import type { TokenAction } from './tokens';

export type LinkAction = 'confirm' | 'cancel';

/** A `view` token may do either; a `confirm` token only confirms; a `cancel` token only cancels. */
export function linkActionAllowed(tokenAct: TokenAction, action: LinkAction): boolean {
  return tokenAct === 'view' || tokenAct === action;
}

/**
 * The cutoff instant: startAt minus the business's cancel cutoff. It is the FIRST instant that counts as a
 * late cancel (now >= cutoff); one millisecond earlier is still free.
 */
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

/** From the cutoff instant on (now >= cutoff) a cancellation is a late cancel. */
export function cancelOutcomeFor(
  status: string,
  now: Date,
  startAt: Date,
  cancelCutoffMin: number,
): CancelOutcome {
  if (status === 'CANCELLED' || status === 'LATE_CANCEL') return 'already_cancelled';
  if (status !== 'BOOKED' && status !== 'CONFIRMED' && status !== 'PENDING_PAYMENT')
    return 'conflict';
  // Abandoning an unpaid deposit hold is never a late cancel: nothing was confirmed, so it cannot count
  // against the client's record.
  if (status === 'PENDING_PAYMENT') return 'cancel';
  return now.getTime() >= cancelCutoffAt(startAt, cancelCutoffMin).getTime()
    ? 'late_cancel'
    : 'cancel';
}
