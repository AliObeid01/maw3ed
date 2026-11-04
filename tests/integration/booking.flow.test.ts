import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Client } from 'pg';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  DAY,
  getSlots,
  newScenario,
  newTenant,
  NOW,
  startsOf,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let t: Tenant;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  t = await newTenant();
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});

const rowCount = async (serviceId: string) =>
  (await pg.query(`SELECT 1 FROM "Appointment" WHERE "serviceId" = $1`, [serviceId])).rowCount;

describe('the friendly re-check refuses stale or impossible starts', () => {
  it.each([
    ['in the past', '2026-11-01T07:00:00.000Z'],
    ['inside the minimum notice (60 min)', '2026-11-02T08:30:00.000Z'],
    ['not on the 15 minute grid', at('07:07')],
    ['outside working hours', at('03:00')],
    ['after closing', at('14:45')], // 16:45 local: a 30 min slot would end after 17:00
    ['beyond the booking window (30 days)', '2026-12-20T07:00:00.000Z'],
  ])('%s -> 409 SLOT_TAKEN with fresh slots and no row', async (_label, startAt) => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, startAt));
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('SLOT_TAKEN');
    expect(Array.isArray(res.body!.error.data.slots)).toBe(true);
    expect(await rowCount(serviceId)).toBe(0);
  });

  it('the earliest legal slot is bookable (now + min notice, on the grid)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    // now 08:00Z + 60 min = 09:00Z (11:00 Beirut)
    const res = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, '2026-11-02T09:00:00.000Z'),
    );
    expect(res.status).toBe(201);
  });

  it('rejects an invalid phone with 400 fields["client.phone"] and creates nothing', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const res = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, at('07:00'), { phone: 'call me maybe' }),
    );
    expect(res.status).toBe(400);
    expect(res.body!.error.fields['client.phone']).toBeTruthy();
    expect(await rowCount(serviceId)).toBe(0);
  });

  it('a service of another business -> 404; a staff member who does not offer it -> 400', async () => {
    const other = await newTenant();
    const mine = await newScenario(prisma, t);
    const theirs = await newScenario(prisma, other);
    const foreignService = await bookPublicly(
      t.slug,
      bookingBody(theirs.serviceId, mine.staffIds[0]!, at('07:00')),
    );
    expect(foreignService.status).toBe(404);
    const foreignStaff = await bookPublicly(
      t.slug,
      bookingBody(mine.serviceId, theirs.staffIds[0]!, at('07:00')),
    );
    expect(foreignStaff.status).toBe(404);
    const second = await newScenario(prisma, t);
    const notOffered = await bookPublicly(
      t.slug,
      bookingBody(mine.serviceId, second.staffIds[0]!, at('07:00')),
    );
    expect(notOffered.status).toBe(400);
    expect(notOffered.body!.error.fields.staffId).toBeTruthy();
  });

  it('an inactive service or a non-bookable staff member cannot be booked', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 2 });
    await prisma.staffMember.update({ where: { id: staffIds[1]! }, data: { bookable: false } });
    const hidden = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[1]!, at('07:00')));
    expect(hidden.status).toBe(400);
    await prisma.service.update({ where: { id: serviceId }, data: { active: false } });
    const gone = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    expect(gone.status).toBe(404);
  });
});

describe('"anyone" fairness', () => {
  it('picks the staff member with the fewest bookings that local day', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 2 });
    const sorted = [...staffIds].sort();
    // give the lowest-id staff member one booking that day; the next "anyone" must go to the other
    const first = await bookPublicly(t.slug, bookingBody(serviceId, sorted[0]!, at('07:00')));
    expect(first.status).toBe(201);
    const next = await bookPublicly(t.slug, bookingBody(serviceId, 'anyone', at('08:00')));
    expect(next.body!.appointment.staff.id).toBe(sorted[1]);
  });
});

