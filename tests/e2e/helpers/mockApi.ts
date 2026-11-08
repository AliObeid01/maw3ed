import type { Page, Route } from '@playwright/test';
import { freezeClock, nowMs } from './clock';
import { profileMissing } from '../../../src/lib/business/profile';
import { mergeWeekIntervals } from '../../../src/lib/setup/hoursMerge';
import { rules, validate, validateHours } from './serverRules';

/**
 * Stateful in-memory stand-in for the owner setup API. Every call is answered by page.route, so the
 * specs need no database. The dashboard layout needs a session: the e2e dev server runs with
 * E2E_FAKE_SESSION=1 (see playwright.config.ts and src/app/app/loadSession.ts).
 */
export type MockState = {
  business: Record<string, unknown> & { setup: Record<string, boolean> };
  services: Array<Record<string, unknown>>;
  staff: Array<Record<string, unknown>>;
  hours: Record<string, Array<{ weekday: number; startLocal: string; endLocal: string }>>;
  timeOff: Record<string, Array<Record<string, unknown>>>;
  invites: Array<Record<string, unknown>>;
  /** People with a login (GET /api/team). The caller is the one with isYou. */
  members: Array<Record<string, unknown>>;
  /** How many other sessions POST /api/auth/sign-out-others reports as removed. */
  otherSessions: number;
  /** Upcoming appointments left on a removed member's calendar entry, by userId (DELETE /api/team/members). */
  memberAppointments: Record<string, number>;
  /** Staff ids that still have future appointments: deactivating them answers 409 HAS_FUTURE_APPOINTMENTS. */
  staffWithFutureAppointments: string[];
  /** Emails that already belong to the business: inviting them answers 409 ALREADY_MEMBER. */
  memberEmails: string[];
};

export type MockCalls = { method: string; path: string; body?: unknown }[];

export function defaultState(): MockState {
  return {
    business: {
      id: 'b1',
      slug: 'studio-nour',
      name: 'Studio Nour',
      timezone: 'Asia/Beirut',
      locale: 'en',
      slotStepMin: 15,
      bookingWindowDays: 30,
      minNoticeMin: 60,
      cancelCutoffMin: 1440,
      category: null,
      area: null,
      address: null,
      listed: false,
      setup: { hasServices: true, hasBookableStaff: false, hasHours: false },
    },
    services: [
      {
        id: 's1',
        name: 'Haircut',
        durationMin: 30,
        bufferMin: 10,
        price: 15,
        active: true,
        sortOrder: 0,
      },
      {
        id: 's2',
        name: 'Blow-dry',
        durationMin: 45,
        bufferMin: 10,
        price: 20,
        active: true,
        sortOrder: 1,
      },
      {
        id: 's3',
        name: 'Hair colour',
        durationMin: 90,
        bufferMin: 15,
        price: 45,
        active: true,
        sortOrder: 2,
      },
      {
        id: 's4',
        name: 'Beard trim',
        durationMin: 20,
        bufferMin: 5,
        price: 8,
        active: true,
        sortOrder: 3,
      },
      {
        id: 's5',
        name: 'Manicure',
        durationMin: 40,
        bufferMin: 10,
        price: 18,
        active: false,
        sortOrder: 4,
      },
    ],
    staff: [
      {
        id: 'p1',
        displayName: 'Lina',
        bookable: true,
        active: true,
        role: 'OWNER',
        serviceIds: ['s1', 's2', 's3', 's4'],
      },
      {
        id: 'p2',
        displayName: 'Karim',
        bookable: true,
        active: true,
        role: null,
        serviceIds: ['s1', 's2', 's3'],
      },
      {
        id: 'p3',
        displayName: 'Jad',
        bookable: true,
        active: true,
        role: null,
        serviceIds: ['s1', 's4'],
      },
      {
        id: 'p4',
        displayName: 'Rana',
        bookable: false,
        active: true,
        role: 'STAFF',
        serviceIds: [],
      },
    ],
    hours: {
      p1: weekdayHours(),
      p2: weekdayHours(),
      p3: weekdayHours(),
    },
    timeOff: {
      p2: [
        {
          id: 't1',
          startAt: '2036-11-05T22:00:00Z',
          endAt: '2036-11-06T22:00:00Z',
          reason: 'VACATION',
        },
      ],
    },
    invites: [],
    members: [
      {
        userId: 'u1',
        name: 'Lina',
        email: 'lina@example.com',
        role: 'OWNER',
        emailVerified: true,
        isYou: true,
      },
      {
        userId: 'u2',
        name: 'Rana',
        email: 'rana@example.com',
        role: 'STAFF',
        emailVerified: true,
        isYou: false,
      },
      {
        userId: 'u3',
        name: 'Samir',
        email: 'samir@example.com',
        role: 'STAFF',
        emailVerified: false,
        isYou: false,
      },
    ],
    otherSessions: 2,
    memberAppointments: {},
    staffWithFutureAppointments: [],
    memberEmails: ['lina@example.com'],
  };
}

