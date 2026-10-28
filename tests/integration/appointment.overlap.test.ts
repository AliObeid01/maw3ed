import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { mapError, pgErrorCode } from '@/server/http/errors';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

// Guarantee 1: no double booking, enforced by the appointment_no_overlap exclusion constraint.

const at = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00.000Z`);

let pg: Client;
let prisma: PrismaClient;
let ids: {
  businessId: string;
  staffId: string;
  otherStaffId: string;
  clientId: string;
  serviceId: string;
};
let seq = 0;

async function makeFixtures() {
  const business = await prisma.business.create({
    data: { slug: 'overlap-test', name: 'Overlap Test' },
  });
  const staff = await prisma.staffMember.create({
    data: { businessId: business.id, displayName: 'A' },
  });
  const otherStaff = await prisma.staffMember.create({
    data: { businessId: business.id, displayName: 'B' },
  });
  const client = await prisma.client.create({
    data: { businessId: business.id, name: 'C', phone: '+96170000000' },
  });
  const service = await prisma.service.create({
    data: { businessId: business.id, name: 'Cut', durationMin: 30, price: '15.00' },
  });
  ids = {
    businessId: business.id,
    staffId: staff.id,
    otherStaffId: otherStaff.id,
    clientId: client.id,
    serviceId: service.id,
  };
}

/** Raw insert so the failure surfaces as the plain Postgres error. */
function insertRaw(opts: {
  start: string;
  end: string;
  blockedUntil?: string;
  status?: string;
  staffId?: string;
}) {
  seq += 1;
  return pg.query(
    `INSERT INTO "Appointment"
       (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"AppointmentStatus", now())`,
    [
      `appt${seq}`,
      ids.businessId,
      ids.clientId,
      opts.staffId ?? ids.staffId,
      ids.serviceId,
      at(opts.start),
      at(opts.end),
      at(opts.blockedUntil ?? opts.end),
      opts.status ?? 'BOOKED',
    ],
  );
}

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  prisma = newPrisma();
});

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.end();
});

beforeEach(async () => {
  await truncateAll(pg);
  await makeFixtures();
});

describe('appointment_no_overlap', () => {
  it('rejects two overlapping BOOKED appointments for one staff member with 23P01', async () => {
    await insertRaw({ start: '10:00', end: '10:30' });
    await expect(insertRaw({ start: '10:15', end: '10:45' })).rejects.toMatchObject({
      code: '23P01',
    });
  });

  it('rejects an identical time range', async () => {
    await insertRaw({ start: '10:00', end: '10:30' });
    await expect(insertRaw({ start: '10:00', end: '10:30' })).rejects.toMatchObject({
      code: '23P01',
    });
  });

  it('allows adjacent appointments (ranges are [) half-open)', async () => {
    await insertRaw({ start: '10:00', end: '10:30' });
    await insertRaw({ start: '10:30', end: '11:00' });
    await insertRaw({ start: '09:30', end: '10:00' });
    const { rows } = await pg.query('SELECT count(*)::int AS n FROM "Appointment"');
    expect(rows[0].n).toBe(3);
  });

  it('allows an overlap with a CANCELLED appointment, and a CONFIRMED one still blocks', async () => {
    await insertRaw({ start: '10:00', end: '10:30', status: 'CANCELLED' });
    await insertRaw({ start: '10:00', end: '10:30', status: 'BOOKED' });
    await expect(
      insertRaw({ start: '10:10', end: '10:20', status: 'CONFIRMED' }),
    ).rejects.toMatchObject({
      code: '23P01',
    });
    // NO_SHOW / LATE_CANCEL / ATTENDED do not block either
    await insertRaw({ start: '10:00', end: '10:30', status: 'NO_SHOW' });
    await insertRaw({ start: '10:00', end: '10:30', status: 'LATE_CANCEL' });
  });

  it('allows the same time for a different staff member', async () => {
    await insertRaw({ start: '10:00', end: '10:30' });
    await insertRaw({ start: '10:00', end: '10:30', staffId: ids.otherStaffId });
  });

  it('rejects an overlap that falls inside the buffer (blockedUntil)', async () => {
    await insertRaw({ start: '10:00', end: '10:30', blockedUntil: '10:40' });
    await expect(insertRaw({ start: '10:30', end: '11:00' })).rejects.toMatchObject({
      code: '23P01',
    });
    await expect(insertRaw({ start: '10:39', end: '11:00' })).rejects.toMatchObject({
      code: '23P01',
    });
    await insertRaw({ start: '10:40', end: '11:00' });
  });

  it('rejects flipping a CANCELLED row back to BOOKED over an active booking', async () => {
    await insertRaw({ start: '10:00', end: '10:30', status: 'CANCELLED' });
    await insertRaw({ start: '10:00', end: '10:30' });
    await expect(
      pg.query(`UPDATE "Appointment" SET status = 'BOOKED' WHERE status = 'CANCELLED'`),
    ).rejects.toMatchObject({
      code: '23P01',
    });
  });

  it('surfaces through the Prisma driver and maps to 409 SLOT_TAKEN', async () => {
    const base = {
      businessId: ids.businessId,
      clientId: ids.clientId,
      staffId: ids.staffId,
      serviceId: ids.serviceId,
    };
    await prisma.appointment.create({
      data: { ...base, startAt: at('12:00'), endAt: at('12:30'), blockedUntil: at('12:30') },
    });
    const error = await prisma.appointment
      .create({
        data: { ...base, startAt: at('12:10'), endAt: at('12:40'), blockedUntil: at('12:40') },
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeDefined();
    expect(pgErrorCode(error)).toBe('23P01');
    const mapped = mapError(error);
    expect(mapped.status).toBe(409);
    expect(mapped.body.error.code).toBe('SLOT_TAKEN');
  });

  it('enforces the CHECKs (end after start, blockedUntil not before end)', async () => {
    await expect(insertRaw({ start: '10:30', end: '10:00' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      insertRaw({ start: '10:00', end: '10:30', blockedUntil: '10:20' }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('ReminderJob unique key', () => {
  it('rejects a second job for the same (appointment, kind, channel) with 23505', async () => {
    await insertRaw({ start: '10:00', end: '10:30' });
    const job = (id: string, channel: string) =>
      pg.query(
        `INSERT INTO "ReminderJob" (id, "businessId", "appointmentId", kind, channel, "dueAt")
         VALUES ($1, $2, 'appt${seq}', 'H24', $3::"ReminderChannel", now())`,
        [id, ids.businessId, channel],
      );
    await job('j1', 'EMAIL');
    await job('j2', 'WHATSAPP');
    await expect(job('j3', 'EMAIL')).rejects.toMatchObject({ code: '23505' });
  });
});
