import type { Page, Route } from '@playwright/test';

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
      address: null,
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
  /** Answer every request with this status (for example 403 for a receptionist). */
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
  const state = options.state ?? defaultState();
  const calls: MockCalls = [];
  let counter = 100;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method, path, body });

    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    if (options.forceStatus) return error(route, options.forceStatus, 'FORBIDDEN');
    if (options.override && (await options.override(route, method, path, body))) return;

    if (path === '/api/auth/logout') return route.fulfill({ status: 204 });

    if (path === '/api/business') {
      if (method === 'PATCH') Object.assign(state.business, body);
      return json(route, 200, state.business);
    }

    if (path === '/api/services') {
      if (method === 'POST') {
        const created = {
          id: `s${++counter}`,
          active: true,
          sortOrder: state.services.length,
          ...body,
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
      Object.assign(found, body);
      return json(route, 200, found);
    }

    if (path === '/api/staff') {
      if (method === 'POST') {
        const created = { id: `p${++counter}`, active: true, role: null, ...body };
        state.staff.push(created);
        return json(route, 201, created);
      }
      return json(route, 200, { staff: state.staff });
    }
    const staffServices = /^\/api\/staff\/([^/]+)\/services$/.exec(path);
    if (staffServices) {
      const found = state.staff.find((s) => s.id === staffServices[1]);
      if (!found) return error(route, 404, 'NOT_FOUND');
      found.serviceIds = (body as { serviceIds: string[] }).serviceIds;
      return json(route, 200, { serviceIds: found.serviceIds });
    }
    const staffHours = /^\/api\/staff\/([^/]+)\/hours$/.exec(path);
    if (staffHours) {
      const id = staffHours[1]!;
      if (method === 'PUT') {
        const intervals = (body as { intervals: MockState['hours'][string] }).intervals;
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
        const created = { id: `t${++counter}`, ...body };
        state.timeOff[id] = [...(state.timeOff[id] ?? []), created];
        return json(route, 201, created);
      }
      return json(route, 200, { items: state.timeOff[id] ?? [] });
    }
    const staffOne = /^\/api\/staff\/([^/]+)$/.exec(path);
    if (staffOne) {
      const found = state.staff.find((s) => s.id === staffOne[1]);
      if (!found) return error(route, 404, 'NOT_FOUND');
      Object.assign(found, body);
      return json(route, 200, found);
    }

    if (path === '/api/invites') {
      if (method === 'POST') {
        const created = {
          id: `i${++counter}`,
          role: 'STAFF',
          expiresAt: '2036-11-12T10:00:00Z',
          ...body,
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
export async function setRole(page: Page, role: 'OWNER' | 'STAFF', baseURL: string) {
  await page.context().addCookies([{ name: 'e2e_role', value: role, url: baseURL }]);
}
