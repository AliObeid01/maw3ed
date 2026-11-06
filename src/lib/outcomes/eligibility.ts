import type { Outcome } from '@/lib/api/outcomes';
import { NO_SHOW_GRACE_MIN } from '@/server/domain/outcomes';

/** Where "now" sits relative to an appointment. Matches the server: started = startAt <= now, ended = endAt <= now. */
export type OutcomeWindow = 'upcoming' | 'inProgress' | 'ended';

export function outcomeWindow(startAt: string, endAt: string, now: Date): OutcomeWindow {
  const t = now.getTime();
  if (Date.parse(startAt) > t) return 'upcoming';
  if (Date.parse(endAt) > t) return 'inProgress';
  return 'ended';
}

/**
 * `current` = already recorded (shown pressed, not tappable). The others explain a disabled button; `grace` is
 * No-show inside the first NO_SHOW_GRACE_MIN minutes (the client may still be on the way).
 */
export type OptionState = 'enabled' | 'current' | 'notStarted' | 'notEnded' | 'locked' | 'grace';

export type OutcomeOptions =
  | { open: false }
  | {
      open: true;
      /** The outcome already recorded, or null for a booking nobody has marked yet. */
      current: Outcome | null;
      window: OutcomeWindow;
      /** ISO instant No-show opens, only while the grace period is still running; otherwise null. */
      noShowAvailableAt: string | null;
      options: Record<Outcome, OptionState>;
    };

const OUTCOME_STATUSES = new Set<string>(['ATTENDED', 'NO_SHOW', 'LATE_CANCEL']);
const OPEN_STATUSES = new Set(['BOOKED', 'CONFIRMED']);

/**
 * Which outcome buttons an appointment can use right now. The server stays the authority (a late cancel that the
 * cancel flow recorded still answers 409 CONFLICT), this only avoids offering what is certain to fail:
 *  - not started yet: nothing,
 *  - in progress: Late cancel; No-show from 10 minutes after the start; Attended once it has ended,
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
  // The server holds back every move INTO no-show during the first minutes: from an unmarked booking and as a
  // correction from a staff-set Attended (a late cancel is locked below).
  const graceEnds = Date.parse(appt.startAt) + NO_SHOW_GRACE_MIN * 60_000;
  const inGrace = current !== 'NO_SHOW' && window !== 'upcoming' && graceEnds > now.getTime();
  const stateFor = (outcome: Outcome): OptionState => {
    if (outcome === current) return 'current';
    if (window === 'upcoming') return 'notStarted';
    // A late cancel is final for Attended and No-show (the cancel flow records it and the server answers 409 CONFLICT).
    if (current === 'LATE_CANCEL') return 'locked';
    if (outcome === 'ATTENDED' && window === 'inProgress') return 'notEnded';
    if (outcome === 'NO_SHOW' && inGrace) return 'grace';
    return 'enabled';
  };
  return {
    open: true,
    current,
    window,
    noShowAvailableAt: inGrace ? new Date(graceEnds).toISOString() : null,
    options: {
      ATTENDED: stateFor('ATTENDED'),
      NO_SHOW: stateFor('NO_SHOW'),
      LATE_CANCEL: stateFor('LATE_CANCEL'),
    },
  };
}
