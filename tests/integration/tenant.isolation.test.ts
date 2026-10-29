import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { POST as postAppointment } from '@/app/api/appointments/route';
import { PATCH as patchOutcomeRoute } from '@/app/api/appointments/[id]/outcome/route';
import { GET as listClientsRoute } from '@/app/api/clients/route';
import { DELETE as deleteClientRoute, GET as getClientRoute } from '@/app/api/clients/[id]/route';
import { GET as dashboardSummaryRoute } from '@/app/api/dashboard/summary/route';
import { GET as dashboardTodayRoute } from '@/app/api/dashboard/today/route';
import { GET as outcomesQueueRoute } from '@/app/api/outcomes/queue/route';
import { GET as getBaselineRoute, PUT as putBaselineRoute } from '@/app/api/pilot/baseline/route';
import { GET as exportCsvRoute } from '@/app/api/pilot/export.csv/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { GET as previewInvite } from '@/app/api/invites/[token]/route';
import { GET as me } from '@/app/api/me/route';
import { PATCH as patchService } from '@/app/api/services/[id]/route';
import { GET as listServices, POST as postService } from '@/app/api/services/route';
import { PATCH as patchStaff } from '@/app/api/staff/[id]/route';
import { GET as getHours } from '@/app/api/staff/[id]/hours/route';
import { PUT as putStaffServices } from '@/app/api/staff/[id]/services/route';
import { GET as listTimeOff } from '@/app/api/staff/[id]/time-off/route';
import { GET as listStaff, POST as postStaff } from '@/app/api/staff/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { loginThrottle } from '@/server/services/loginThrottle';
import { call, signup } from './helpers/api';
import { at, bookingBody, bookPublicly, newScenario, NOW } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

/**
 * Tenant isolation scaffold. Two businesses; business A's session must never see or touch business B's
 * data on any route that exists. Entries for later routes are `it.todo` and are filled in as each
 * resource lands (P2).
 */
let pg: Client;
let a: Awaited<ReturnType<typeof signup>>;
let b: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
  loginThrottle.reset();
  fakeEmailProvider.reset();
  a = await signup({ businessName: 'Business A', slug: 'business-a' });
  b = await signup({ businessName: 'Business B', slug: 'business-b' });
});

describe('tenant isolation: routes that exist now', () => {
  it('/api/me only ever returns the session’s own user and business', async () => {
    const ra = await call(me, '/api/me', { cookie: a.cookie });
    const rb = await call(me, '/api/me', { cookie: b.cookie });
    expect(ra.body!.business.id).toBe(a.info.business.id);
    expect(rb.body!.business.id).toBe(b.info.business.id);
    expect(JSON.stringify(ra.body)).not.toContain(b.info.business.id);
    expect(JSON.stringify(ra.body)).not.toContain(b.info.user.id);
    expect(JSON.stringify(ra.body)).not.toContain(b.body.email);
  });

  it('/api/me ignores a businessId supplied by the client', async () => {
    const res = await call(me, '/api/me', {
      cookie: a.cookie,
      query: { businessId: b.info.business.id },
      headers: { 'x-business-id': b.info.business.id },
    });
    expect(res.status).toBe(200);
    expect(res.body!.business.id).toBe(a.info.business.id);
  });

  it('invites created by A belong to A and the body cannot name another business', async () => {
    const created = await call(createInvite, '/api/invites', {
      body: { email: 'x@example.test', role: 'STAFF' },
      cookie: a.cookie,
    });
    expect(created.status).toBe(201);
    const rows = (await pg.query('SELECT "businessId" FROM "Invite"')).rows;
    expect(rows).toEqual([{ businessId: a.info.business.id }]);

    const forged = await call(createInvite, '/api/invites', {
      body: { email: 'y@example.test', role: 'STAFF', businessId: b.info.business.id },
      cookie: a.cookie,
    });
    expect(forged.status).toBe(400);
    expect(
      (await pg.query('SELECT 1 FROM "Invite" WHERE "businessId" = $1', [b.info.business.id]))
        .rowCount,
    ).toBe(0);
  });

  it('A re-inviting an email never replaces or reveals B’s open invite for the same email', async () => {
    const forB = await call(createInvite, '/api/invites', {
      body: { email: 'shared@example.test', role: 'STAFF' },
      cookie: b.cookie,
    });
    const tokenB = forB.body!.acceptUrl.split('/invite/')[1];
    await call(createInvite, '/api/invites', {
      body: { email: 'shared@example.test', role: 'STAFF' },
      cookie: a.cookie,
    });
    const prev = await call(previewInvite, `/api/invites/${tokenB}`, { params: { token: tokenB } });
    expect(prev.status).toBe(200);
    expect(prev.body!.businessName).toBe('Business B');
    expect((await pg.query('SELECT 1 FROM "Invite"')).rowCount).toBe(2);
  });

  it('a session is bound to its business: A’s cookie cannot act as B even for the same user id', async () => {
    const sessions = (await pg.query('SELECT "businessId", "userId" FROM "Session"')).rows;
    expect(new Set(sessions.map((s) => s.businessId)).size).toBe(2);
    const res = await call(me, '/api/me', { cookie: a.cookie });
    expect(res.body!.role).toBe('OWNER');
    expect(res.body!.business.slug).toBe('business-a');
  });
});

