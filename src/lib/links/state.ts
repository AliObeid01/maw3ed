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
 * The screen after an action. The result says what just happened; for "already cancelled" the appointment
 * status says HOW it was cancelled (a late cancel must not be shown as a free one).
 */
export function screenAfter(result: LinkResult, link: LinkView): LinkScreen {
  if (result === 'already_cancelled') {
    const byStatus = screenFor(link);
    if (byStatus === 'cancelled' || byStatus === 'lateCancelled') return byStatus;
  }
  return screenForResult(result);
}

/**
 * Buttons to show, primary first. The token decides what is allowed (the server answers 403 WRONG_LINK_ACTION
 * otherwise): a confirm link can only confirm, a cancel link only cancel, a plain view link either, with
 * "confirm" first. An action the appointment cannot take is not offered. The allowed one is always primary.
 */
export function buttonsFor(link: LinkView): { action: LinkAction; primary: boolean }[] {
  const allowed: LinkAction[] = link.act === 'view' ? ['confirm', 'cancel'] : [link.act];
  const buttons = allowed.filter((a) => (a === 'confirm' ? link.canConfirm : link.canCancel));
  return buttons.map((action, i) => ({ action, primary: i === 0 }));
}

/** May this token cancel? (A confirm link cannot.) */
export const tokenCanCancel = (link: Pick<LinkView, 'act' | 'canCancel'>) =>
  link.canCancel && link.act !== 'confirm';

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