describe('reminder jobs (FR-15)', () => {
  const jobs = async (appointmentId: string) =>
    (
      await pg.query(
        `SELECT kind, channel, "dueAt", status FROM "ReminderJob" WHERE "appointmentId" = $1`,
        [appointmentId],
      )
    ).rows.map((r) => ({
      key: `${r.kind}/${r.channel}`,
      dueAt: (r.dueAt as Date).toISOString(),
      status: r.status as string,
    }));

  it('booked far ahead: BOOKING + H24 + H2 on both channels with the right dueAt, same transaction', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const res = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, '2026-11-06T07:00:00.000Z'),
    );
    expect(res.status).toBe(201);
    const rows = await jobs(res.body!.appointment.id);
    expect(rows.map((r) => r.key).sort()).toEqual(
      ['BOOKING/EMAIL', 'H24/EMAIL', 'H24/WHATSAPP', 'H2/EMAIL', 'H2/WHATSAPP'].sort(),
    );
    const due = Object.fromEntries(rows.map((r) => [r.key, r.dueAt]));
    expect(due['BOOKING/EMAIL']).toBe(NOW.toISOString());
    expect(due['H24/EMAIL']).toBe('2026-11-05T07:00:00.000Z');
    expect(due['H24/WHATSAPP']).toBe('2026-11-05T07:00:00.000Z');
    expect(due['H2/EMAIL']).toBe('2026-11-06T05:00:00.000Z');
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
  });

  it('booked less than 24 h ahead: no H24; less than 2 h ahead: no H2', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const under24 = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, '2026-11-03T07:00:00.000Z'), // 23 h ahead
    );
    expect((await jobs(under24.body!.appointment.id)).map((r) => r.key).sort()).toEqual(
      ['BOOKING/EMAIL', 'H2/EMAIL', 'H2/WHATSAPP'].sort(),
    );
    const under2 = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, '2026-11-02T09:30:00.000Z'), // 1.5 h ahead
    );
    expect(under2.status).toBe(201);
    // F68: a PUBLIC booking under 2 h ahead gets one WhatsApp LATE row instead (see whatsapp.late.test.ts).
    expect((await jobs(under2.body!.appointment.id)).map((r) => r.key).sort()).toEqual(
      ['BOOKING/EMAIL', 'LATE/WHATSAPP'].sort(),
    );
  });

  it('cancelling frees the slot and marks pending jobs SKIPPED; cancel is idempotent', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const start = at('07:00');
    const booked = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, start));
    const id = booked.body!.appointment.id as string;
    // one job already SENT must stay SENT
    await pg.query(
      `UPDATE "ReminderJob" SET status = 'SENT' WHERE "appointmentId" = $1 AND kind = 'BOOKING'`,
      [id],
    );

    const res = await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie: t.cookie,
      params: { id },
    });
    expect(res.status).toBe(200);
    expect(res.body!.appointment.status).toBe('CANCELLED');
    const row = (
      await pg.query(
        `SELECT status, "cancelledVia", "cancelledAt" FROM "Appointment" WHERE id = $1`,
        [id],
      )
    ).rows[0];
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelledVia).toBe('STAFF');
    expect(row.cancelledAt).toBeInstanceOf(Date);

    const after = await jobs(id);
    expect(after.find((j) => j.key === 'BOOKING/EMAIL')!.status).toBe('SENT');
    expect(
      after.filter((j) => j.key !== 'BOOKING/EMAIL').every((j) => j.status === 'SKIPPED'),
    ).toBe(true);

    const again = await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie: t.cookie,
      params: { id },
    });
    expect(again.status).toBe(200);

    const slots = await getSlots(t.slug, { serviceId, from: DAY, to: DAY });
    expect(startsOf(slots.body!.slots)).toContain(start);
    const rebook = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, start));
    expect(rebook.status).toBe(201);
  });

  it('an appointment that already has an outcome cannot be cancelled (409)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const booked = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    const id = booked.body!.appointment.id as string;
    await pg.query(`UPDATE "Appointment" SET status = 'ATTENDED' WHERE id = $1`, [id]);
    const res = await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie: t.cookie,
      params: { id },
    });
    expect(res.status).toBe(409);
  });
});

