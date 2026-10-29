import type { PublicStaff } from '@/lib/api/booking';

/**
 * Booking flow state in the URL (`?step=&service=&staff=&day=&time=`), so the browser Back button works and
 * a link can be shared. Only the format is checked here; `resolveBookingState` checks values against the catalogue.
 */
export type BookingStep = 'service' | 'staff' | 'time' | 'details';

export const BOOKING_STEPS: readonly BookingStep[] = ['service', 'staff', 'time', 'details'];

export type BookingParams = {
  step?: BookingStep;
  service?: string;
  /** A staff id or the literal `anyone`. */
  staff?: string;
  /** Local date in the business timezone, `yyyy-MM-dd`. */
  day?: string;
  /** Local time in the business timezone, `HH:mm`. */
  time?: string;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Reader = { get(name: string): string | null };

/** Reads the params, dropping anything malformed. */
export function parseBookingParams(search: Reader): BookingParams {
  const out: BookingParams = {};
  const step = search.get('step');
  if (step && (BOOKING_STEPS as readonly string[]).includes(step)) out.step = step as BookingStep;
  const service = search.get('service');
  if (service && ID.test(service)) out.service = service;
  const staff = search.get('staff');
  if (staff && ID.test(staff)) out.staff = staff;
  const day = search.get('day');
  if (day && DAY.test(day)) out.day = day;
  const time = search.get('time');
  if (time && TIME.test(time)) out.time = time;
  return out;
}

/** Query string with a stable key order, `''` when empty, otherwise starting with `?`. */
export function serialiseBookingParams(params: BookingParams): string {
  const query = new URLSearchParams();
  for (const key of ['step', 'service', 'staff', 'day', 'time'] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export type ResolvedBooking = {
  step: BookingStep;
  serviceId?: string;
  /** Chosen staff id, `anyone`, or the only eligible person when the staff step is skipped. */
  staffId?: string;
  /** True when exactly one person offers the service, so the staff step is not shown. */
  staffSkipped: boolean;
  /** People who offer the chosen service. */
  eligible: PublicStaff[];
  day?: string;
  time?: string;
};

/**
 * Turns raw params into a consistent state: unknown ids are dropped, the staff step is skipped when one
 * person offers the service, and the step never runs ahead of what has been chosen.
 */
export function resolveBookingState(
  params: BookingParams,
  catalogue: { services: { id: string }[]; staff: PublicStaff[] },
): ResolvedBooking {
  const service = catalogue.services.find((s) => s.id === params.service);
  if (!service) return { step: 'service', staffSkipped: false, eligible: [] };

  const eligible = catalogue.staff.filter((s) => s.serviceIds.includes(service.id));
  const staffSkipped = eligible.length === 1;
  let staffId: string | undefined;
  if (staffSkipped) staffId = eligible[0]!.id;
  else if (params.staff === 'anyone' && eligible.length > 0) staffId = 'anyone';
  else if (eligible.some((s) => s.id === params.staff)) staffId = params.staff;

  const base = { serviceId: service.id, staffSkipped, eligible };
  if (!staffId) return { ...base, step: 'staff' };

  const day = params.day;
  const time = day ? params.time : undefined;
  const chosen = { ...base, staffId, day, time };
  if (params.step === 'details' && day && time) return { ...chosen, step: 'details' };
  return { ...chosen, step: 'time' };
}

/** Where the Back button goes from the current state. `undefined` on the first step. */
export function backParams(state: ResolvedBooking): BookingParams | undefined {
  switch (state.step) {
    case 'details':
      return {
        step: 'time',
        service: state.serviceId,
        staff: state.staffId,
        day: state.day,
        time: state.time,
      };
    case 'time':
      return state.staffSkipped ? {} : { step: 'staff', service: state.serviceId };
    case 'staff':
      return {};
    default:
      return undefined;
  }
}
