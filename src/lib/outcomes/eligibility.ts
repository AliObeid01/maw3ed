import type { Outcome } from '@/lib/api/outcomes';

/** Where "now" sits relative to an appointment. Matches the server: started = startAt <= now, ended = endAt <= now. */
export type OutcomeWindow = 'upcoming' | 'inProgress' | 'ended';

export function outcomeWindow(startAt: string, endAt: string, now: Date): OutcomeWindow {
  const t = now.getTime();
  if (Date.parse(startAt) > t) return 'upcoming';
  if (Date.parse(endAt) > t) return 'inProgress';
  return 'ended';
}

/** `current` = already recorded (shown pressed, not tappable). The other two reasons explain a disabled button. */
export type OptionState = 'enabled' | 'current' | 'notStarted' | 'notEnded';

export type OutcomeOptions =
  | { open: false }
  | {
      open: true;
      /** The outcome already recorded, or null for a booking nobody has marked yet. */
      current: Outcome | null;
      window: OutcomeWindow;
      options: Record<Outcome, OptionState>;
    };

const OUTCOME_STATUSES = new Set<string>(['ATTENDED', 'NO_SHOW', 'LATE_CANCEL']);
const OPEN_STATUSES = new Set(['BOOKED', 'CONFIRMED']);

/**
 * Which outcome buttons an appointment can use right now. The server stays the authority (a late cancel that the
 * cancel flow recorded still answers 409 CONFLICT), this only avoids offering what is certain to fail:
 *  - not started yet: nothing,
 *  - in progress: No-show and Late cancel; Attended once it has ended,
 *  - cancelled (or any status that never takes an outcome): the section is closed.
 */
export function outcomeOptions(
  appt: { status: string; startAt: string; endAt: string },
  now: Date,
): OutcomeOptions {
  const isOutcome = OUTCOME_STATUSES.has(appt.status);
  if (!isOutcome && !OPEN_STATUSES.has(appt.status)) return { open: false };
  const window = outcomeWindow(appt.startAt, appt.endAt, now);
  const current = isOutcome ? (appt.status as Outcome) : null;
  const stateFor = (outcome: Outcome): OptionState => {
    if (outcome === current) return 'current';
    if (window === 'upcoming') return 'notStarted';
    if (outcome === 'ATTENDED' && window === 'inProgress') return 'notEnded';
    return 'enabled';
  };
  return {
    open: true,
    current,
    window,
    options: {
      ATTENDED: stateFor('ATTENDED'),
      NO_SHOW: stateFor('NO_SHOW'),
      LATE_CANCEL: stateFor('LATE_CANCEL'),
    },
  };
}