describe('client upsert by phone', () => {
  it('B1: a PUBLIC booking never replaces an existing client’s name or email (the record is only set when the booking creates it)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const clients = async () =>
      (
        await pg.query(
          `SELECT name, email, phone FROM "Client" WHERE "businessId" = $1 AND phone = '+96171987654'`,
          [t.businessId],
        )
      ).rows;

    const a = await bookPublicly(t.slug, {
      ...bookingBody(serviceId, staffIds[0]!, at('07:00')),
      client: { name: 'Rana', phone: '71 987 654', email: 'rana@example.test' },
    });
    const b = await bookPublicly(t.slug, {
      ...bookingBody(serviceId, staffIds[0]!, at('08:00')),
      client: { name: 'Rana K', phone: '+961 71 987 654', email: 'Rana.K@Example.test' },
    });
    expect([a.status, b.status]).toEqual([201, 201]);
    // different phone formats share one Client; an existing record is never changed by a public booking
    expect(await clients()).toEqual([
      { name: 'Rana', email: 'rana@example.test', phone: '+96171987654' },
    ]);
    // the hijack attempt: victim's phone with another name and email changes nothing
    const evil = await bookPublicly(t.slug, {
      ...bookingBody(serviceId, staffIds[0]!, at('10:00')),
      client: { name: 'Mallory', phone: '71 987 654', email: 'mallory@evil.test' },
    });
    expect(evil.status).toBe(201);
    expect(await clients()).toEqual([
      { name: 'Rana', email: 'rana@example.test', phone: '+96171987654' },
    ]);
    const ids = await pg.query(
      `SELECT DISTINCT "clientId" FROM "Appointment" WHERE "serviceId" = $1`,
      [serviceId],
    );
    expect(ids.rowCount).toBe(1);
  });

  it('F68: the now-required public email never fills a record that has none (front-desk record without email)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    // Front desk creates the record with NO email (still allowed there).
    const desk = await bookAtFrontDesk(t.cookie, {
      ...bookingBody(serviceId, staffIds[0]!, at('07:00')),
      client: { name: 'Hadi', phone: '71 444 555' },
    });
    expect(desk.status).toBe(201);
    const pub = await bookPublicly(t.slug, {
      ...bookingBody(serviceId, staffIds[0]!, at('08:00')),
      client: { name: 'Stranger', phone: '71 444 555', email: 'stranger@evil.test' },
    });
    expect(pub.status).toBe(201);
    const rec = await pg.query(
      `SELECT name, email FROM "Client" WHERE "businessId" = $1 AND phone = '+96171444555'`,
      [t.businessId],
    );
    expect(rec.rows).toEqual([{ name: 'Hadi', email: null }]);
    // The typed address lives on the appointment only.
    const appt = await pg.query(
      `SELECT "contactEmail", "contactName" FROM "Appointment" WHERE id = $1`,
      [pub.body!.appointment.id],
    );
    expect(appt.rows).toEqual([{ contactEmail: 'stranger@evil.test', contactName: 'Stranger' }]);
  });

  it('B1: a session-authenticated FRONT DESK booking may update name and email', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    await bookPublicly(t.slug, {
      ...bookingBody(serviceId, staffIds[0]!, at('07:00')),
      client: { name: 'Lina', phone: '71 765 432', email: 'lina@example.test' },
    });
    const desk = await bookAtFrontDesk(t.cookie, {
      ...bookingBody(serviceId, staffIds[0]!, at('08:00')),
      client: { name: 'Lina Haddad', phone: '71 765 432', email: 'lina.new@example.test' },
    });
    expect(desk.status).toBe(201);
    const row = (
      await pg.query(`SELECT name, email FROM "Client" WHERE "businessId" = $1 AND phone = $2`, [
        t.businessId,
        '+96171765432',
      ])
    ).rows;
    expect(row).toEqual([{ name: 'Lina Haddad', email: 'lina.new@example.test' }]);
    // omitted email never wipes
    await bookAtFrontDesk(t.cookie, {
      ...bookingBody(serviceId, staffIds[0]!, at('09:00')),
      client: { name: 'Lina Haddad', phone: '71 765 432' },
    });
    const again = await pg.query(
      `SELECT email FROM "Client" WHERE phone = '+96171765432' AND "businessId" = $1`,
      [t.businessId],
    );
    expect(again.rows[0].email).toBe('lina.new@example.test');
  });

  it('the same phone in two businesses is two clients', async () => {
    const other = await newTenant();
    const a = await newScenario(prisma, t);
    const b = await newScenario(prisma, other);
    const client = { name: 'Sam', phone: '71 222 333', email: 'sam@example.test' };
    await bookPublicly(t.slug, {
      ...bookingBody(a.serviceId, a.staffIds[0]!, at('07:00')),
      client,
    });
    await bookPublicly(other.slug, {
      ...bookingBody(b.serviceId, b.staffIds[0]!, at('07:00')),
      client,
    });
    const rows = await pg.query(`SELECT "businessId" FROM "Client" WHERE phone = '+96171222333'`);
    expect(rows.rowCount).toBe(2);
  });

  it('a failed booking leaves no client behind', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    const before = (
      await pg.query(`SELECT 1 FROM "Client" WHERE "businessId" = $1`, [t.businessId])
    ).rowCount;
    const lost = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, at('07:00'), { phone: '71 444 555' }),
    );
    expect(lost.status).toBe(409);
    const after = (await pg.query(`SELECT 1 FROM "Client" WHERE "businessId" = $1`, [t.businessId]))
      .rowCount;
    expect(after).toBe(before);
  });
});

