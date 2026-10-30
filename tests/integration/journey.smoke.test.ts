/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as remindersJob } from '@/app/api/jobs/reminders/route';
import { POST as postLink } from '@/app/api/links/[token]/route';
import { PUT as putHours } from '@/app/api/staff/[id]/hours/route';
import { POST as postService } from '@/app/api/services/route';
import { POST as postStaff } from '@/app/api/staff/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { call, signup } from './helpers/api';
import { bookingBody, bookPublicly, getSlots, NOW } from './helpers/booking';
import { newClient, setupSchema, truncateAll } from './helpers/db';

/**
 * F18: the whole client journey through the REAL route handlers and Postgres, with the fake email provider
 * and a frozen clock. signup -> service + staff + hours -> public booking -> reminder job -> confirm link
 * -> cancel link -> the slot is bookable again.
 */
let pg: Client;
const CRON = 'journey-cron-secret-0123456789';
const DAY = '2026-11-04';

const runJob = () =>
  call(remindersJob, '/api/jobs/reminders', { method: 'POST', headers: { 'x-cron-secret': CRON } });
/** Pull the signed link for one action out of an email body. */
const linkIn = (text: string, action: 'confirm' | 'cancel') => {
  const tokens = [...text.matchAll(/\/l\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]!);
  const token = tokens.find((t) => {
    try {
      const payload = JSON.parse(Buffer.from(t.split('.')[0]!, 'base64url').toString('utf8'));
      return payload.act === action;
    } catch {
      return false;
    }
  });
  if (!token) throw new Error(`no ${action} link in email: ${tokens.join(',')}`);
  return token;
};
const act = (token: string, action: 'confirm' | 'cancel') =>
  call(postLink, `/api/links/${token}`, { params: { token }, body: { action } });

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  process.env.CRON_SECRET = CRON;
  fakeEmailProvider.reset();
});
afterAll(async () => {
  vi.useRealTimers();
  await pg.end();
});

describe('journey smoke: signup to cancelled-and-rebookable', () => {
  it('runs end to end and leaves exactly one reminder job per kind', async () => {
    // 1. Owner signs up and sets the business up through the API.
    const owner = await signup();
    const { cookie } = owner;
    const slug = owner.body.slug as string;
    const service = await call(postService, '/api/services', {
      cookie,
      body: { name: 'Haircut', durationMin: 30, bufferMin: 0, price: 15 },
    });
    expect(service.status).toBe(201);
    const serviceId = service.body!.id as string;
    const staff = await call(postStaff, '/api/staff', {
      cookie,
      body: { displayName: 'Nour', bookable: true, serviceIds: [serviceId] },
    });
    expect(staff.status).toBe(201);
    const staffId = staff.body!.id as string;
    const hours = await call(putHours, `/api/staff/${staffId}/hours`, {
      method: 'PUT',
      cookie,
      params: { id: staffId },
      body: {
        intervals: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startLocal: '09:00',
          endLocal: '17:00',
        })),
      },
    });
    expect(hours.status).toBe(200);

    // 2. A client books the first free slot on the public page.
    const slots = await getSlots(slug, { serviceId, staffId, from: DAY, to: DAY });
    expect(slots.status).toBe(200);
    const startAt = slots.body!.slots[0].startAt as string;
    const booked = await bookPublicly(
      slug,
      bookingBody(serviceId, staffId, startAt, { email: 'client@example.test' }),
    );
    expect(booked.status).toBe(201);
    const appointmentId = booked.body!.appointment.id as string;
    const start = new Date(startAt);

    // 3. The reminder job sends the booking email now, H24 at start-24h, H2 at start-2h.
    expect((await runJob()).status).toBe(200);
    expect(fakeEmailProvider.calls).toHaveLength(1);
    vi.setSystemTime(new Date(start.getTime() - 24 * 3_600_000));
    await runJob();
    vi.setSystemTime(new Date(start.getTime() - 2 * 3_600_000));
    await runJob();
    expect(fakeEmailProvider.calls).toHaveLength(3);
    expect(fakeEmailProvider.calls.every((m) => m.to === 'client@example.test')).toBe(true);
    // Running the job again sends nothing more.
    await runJob();
    expect(fakeEmailProvider.calls).toHaveLength(3);
    const jobs = (
      await pg.query(
        `SELECT kind, channel, status FROM "ReminderJob" WHERE "appointmentId" = $1 ORDER BY channel, kind`,
        [appointmentId],
      )
    ).rows;
    // One row per (kind, channel): the emails are SENT by the job, the WhatsApp rows wait for a human tap.
    const label = (j: any) => `${j.kind}/${j.channel}/${j.status}`;
    expect(jobs.map(label).sort()).toEqual(
      [
        'BOOKING/EMAIL/SENT',
        'H2/EMAIL/SENT',
        'H24/EMAIL/SENT',
        'H2/WHATSAPP/PENDING',
        'H24/WHATSAPP/PENDING',
      ].sort(),
    );

    // 4. The client confirms from the link in the H2 email, then cancels from the same email.
    const h2 = fakeEmailProvider.calls[2]!;
    const confirm = await act(linkIn(h2.text, 'confirm'), 'confirm');
    expect(confirm.status).toBe(200);
    expect(confirm.body).toMatchObject({
      result: 'confirmed',
      appointment: { status: 'CONFIRMED' },
    });
    const cancel = await act(linkIn(h2.text, 'cancel'), 'cancel');
    expect(cancel.status).toBe(200);
    const row = (
      await pg.query('SELECT status, "cancelledVia" FROM "Appointment" WHERE id = $1', [
        appointmentId,
      ])
    ).rows[0];
    expect(row.cancelledVia).toBe('LINK');
    // Inside the 24 h cutoff the cancel is recorded as a late cancel; both free the slot.
    expect(['CANCELLED', 'LATE_CANCEL']).toContain(row.status);

    // 5. The slot is bookable again.
    const again = await getSlots(slug, { serviceId, staffId, from: DAY, to: DAY });
    expect(again.body!.slots.map((s: any) => s.startAt)).toContain(startAt);
    const rebook = await bookPublicly(
      slug,
      bookingBody(serviceId, staffId, startAt, { email: 'second@example.test' }),
    );
    expect(rebook.status).toBe(201);
  }, 60_000);
});
