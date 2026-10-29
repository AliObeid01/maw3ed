import type { ReminderItem } from '@/lib/api/reminders';

/** How long a SENT item stays in the list (the server also stops returning it after 12 h). */
export const SENT_VISIBLE_HOURS = 12;

type Person = { id: string; name: string } | null;

/** What happened on this device for one reminder (the server list is the other source of truth). */
export type LocalMark =
  | { phase: 'idle' }
  /** WhatsApp was opened and mark-sent is in flight; the row already looks sent. */
  | { phase: 'marking' }
  | { phase: 'sent'; by: Person; at: string | null }
  /** 409: someone else got there first. */
  | { phase: 'alreadySent'; by: Person; at: string | null }
  /** mark-sent failed after WhatsApp opened. The message may be sent already: ask, never reopen. */
  | { phase: 'retry' };

export const idleMark: LocalMark = { phase: 'idle' };

export type MarkEvent =
  | { type: 'tap' }
  | { type: 'ok'; by: Person; at: string | null }
  | { type: 'conflict'; by: Person; at: string | null }
  | { type: 'fail' }
  | { type: 'retry' };

/** Optimistic mark-sent state machine. A second tap while marking/sent is ignored (double-send guard). */
export function markReducer(state: LocalMark, event: MarkEvent): LocalMark {
  switch (event.type) {
    case 'tap':
      return state.phase === 'idle' ? { phase: 'marking' } : state;
    case 'ok':
      return state.phase === 'marking' ? { phase: 'sent', by: event.by, at: event.at } : state;
    case 'conflict':
      return state.phase === 'marking' || state.phase === 'retry'
        ? { phase: 'alreadySent', by: event.by, at: event.at }
        : state;
    case 'fail':
      return state.phase === 'marking' ? { phase: 'retry' } : state;
    case 'retry':
      return state.phase === 'retry' ? { phase: 'marking' } : state;
  }
}

export type ReminderView =
  /** Can be sent now. */
  | { kind: 'pending' }
  /** The tap is being recorded (optimistic): looks sent, button disabled. */
  | { kind: 'sending' }
  | { kind: 'sent'; by: Person; at: string | null; fromOthers: boolean }
  | { kind: 'retry' }
  /** No usable phone: nothing to open. */
  | { kind: 'noPhone' };

/** Display state of one row from the server item plus what this device did with it. */
export function deriveReminder(item: ReminderItem, mark: LocalMark = idleMark): ReminderView {
  if (mark.phase === 'sent') return { kind: 'sent', by: mark.by, at: mark.at, fromOthers: false };
  if (mark.phase === 'alreadySent') {
    return { kind: 'sent', by: mark.by, at: mark.at, fromOthers: true };
  }
  if (mark.phase === 'marking') return { kind: 'sending' };
  if (mark.phase === 'retry') return { kind: 'retry' };
  if (item.status === 'SENT') {
    return { kind: 'sent', by: item.sentBy, at: item.sentAt, fromOthers: true };
  }
  if (item.phoneInvalid || !item.whatsappUrl) return { kind: 'noPhone' };
  return { kind: 'pending' };
}

/** Items still to send: not SENT on the server and not already handled on this device. */
export function pendingCount(items: ReminderItem[], marks: Record<string, LocalMark>): number {
  return items.filter((i) => {
    const view = deriveReminder(i, marks[i.id]);
    return view.kind === 'pending' || view.kind === 'noPhone' || view.kind === 'retry';
  }).length;
}

/** Pending first (soonest appointment first), sent last. Stable so rows do not jump while being marked. */
export function sortReminders(items: ReminderItem[]): ReminderItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'PENDING' ? -1 : 1;
    return Date.parse(a.appointment.startAt) - Date.parse(b.appointment.startAt) || a.id.localeCompare(b.id);
  });
}