describe('front desk bookings go through the same engine', () => {
  it('books with source FRONT_DESK, and loses to a public booking of the same slot', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const start = at('07:00');
    const desk = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, start));
    expect(desk.status).toBe(201);
    expect(desk.body!.links.manage).toMatch(/^http:\/\/localhost:3000\/l\/[\w-]+\.[\w-]+$/);
    const row = (
      await pg.query(`SELECT source FROM "Appointment" WHERE id = $1`, [desk.body!.appointment.id])
    ).rows[0];
    expect(row.source).toBe('FRONT_DESK');
    const publicTry = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, start));
    expect(publicTry.status).toBe(409);
    const deskAgain = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, start));
    expect(deskAgain.status).toBe(409);
    expect(deskAgain.body!.error.code).toBe('SLOT_TAKEN');
  });

  it('idempotency is optional at the front desk and honoured when sent', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const body = bookingBody(serviceId, staffIds[0]!, at('07:00'));
    const first = await bookAtFrontDesk(t.cookie, body, 'desk-key-0001');
    const second = await bookAtFrontDesk(t.cookie, body, 'desk-key-0001');
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body!.appointment.id).toBe(first.body!.appointment.id);
  });
});

describe('the manage link', () => {
  it('is a signed view token that expires at the appointment start', async () => {
    const { verifyToken } = await import('@/server/domain/tokens');
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const start = at('07:00');
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, start));
    const token = (res.body!.links.manage as string).split('/l/')[1]!;
    const secret = process.env.LINK_SECRET!;
    const ok = verifyToken(token, secret, NOW, 'view');
    expect(ok.ok && ok.payload.a).toBe(res.body!.appointment.id);
    expect(ok.ok && ok.payload.exp).toBe(Date.parse(start) / 1000);
    expect(verifyToken(token, secret, new Date(start), 'view')).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verifyToken(token, secret, NOW, 'cancel')).toEqual({
      ok: false,
      reason: 'wrong_action',
    });
  });
});

