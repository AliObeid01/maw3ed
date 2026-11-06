import type { Page, Route } from '@playwright/test';
import { DateTime } from 'luxon';
import { clockNow } from './clock';

/**
 * In-memory stand-in for the barber's (PRACTITIONER) scoped APIs, answered by page.route. It returns the BARBER
 * shapes: the client's first name and phone only, no e-mail, counters or reminder fields. Anything else a barber
 * must not call answers 403 like the server. Fake values only: obviously fake Lebanese numbers.
 */
export const TZ = 'Asia/Beirut';
const iso = (dt: DateTime) => dt.toUTC().toISO({ suppressMilliseconds: true })!;
export const local = (hour: number, minute = 0) =>
  clockNow().setZone(TZ).set({ hour, minute, second: 0, millisecond: 0 });
export const OWN = { id: 'staff-lina', displayName: 'Lina' };

export type BarberAppt = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  confirmedAt: string | null;
  service: { id: string; name: string; durationMin: number };
  staff: typeof OWN;
  client: { name: string; phone: string };
};
const cut = { id: 'svc-cut', name: 'Haircut', durationMin: 30 };

export function makeState() {
  const mk = (
    id: string,
    start: DateTime,
    name: string,
    phone: string,
    extra: Partial<BarberAppt> = {},
  ): BarberAppt => ({
    id,
    startAt: iso(start),
    endAt: iso(start.plus({ minutes: 30 })),
    status: 'BOOKED',
    confirmedAt: null,
    service: cut,
    staff: OWN,
    client: { name, phone },
    ...extra,
  });
  // The clock is Wed 4 Nov 2026, 10:00 in Beirut. a-ended finished at 09:00, a-started began 2 minutes ago.
  return {
    appts: [
      mk('a-ended', local(8, 30), 'Rana', '+96170000011'),
      mk('a-started', clockNow().setZone(TZ).minus({ minutes: 2 }), 'Dana', '+96170000012'),
      mk('a-later', local(14), 'Karim', '+96170000013', {
        status: 'CONFIRMED',
        confirmedAt: iso(local(7)),
      }),
    ],
    calls: [] as { method: string; path: string; body?: unknown }[],
    /** true: the login is not linked to an active team member (403 on every scoped route). */
    noSchedule: false,
  };
}
export type BarberState = ReturnType<typeof makeState>;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string) =>
  json(route, status, { error: { code, message: code, fields: {} } });

export async function mockBarberApi(page: Page, state: BarberState = makeState()) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    state.calls.push({ method, path, body: req.postDataJSON() ?? undefined });
    const now = clockNow();
    const queue = () =>
      state.appts.filter(
        (a) => ['BOOKED', 'CONFIRMED'].includes(a.status) && Date.parse(a.endAt) <= now.toMillis(),
      );

    if (state.noSchedule && path !== '/api/me') return err(route, 403, 'FORBIDDEN');
    if (path === '/api/dashboard/today') {
      const date = url.searchParams.get('date') ?? now.setZone(TZ).toISODate()!;
      const day = state.appts.filter(
        (a) => DateTime.fromISO(a.startAt).setZone(TZ).toISODate() === date,
      );
      return json(route, 200, {
        date,
        timezone: TZ,
        stats: { appointments: day.length },
        outcomesToMark: queue().length,
        staff: [OWN],
        appointments: day,
      });
    }
    if (path === '/api/outcomes/queue')
      return json(route, 200, {
        count: queue().length,
        items: queue().map((a) => ({
          id: a.id,
          startAt: a.startAt,
          endAt: a.endAt,
          service: { id: a.service.id, name: a.service.name },
          staff: a.staff,
          client: a.client,
        })),
      });
    const outcome = /^\/api\/appointments\/([^/]+)\/outcome$/.exec(path);
    if (outcome && method === 'PATCH') {
      const a = state.appts.find((x) => x.id === outcome[1]);
      if (!a) return err(route, 404, 'NOT_FOUND');
      a.status = (req.postDataJSON() as { outcome: string }).outcome;
      return json(route, 200, {
        appointment: { id: a.id, status: a.status, startAt: a.startAt, endAt: a.endAt, client: a.client },
      });
    }
    const one = /^\/api\/appointments\/([^/]+)$/.exec(path);
    if (one && method === 'GET') {
      const a = state.appts.find((x) => x.id === one[1]);
      return a ? json(route, 200, { appointment: a }) : err(route, 404, 'NOT_FOUND');
    }
    return err(route, 403, 'FORBIDDEN');
  });
  return state;
}

/** A barber may only ever call these (and the auth ones). Anything else would be a 403 in production. */
const ALLOWED_API = [
  /^\/api\/dashboard\/today$/,
  /^\/api\/outcomes\/queue$/,
  /^\/api\/appointments\/[^/]+$/,
  /^\/api\/appointments\/[^/]+\/outcome$/,
  /^\/api\/auth\//,
  /^\/api\/me$/,
];
export const forbiddenCalls = (state: BarberState) =>
  state.calls.filter((c) => !ALLOWED_API.some((r) => r.test(c.path))).map((c) => c.path);
