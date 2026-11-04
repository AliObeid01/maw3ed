import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { PATCH as patchBusiness } from '@/app/api/business/route';
import { GET as getPay, POST as postPay } from '@/app/api/pay/[token]/route';
import { normalizePhone } from '@/server/domain/phone';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  newKey,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  removeEmail,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { seedClient } from './helpers/outcomes';
import { staffCancel } from './helpers/waitlist';

// A client with no email address can be sent no reminder email: the runner skips every EMAIL job with
// `no_email`. The rows are still planned (the WhatsApp rows share the plan), but the response must not
// promise an email, and a replay after a cancel must not promise anything either.

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;

const HOUR = 3_600_000;
const SLOT = at('07:00');
const SLOT_MS = Date.parse(SLOT);
const EMAIL = 'maya@example.test';
const NONE = { h24: false, h2: false, email: false };
const BOTH = { h24: true, h2: true, email: true };

const payGet = (token: string) => call(getPay, `/api/pay/${token}`, { params: { token } });
const payPost = (token: string) => call(postPay, `/api/pay/${token}`, { params: { token }, body: {} });
const rowKinds = async (id: string) =>
  (
    await pg.query(`SELECT kind, channel FROM "ReminderJob" WHERE "appointmentId"=$1 ORDER BY 1,2`, [id])
  ).rows.map((r: { kind: string; channel: string }) => `${r.kind}/${r.channel}`);

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  scn = await newScenario(prisma, a);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'ReminderJob', 'Payment', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  vi.setSystemTime(NOW);
});

describe('a client without an email address is promised no reminder email', () => {
  // F68: the public page always sends an email, so "no address" is reached by removing it afterwards.
  it('public booking 30 h ahead: promised while the address exists; the WhatsApp rows are planned either way', async () => {
    vi.setSystemTime(SLOT_MS - 30 * HOUR);
    const res = await bookPublicly(a.slug, bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT));
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual(BOTH);
    expect(await rowKinds(res.body!.appointment.id)).toEqual(
      expect.arrayContaining(['H24/WHATSAPP', 'H2/WHATSAPP']),
    );
  });

  it('a replay after the address was removed promises nothing (the rows still exist)', async () => {
    vi.setSystemTime(SLOT_MS - 30 * HOUR);
    const key = newKey();
    const body = bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT);
    const first = await bookPublicly(a.slug, body, key);
    expect(first.status).toBe(201);
    await removeEmail(pg, first.body!.appointment.id);
    const again = await bookPublicly(a.slug, body, key);
    expect(again.status).toBe(200);
    expect(again.body!.reminders).toEqual(NONE);
    expect(await rowKinds(first.body!.appointment.id)).toEqual(
      expect.arrayContaining(['H24/EMAIL', 'H24/WHATSAPP']),
    );
  });

  it('a returning client whose stored profile has an email is promised reminders', async () => {
    vi.setSystemTime(SLOT_MS - 30 * HOUR);
    const phone = newPhone();
    const first = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone, email: EMAIL }),
    );
    expect(first.body!.reminders).toEqual(BOTH);
    const later = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, at('08:00'), { phone }),
    );
    expect(later.body!.reminders).toEqual(BOTH);
  });

  it('front-desk booking without email', async () => {
    vi.setSystemTime(SLOT_MS - 30 * HOUR);
    const res = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { email: undefined }),
    );
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual(NONE);
  });

  it('front-desk booking with email 30 h ahead', async () => {
    vi.setSystemTime(SLOT_MS - 30 * HOUR);
    const res = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { email: EMAIL }),
    );
    expect(res.body!.reminders).toEqual(BOTH);
  });

  it('paid deposit without email', async () => {
    const national = newPhone();
    await seedClient(prisma, a.businessId, {
      name: 'Nadia NoShow',
      phone: normalizePhone(national)!,
      noShows: 1,
      email: null,
    });
    await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: { depositEnabled: true, depositThreshold: 1, depositAmount: 5 },
    });
    vi.setSystemTime(SLOT_MS - 30 * HOUR);
    const hold = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: national }),
    );
    expect(hold.body!.status).toBe('PENDING_PAYMENT');
    // The page sent an address; it is gone by the time the deposit is paid (the client record has none).
    await removeEmail(pg, hold.body!.appointment.id, false);
    const paid = await payPost(hold.body!.payToken);
    expect(paid.status).toBe(200);
    expect(paid.body!.reminders).toEqual(NONE);
    expect((await payGet(hold.body!.payToken)).body!.reminders).toEqual(NONE);
  });
});

describe('a replay after the booking was cancelled reports no reminders', () => {
  it('false/false although the skipped rows still exist', async () => {
    vi.setSystemTime(SLOT_MS - 30 * HOUR);
    const key = newKey();
    const body = bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { email: EMAIL });
    const first = await bookPublicly(a.slug, body, key);
    expect(first.body!.reminders).toEqual(BOTH);
    expect((await staffCancel(a.cookie, first.body!.appointment.id)).status).toBe(200);
    const again = await bookPublicly(a.slug, body, key);
    expect(again.status).toBe(200);
    expect(again.body!.reminders).toEqual({ h24: false, h2: false, email: true });
  });
});