describe('DST (Asia/Beirut): NFR-06', () => {
  const localOf = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Beirut' });

  it('2026-03-29 (spring forward): 09:00 local books and reads back as 09:00 (UTC+3)', async () => {
    vi.setSystemTime(new Date('2026-03-25T08:00:00Z'));
    try {
      const { serviceId, staffIds } = await newScenario(prisma, t);
      const slots = await getSlots(t.slug, { serviceId, from: '2026-03-29', to: '2026-03-29' });
      expect(slots.status).toBe(200);
      expect(slots.body!.slots).toHaveLength(31); // 09:00..16:30 on the 15 min grid
      expect(slots.body!.slots[0].startAt).toBe('2026-03-29T06:00:00.000Z');
      const res = await bookPublicly(
        t.slug,
        bookingBody(serviceId, staffIds[0]!, '2026-03-29T06:00:00.000Z'),
      );
      expect(res.status).toBe(201);
      const stored = (
        await pg.query(`SELECT "startAt" FROM "Appointment" WHERE id = $1`, [
          res.body!.appointment.id,
        ])
      ).rows[0];
      const local = localOf((stored.startAt as Date).toISOString());
      expect([local.toISODate(), local.hour, local.minute, local.offset]).toEqual([
        '2026-03-29',
        9,
        0,
        180,
      ]);
    } finally {
      vi.setSystemTime(NOW);
    }
  });

  it('2026-03-29: a day that starts inside the gap has one hour less (00:00 does not exist)', async () => {
    vi.setSystemTime(new Date('2026-03-25T08:00:00Z'));
    try {
      const { serviceId } = await newScenario(prisma, t, { hours: ['00:00', '04:00'] });
      const slots = await getSlots(t.slug, { serviceId, from: '2026-03-29', to: '2026-03-29' });
      // 00:00-01:00 is skipped: real span 01:00-04:00 = 3 h = 11 starts (a 4 h day would give 15)
      expect(slots.body!.slots).toHaveLength(11);
      expect(slots.body!.slots[0].startAt).toBe('2026-03-28T22:00:00.000Z');
    } finally {
      vi.setSystemTime(NOW);
    }
  });

  it('2026-10-24 (UTC+3) and 2026-10-25 (UTC+2): 09:00 local on both days, one hour apart in UTC', async () => {
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
    try {
      const { serviceId, staffIds } = await newScenario(prisma, t);
      const both = await getSlots(t.slug, { serviceId, from: '2026-10-24', to: '2026-10-25' });
      expect(both.body!.slots).toHaveLength(62);
      const sat = await bookPublicly(
        t.slug,
        bookingBody(serviceId, staffIds[0]!, '2026-10-24T06:00:00.000Z'),
      );
      const sun = await bookPublicly(
        t.slug,
        bookingBody(serviceId, staffIds[0]!, '2026-10-25T07:00:00.000Z'),
      );
      expect([sat.status, sun.status]).toEqual([201, 201]);
      const rows = (
        await pg.query(
          `SELECT "startAt" FROM "Appointment" WHERE "serviceId" = $1 ORDER BY "startAt"`,
          [serviceId],
        )
      ).rows;
      const locals = rows.map((r) => localOf((r.startAt as Date).toISOString()));
      expect(locals.map((l) => [l.toISODate(), l.hour, l.minute, l.offset])).toEqual([
        ['2026-10-24', 9, 0, 180],
        ['2026-10-25', 9, 0, 120],
      ]);
    } finally {
      vi.setSystemTime(NOW);
    }
  });

  it('2026-10-24 evening: the repeated 23:00 hour makes a 22:00-24:00 shift three real hours long', async () => {
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
    try {
      const { serviceId } = await newScenario(prisma, t, { hours: ['22:00', '24:00'] });
      const slots = await getSlots(t.slug, { serviceId, from: '2026-10-24', to: '2026-10-24' });
      expect(slots.body!.slots).toHaveLength(11); // 3 real hours, not 2
      expect(slots.body!.slots[0].startAt).toBe('2026-10-24T19:00:00.000Z');
    } finally {
      vi.setSystemTime(NOW);
    }
  });
});