/** One booking in each business (public engine), under a frozen clock. */
async function twoBookings() {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  const prisma = newPrisma();
  try {
    const aScn = await newScenario(prisma, { businessId: a.info.business.id });
    const bScn = await newScenario(prisma, { businessId: b.info.business.id });
    const ra = await bookPublicly(
      a.body.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00')),
    );
    const rb = await bookPublicly(
      b.body.slug,
      bookingBody(bScn.serviceId, bScn.staffIds[0]!, at('07:00')),
    );
    return { aAppt: ra.body!.appointment.id as string, bAppt: rb.body!.appointment.id as string };
  } finally {
    vi.useRealTimers();
    await prisma.$disconnect();
  }
}

describe('tenant isolation: arrives with later routes (P2)', () => {
  it('GET /api/appointments/{id} with business B’s id and A’s session -> 404', async () => {
    const { bAppt } = await twoBookings();
    const res = await call(getAppointment, `/api/appointments/${bAppt}`, {
      cookie: a.cookie,
      params: { id: bAppt },
    });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Client');
  });
  it('POST /api/appointments/{id}/cancel cross-tenant -> 404 and B’s row unchanged (no PATCH/DELETE routes exist)', async () => {
    const { bAppt } = await twoBookings();
    const res = await call(cancelAppointment, `/api/appointments/${bAppt}/cancel`, {
      method: 'POST',
      cookie: a.cookie,
      params: { id: bAppt },
    });
    expect(res.status).toBe(404);
    expect(
      (await pg.query('SELECT status FROM "Appointment" WHERE id = $1', [bAppt])).rows[0].status,
    ).toBe('BOOKED');
    expect(
      (
        await pg.query(`SELECT DISTINCT status FROM "ReminderJob" WHERE "appointmentId" = $1`, [
          bAppt,
        ])
      ).rows,
    ).toEqual([{ status: 'PENDING' }]);
    const routeModule = await import('@/app/api/appointments/[id]/route');
    expect(Object.keys(routeModule)).not.toContain('PATCH');
    expect(Object.keys(routeModule)).not.toContain('DELETE');
  });
  it('GET /api/clients/{id} cross-tenant -> 404', async () => {
    const { bAppt } = await twoBookings();
    const bClient = (await pg.query('SELECT "clientId" FROM "Appointment" WHERE id = $1', [bAppt]))
      .rows[0].clientId as string;
    const res = await call(getClientRoute, `/api/clients/${bClient}`, {
      cookie: a.cookie,
      params: { id: bClient },
    });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Client');
  });
  it('GET /api/clients list never includes business B’s clients', async () => {
    const { aAppt, bAppt } = await twoBookings();
    const idOf = async (appt: string) =>
      (await pg.query('SELECT "clientId" FROM "Appointment" WHERE id = $1', [appt])).rows[0]
        .clientId as string;
    const list = await call(listClientsRoute, '/api/clients', { cookie: a.cookie });
    expect(list.status).toBe(200);
    expect(list.body!.clients.map((c: { id: string }) => c.id)).toEqual([await idOf(aAppt)]);
    expect(JSON.stringify(list.body)).not.toContain(await idOf(bAppt));
  });
  it('DELETE /api/clients/{id} cross-tenant -> 404 and B’s client is untouched', async () => {
    const { bAppt } = await twoBookings();
    const bClient = (await pg.query('SELECT "clientId" FROM "Appointment" WHERE id = $1', [bAppt]))
      .rows[0].clientId as string;
    const res = await call(deleteClientRoute, `/api/clients/${bClient}`, {
      method: 'DELETE',
      cookie: a.cookie,
      params: { id: bClient },
    });
    expect(res.status).toBe(404);
    expect(
      (await pg.query('SELECT name FROM "Client" WHERE id = $1', [bClient])).rows[0].name,
    ).toBe('Client');
    expect(
      (await pg.query('SELECT status FROM "Appointment" WHERE id = $1', [bAppt])).rows[0].status,
    ).toBe('BOOKED');
  });
  it('PATCH /api/appointments/{id}/outcome cross-tenant -> 404 and B’s counters are untouched', async () => {
    const { bAppt } = await twoBookings();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T00:00:00Z') });
    try {
      const res = await call(patchOutcomeRoute, `/api/appointments/${bAppt}/outcome`, {
        method: 'PATCH',
        cookie: a.cookie,
        params: { id: bAppt },
        body: { outcome: 'NO_SHOW' },
      });
      expect(res.status).toBe(404);
    } finally {
      vi.useRealTimers();
    }
    expect(
      (await pg.query('SELECT status FROM "Appointment" WHERE id = $1', [bAppt])).rows[0].status,
    ).toBe('BOOKED');
    expect((await pg.query('SELECT sum("noShows")::int AS n FROM "Client"')).rows[0].n).toBe(0);
  });
  it('GET /api/outcomes/queue and /api/dashboard/* never include business B’s appointments', async () => {
    const { aAppt, bAppt } = await twoBookings();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T00:00:00Z') });
    try {
      const q = await call(outcomesQueueRoute, '/api/outcomes/queue', { cookie: a.cookie });
      expect(q.body!.items.map((i: { id: string }) => i.id)).toEqual([aAppt]);
      expect(q.body!.count).toBe(1);
      const s = await call(dashboardSummaryRoute, '/api/dashboard/summary', { cookie: a.cookie });
      expect(s.body!.outcomesToMark).toBe(1);
      const d = await call(dashboardTodayRoute, '/api/dashboard/today', {
        cookie: a.cookie,
        query: { date: '2026-11-04' },
      });
      expect(JSON.stringify(d.body)).not.toContain(bAppt);
      expect(d.body!.appointments.map((x: { id: string }) => x.id)).toEqual([aAppt]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('pilot baseline, report and export only ever read the session business', async () => {
    const put = await call(putBaselineRoute, '/api/pilot/baseline', {
      method: 'PUT',
      cookie: b.cookie,
      body: {
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
        appointments: 80,
        noShows: 10,
        lateCancels: 1,
      },
    });
    expect(put.status).toBe(200);
    const mine = await call(getBaselineRoute, '/api/pilot/baseline', { cookie: a.cookie });
    expect(mine.body).toEqual({ baseline: null });
    await twoBookings();
    const url = new URL('http://localhost/api/pilot/export.csv?from=2026-11-04&to=2026-11-04');
    const csv = await (
      await exportCsvRoute(new Request(url, { headers: { cookie: a.cookie } }))
    ).text();
    expect(csv.trim().split('\r\n')).toHaveLength(2); // header + A's single booking
  });
  it('PATCH /api/services/{id} cross-tenant -> 404 and B’s row unchanged (no DELETE route exists)', async () => {
    const sb = await call(postService, '/api/services', {
      cookie: b.cookie,
      body: { name: 'B cut', durationMin: 30, price: 10 },
    });
    const res = await call(patchService, `/api/services/${sb.body!.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      params: { id: sb.body!.id },
      body: { name: 'Mine', active: false },
    });
    expect(res.status).toBe(404);
    expect(
      (await pg.query('SELECT name, active FROM "Service" WHERE id = $1', [sb.body!.id])).rows[0],
    ).toEqual({ name: 'B cut', active: true });
    const routeModule = await import('@/app/api/services/[id]/route');
    expect(Object.keys(routeModule)).not.toContain('DELETE');
  });
  it('GET /api/services list never includes business B’s services', async () => {
    const sb = await call(postService, '/api/services', {
      cookie: b.cookie,
      body: { name: 'B cut', durationMin: 30, price: 10 },
    });
    const list = await call(listServices, '/api/services', { cookie: a.cookie });
    expect(list.body!.services).toEqual([]);
    expect(JSON.stringify(list.body)).not.toContain(sb.body!.id);
  });
  it('GET /api/staff never lists B’s staff; PATCH, PUT services/hours and time-off on B’s staff id -> 404', async () => {
    const mb = await call(postStaff, '/api/staff', {
      cookie: b.cookie,
      body: { displayName: 'B person', bookable: true, serviceIds: [] },
    });
    const id = mb.body!.id;
    const list = await call(listStaff, '/api/staff', { cookie: a.cookie });
    expect(JSON.stringify(list.body)).not.toContain(id);
    const opts = { cookie: a.cookie, params: { id } };
    expect(
      (
        await call(patchStaff, `/api/staff/${id}`, {
          ...opts,
          method: 'PATCH',
          body: { active: false },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(putStaffServices, `/api/staff/${id}/services`, {
          ...opts,
          method: 'PUT',
          body: { serviceIds: [] },
        })
      ).status,
    ).toBe(404);
    expect((await call(getHours, `/api/staff/${id}/hours`, opts)).status).toBe(404);
    expect((await call(listTimeOff, `/api/staff/${id}/time-off`, opts)).status).toBe(404);
    expect(
      (await pg.query('SELECT active FROM "StaffMember" WHERE id = $1', [id])).rows[0].active,
    ).toBe(true);
  });
  it('POST /api/appointments with B’s serviceId or staffId from A’s session -> 404', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const prisma = newPrisma();
    try {
      const aScn = await newScenario(prisma, { businessId: a.info.business.id });
      const bScn = await newScenario(prisma, { businessId: b.info.business.id });
      const withB = await call(postAppointment, '/api/appointments', {
        cookie: a.cookie,
        body: bookingBody(bScn.serviceId, aScn.staffIds[0]!, at('07:00')),
      });
      expect(withB.status).toBe(404);
      const staffB = await call(postAppointment, '/api/appointments', {
        cookie: a.cookie,
        body: bookingBody(aScn.serviceId, bScn.staffIds[0]!, at('07:00')),
      });
      expect(staffB.status).toBe(404);
      expect((await pg.query('SELECT 1 FROM "Appointment"')).rowCount).toBe(0);
    } finally {
      vi.useRealTimers();
      await prisma.$disconnect();
    }
  });
});