function weekdayHours() {
  const days = [1, 2, 4, 5].flatMap((weekday) => [
    { weekday, startLocal: '09:00', endLocal: '13:00' },
    { weekday, startLocal: '14:00', endLocal: '19:00' },
  ]);
  return [
    ...days,
    { weekday: 3, startLocal: '10:00', endLocal: '18:00' },
    { weekday: 6, startLocal: '09:00', endLocal: '16:00' },
  ];
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const error = (route: Route, status: number, code: string, fields?: Record<string, string>) =>
  json(route, status, { error: { code, message: code, ...(fields ? { fields } : {}) } });

export type MockOptions = {
  state?: MockState;
  /** Answer every request with this status: 401, 403 or 429 use the real error codes. */
  forceStatus?: number;
  /** Delay every answer (ms) to look at loading states. */
  delayMs?: number;
  /** Extra per-request override: return true if handled. */
  override?: (
    route: Route,
    method: string,
    path: string,
    body: unknown,
  ) => Promise<boolean> | boolean;
};

/** Registers the mock; returns the state and the list of calls the page made. */
export async function mockSetupApi(page: Page, options: MockOptions = {}) {
  await freezeClock(page);
  const state = options.state ?? defaultState();
  const calls: MockCalls = [];
  let counter = 100;
  let plan: 'FREE' | 'PRO' = 'FREE';

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method, path, body });

    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    if (options.forceStatus) {
      const codes: Record<number, string> = {
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        429: 'RATE_LIMITED',
      };
      return error(route, options.forceStatus, codes[options.forceStatus] ?? 'INTERNAL');
    }
    if (options.override && (await options.override(route, method, path, body))) return;

    if (path === '/api/auth/logout') return route.fulfill({ status: 204 });

    if (path.startsWith('/api/billing')) {
      const bookable = state.staff.filter((s) => s.active && s.bookable).length;
      if (path === '/api/billing/checkout' && method === 'POST') {
        // TEST MODE simulation: a declined scenario changes nothing (the server answers 409 PAYMENT_DECLINED).
        if ((body as { scenario?: string } | undefined)?.scenario === 'declined')
          return error(route, 409, 'PAYMENT_DECLINED', {});
        plan = 'PRO';
      }
      if (path === '/api/billing/downgrade' && method === 'POST') plan = 'FREE';
      return json(route, 200, {
        plan,
        limits: { bookableStaff: plan === 'PRO' ? null : 1 },
        usage: { bookableStaff: bookable },
        price: { amount: 9, currency: 'USD' },
        testMode: true,
      });
    }

    if (path === '/api/business') {
      if (method === 'PATCH') {
        const v = validate(rules.updateBusiness, body);
        if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
        // Same rule as businessService: a NEW listing needs a category and an area (grandfathered when already listed).
        if (v.data.listed === true && state.business.listed !== true) {
          const merged = { ...state.business, ...v.data } as { category?: string | null; area?: string | null };
          const missing = profileMissing({ category: merged.category, area: merged.area });
          if (missing.length > 0)
            return error(
              route,
              400,
              'VALIDATION_FAILED',
              Object.fromEntries(missing.map((f) => [f, `Choose a ${f} before listing.`])),
            );
        }
        Object.assign(state.business, v.data);
      }
      return json(route, 200, state.business);
    }

    if (path === '/api/services') {
      if (method === 'POST') {
        const v = validate(rules.createService, body);
        if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
        const created = {
          id: `s${++counter}`,
          active: true,
          sortOrder: state.services.length,
          ...v.data,
        };
        state.services.push(created);
        state.business.setup.hasServices = true;
        return json(route, 201, created);
      }
      return json(route, 200, { services: state.services });
    }
    const svc = /^\/api\/services\/([^/]+)$/.exec(path);
    if (svc) {
      const found = state.services.find((s) => s.id === svc[1]);
      if (!found) return error(route, 404, 'NOT_FOUND');
      const v = validate(rules.updateService, body);
      if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
      Object.assign(found, v.data);
      return json(route, 200, found);
    }

    if (path === '/api/staff') {
      if (method === 'POST') {
        const v = validate(rules.createStaff, body);
        if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
        const created = { id: `p${++counter}`, active: true, role: null, ...v.data };
        state.staff.push(created);
        return json(route, 201, created);
      }
      return json(route, 200, { staff: state.staff });
    }
    const staffServices = /^\/api\/staff\/([^/]+)\/services$/.exec(path);
    if (staffServices) {
      const found = state.staff.find((s) => s.id === staffServices[1]);
      if (!found) return error(route, 404, 'NOT_FOUND');
      const v = validate(rules.setStaffServices, body);
      if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
      found.serviceIds = v.data.serviceIds;
      return json(route, 200, { serviceIds: found.serviceIds });
    }
    const copyHours = /^\/api\/staff\/([^/]+)\/hours\/copy$/.exec(path);
    if (copyHours && method === 'POST') {
      const ids = (body as { targetStaffIds?: string[] } | undefined)?.targetStaffIds ?? [];
      const known = new Set(state.staff.map((m) => m.id));
      if (!known.has(copyHours[1]) || ids.some((x) => !known.has(x)))
        return error(route, 404, 'NOT_FOUND');
      const source = mergeWeekIntervals(state.hours[copyHours[1]!] ?? []);
      for (const x of ids) state.hours[x] = source.map((i) => ({ ...i }));
      return json(route, 200, {
        staff: ids.map((x) => ({ staffId: x, intervals: state.hours[x] })),
      });
    }
    const staffHours = /^\/api\/staff\/([^/]+)\/hours$/.exec(path);
    if (staffHours) {
      const id = staffHours[1]!;
      if (method === 'PUT') {
        const v = validateHours(body);
        if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
        // Like the server: touching blocks are stored as one.
        const intervals = mergeWeekIntervals(v.data.intervals);
        state.hours[id] = intervals;
        state.business.setup.hasHours = intervals.length > 0;
        return json(route, 200, { intervals });
      }
      return json(route, 200, { intervals: state.hours[id] ?? [] });
    }
    const timeOffItem = /^\/api\/staff\/([^/]+)\/time-off\/([^/]+)$/.exec(path);
    if (timeOffItem) {
      const list = state.timeOff[timeOffItem[1]!] ?? [];
      state.timeOff[timeOffItem[1]!] = list.filter((i) => i.id !== timeOffItem[2]);
      return route.fulfill({ status: 204 });
    }
    const timeOff = /^\/api\/staff\/([^/]+)\/time-off$/.exec(path);
    if (timeOff) {
      const id = timeOff[1]!;
      if (method === 'POST') {
        const v = validate(rules.createTimeOff, body);
        if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
        if (new Date(v.data.endAt) <= new Date(v.data.startAt))
          return error(route, 400, 'VALIDATION_ERROR', { endAt: 'End must be after start.' });
        const created = { id: `t${++counter}`, ...v.data };
        state.timeOff[id] = [...(state.timeOff[id] ?? []), created];
        return json(route, 201, created);
      }
      // Like the server: only upcoming and ongoing time off unless ?includePast=1.
      const includePast = ['1', 'true'].includes(url.searchParams.get('includePast') ?? '');
      const now = nowMs();
      const items = (state.timeOff[id] ?? []).filter(
        (i) => includePast || new Date(i.endAt as string).getTime() >= now,
      );
      return json(route, 200, { items });
    }
    const staffOne = /^\/api\/staff\/([^/]+)$/.exec(path);
    if (staffOne) {
      const found = state.staff.find((s) => s.id === staffOne[1]);
      if (!found) return error(route, 404, 'NOT_FOUND');
      const v = validate(rules.updateStaff, body);
      if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
      if (v.data.active === false && state.staffWithFutureAppointments.includes(found.id as string))
        return error(route, 409, 'HAS_FUTURE_APPOINTMENTS');
      Object.assign(found, v.data);
      return json(route, 200, found);
    }

    if (path === '/api/team' && method === 'GET') {
      // Newest invite first, like the server.
      const invites = [...state.invites]
        .reverse()
        .map((i) => ({ createdAt: new Date(nowMs()).toISOString(), ...i }));
      return json(route, 200, { members: state.members, invites });
    }
    const teamMember = /^\/api\/team\/members\/([^/]+)$/.exec(path);
    if (teamMember && method === 'DELETE') {
      const found = state.members.find((m) => m.userId === teamMember[1]);
      if (!found) return error(route, 404, 'NOT_FOUND');
      if (found.isYou) return error(route, 409, 'CANNOT_REMOVE_SELF');
      state.members = state.members.filter((m) => m !== found);
      return json(route, 200, {
        ok: true,
        futureAppointments: state.memberAppointments[found.userId as string] ?? 0,
      });
    }
    const teamInvite = /^\/api\/team\/invites\/([^/]+)$/.exec(path);
    if (teamInvite && method === 'DELETE') {
      const found = state.invites.find((i) => i.id === teamInvite[1]);
      if (!found) return error(route, 404, 'NOT_FOUND');
      state.invites = state.invites.filter((i) => i !== found);
      return json(route, 200, { ok: true });
    }
    if (path === '/api/auth/sign-out-others' && method === 'POST')
      return json(route, 200, { removed: state.otherSessions });

    if (path === '/api/invites') {
      if (method === 'POST') {
        const v = validate(rules.createInvite, body);
        if ('fields' in v) return error(route, 400, 'VALIDATION_ERROR', v.fields);
        if (state.memberEmails.includes(v.data.email.toLowerCase()))
          return error(route, 409, 'ALREADY_MEMBER');
        const created = {
          id: `i${++counter}`,
          expiresAt: '2036-11-12T10:00:00Z',
          ...v.data,
        };
        state.invites.push(created);
        return json(route, 201, created);
      }
      return json(route, 200, { invites: state.invites });
    }

    return error(route, 404, 'NOT_FOUND');
  });

  return { state, calls };
}

/** Marks the browser session as OWNER or STAFF (read by the fake-session switch in the dev server). */
export async function setRole(
  page: Page,
  role: 'OWNER' | 'STAFF' | 'PRACTITIONER',
  baseURL: string,
) {
  await freezeClock(page);
  await page.context().addCookies([{ name: 'e2e_role', value: role, url: baseURL }]);
}
