import { ApiError } from '@/lib/api/auth';
import type { LinkResult, LinkView } from '@/lib/api/links';

/** What the link page shows. */
export type LinkScreen =
  /** Booked or confirmed, with the action buttons the token and state allow. */
  | 'actionable'
  /** Just confirmed (or already was). */
  | 'confirmed'
  /** Cancelled in time (board 2.2). */
  | 'cancelled'
  /** Cancelled after the free-cancellation cutoff. */
  | 'lateCancelled'
  /** Attended or no-show: nothing left to do. */
  | 'over';

export type LinkAction = 'confirm' | 'cancel';

export function screenFor(link: LinkView): LinkScreen {
  switch (link.appointment.status) {
    case 'CANCELLED':
      return 'cancelled';
    case 'LATE_CANCEL':
      return 'lateCancelled';
    case 'ATTENDED':
    case 'NO_SHOW':
      return 'over';
    default:
      return 'actionable';
  }
}

export function screenForResult(result: LinkResult): LinkScreen {
  switch (result) {
    case 'confirmed':
    case 'already_confirmed':
      return 'confirmed';
    case 'late_cancelled':
      return 'lateCancelled';
    default:
      return 'cancelled';
  }
}

/**
 * Buttons to show, primary first. A confirm link makes "confirm" primary, a cancel link makes "cancel" primary,
 * a plain view link offers both with "confirm" first. An action the appointment cannot take is not offered.
 */
export function buttonsFor(link: LinkView): { action: LinkAction; primary: boolean }[] {
  const available: LinkAction[] = [];
  if (link.canConfirm) available.push('confirm');
  if (link.canCancel) available.push('cancel');
  const preferred: LinkAction = link.act === 'cancel' ? 'cancel' : 'confirm';
  const primary = available.includes(preferred) ? preferred : available[0];
  return available
    .map((action) => ({ action, primary: action === primary }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** Wording of the cancel dialog: free before the cutoff, a late cancellation after it. */
export function cancelNoteKind(link: Pick<LinkView, 'pastCutoff'>): 'free' | 'late' {
  return link.pastCutoff ? 'late' : 'free';
}

export type LinkFailure =
  | 'invalid' // 404: unknown or malformed link
  | 'expired' // 410: stopped working at the appointment start
  | 'wrongAction' // 403: this token cannot do that
  | 'notAllowed' // 409: not allowed in the current state
  | 'network'
  | 'generic';

export function classifyLinkError(error: unknown): LinkFailure {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.code === 'NETWORK') return 'network';
  if (error.status === 404) return 'invalid';
  if (error.status === 410) return 'expired';
  if (error.status === 403) return 'wrongAction';
  if (error.status === 409) return 'notAllowed';
  return 'generic';
}
