/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { PATCH as patchBusiness } from '@/app/api/business/route';
import { DELETE as deleteClient } from '@/app/api/clients/[id]/route';
import { GET as getPay, POST as postPay } from '@/app/api/pay/[token]/route';
import { GET as exportCsv } from '@/app/api/pilot/export.csv/route';
import { normalizePhone } from '@/server/domain/phone';
import { rootLogger } from '@/server/http/logger';
import { fakeEmailProvider } from '@/server/providers/email';
import { runReminders, type ReminderDeps } from '@/server/services/reminders';
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
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { seedClient } from './helpers/outcomes';
import { offerClaim, seedEntry, staffCancel, tokenFromEmail } from './helpers/waitlist';

/**
 * F16: the email of an appointment is the one typed for THAT booking (Appointment.contactEmail); the client
 * record keeps its own rule (a public booking only fills an EMPTY email). Effective recipient =
 * contactEmail, else client.email.
 */
let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;

const fake = fakeEmailProvider;
const OLD = 'rana.old@gmail.test';
const NEW = 'rana.new@gmail.test';
const SLOT = at('07:00');
const SLOT2 = at('08:00');

const deps = (now: Date = NOW): ReminderDeps => ({
  now: () => now,
  provider: () => fake,
  linkSecret: () => process.env.LINK_SECRET!,
  appUrl: () => 'http://localhost:3000',
  logger: rootLogger,
});

const row = async (id: string) =>
  (
    await pg.query(
      `SELECT a."contactEmail", c.email AS "clientEmail", c.id AS "clientId" FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId" WHERE a.id = $1`,
      [id],
    )
  ).rows[0] as { contactEmail: string | null; clientEmail: string | null; clientId: string };
const clientEmail = async (phone: string) =>
  (await pg.query(`SELECT email FROM "Client" WHERE phone = $1`, [normalizePhone(phone)!])).rows[0]
    ?.email as string | null;
const tos = () => fake.calls.map((c) => c.to);
const body = (staff: number, start: string, client: Record<string, unknown>) =>
  bookingBody(scn.serviceId, scn.staffIds[staff]!, start, client);
const jobs = async (id: string) =>
  (
    await pg.query(
      `SELECT kind, channel, status, "lastError" FROM "ReminderJob" WHERE "appointmentId" = $1 ORDER BY 1, 2`,
      [id],
    )
  ).rows as { kind: string; channel: string; status: string; lastError: string | null }[];

beforeAll(async () => {
  process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  b = await newTenant({ businessName: 'Beta Clinic' });
  scn = await newScenario(prisma, a, { staff: 3 });
  bScn = await newScenario(prisma, b);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'ReminderJob', 'Payment', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  fake.reset();
  vi.setSystemTime(NOW);
});

describe('public booking stores the email on the appointment', () => {
  it('first booking fills the empty record email AND sets contactEmail; the confirmation goes there', async () => {
    const phone = newPhone();
    const res = await bookPublicly(a.slug, body(0, SLOT, { phone, email: `  ${OLD.toUpperCase()} ` }));
    expect(res.status).toBe(201);
    const r = await row(res.body!.appointment.id);
    expect(r.contactEmail).toBe(OLD);
    expect(r.clientEmail).toBe(OLD);
    expect(res.body!.reminders).toEqual({ h24: true, h2: true, email: true });
    await runReminders(deps());
    expect(tos()).toEqual([OLD]);
  });

  it('Rana books again with a NEW email: confirmation and reminders go to the NEW one, the record stays', async () => {
    const phone = newPhone();
    const first = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    expect(first.status).toBe(201);
    const second = await bookPublicly(a.slug, body(0, SLOT2, { phone, email: NEW }));
    expect(second.status).toBe(201);
    const id2 = second.body!.appointment.id as string;

    // The record is unchanged, the new appointment carries the new address.
    expect(await clientEmail(phone)).toBe(OLD);
    expect((await row(id2)).contactEmail).toBe(NEW);
    expect((await row(first.body!.appointment.id)).contactEmail).toBe(OLD);

    // Confirmations: each appointment to its own address.
    await runReminders(deps());
    expect(tos().sort()).toEqual([NEW, OLD].sort());
    const toNew = fake.calls.find((c) => c.to === NEW)!;
    expect(toNew.text).toContain(`/l/`);

    // Reminders: planned as rows and sent to the NEW address, 24 h before the second appointment.
    fake.reset();
    const h24Due = new Date(Date.parse(SLOT2) - 24 * 3_600_000 + 60_000);
    vi.setSystemTime(h24Due);
    await runReminders(deps(h24Due));
    const h24 = fake.calls.filter((c) => c.to === NEW || c.to === OLD);
    expect(h24.map((c) => c.to).sort()).toEqual([NEW, OLD].sort()); // one H24 each, to its own address
  });

  it('a stranger using Rana\'s phone only affects the appointment they create', async () => {
    const phone = newPhone();
    const ranas = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    const evil = await bookPublicly(a.slug, body(1, SLOT, { phone, email: 'attacker@evil.test' }));
    expect(evil.status).toBe(201);
    expect(await clientEmail(phone)).toBe(OLD);
    expect((await row(ranas.body!.appointment.id)).contactEmail).toBe(OLD);
    await runReminders(deps());
    const evilCall = fake.calls.find((c) => c.to === 'attacker@evil.test')!;
    const ranaCall = fake.calls.find((c) => c.to === OLD)!;
    // The attacker's links are for the attacker's booking, Rana's mail carries Rana's.
    const link = (t: string) => /\/l\/([A-Za-z0-9_.-]+)/.exec(t)![1]!;
    expect(link(evilCall.text)).not.toBe(link(ranaCall.text));
    expect(fake.calls).toHaveLength(2);
  });

  it('two appointments of the same client with different emails each get their own', async () => {
    const phone = newPhone();
    const r1 = await bookPublicly(a.slug, body(0, SLOT, { phone, email: 'one@x.test' }));
    const r2 = await bookPublicly(a.slug, body(1, SLOT, { phone, email: 'two@x.test' }));
    expect((await row(r1.body!.appointment.id)).contactEmail).toBe('one@x.test');
    expect((await row(r2.body!.appointment.id)).contactEmail).toBe('two@x.test');
  });

  it('a booking without an email uses the record email (fallback), contactEmail stays NULL', async () => {
    const phone = newPhone();
    await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    fake.reset();
    await runReminders(deps());
    fake.reset();
    const res = await bookPublicly(a.slug, body(0, SLOT2, { phone }));
    expect((await row(res.body!.appointment.id)).contactEmail).toBeNull();
    expect(res.body!.reminders).toEqual({ h24: true, h2: true, email: true });
    await runReminders(deps());
    expect(tos()).toEqual([OLD]);
  });

  it('no email anywhere: no_email as today and the promise says no email', async () => {
    const res = await bookPublicly(a.slug, body(0, SLOT, {}));
    expect(res.body!.reminders).toEqual({ h24: false, h2: false, email: false });
    const sum = await runReminders(deps());
    expect(sum.sent).toBe(0);
    expect(fake.calls).toHaveLength(0);
    const j = await jobs(res.body!.appointment.id);
    expect(j.find((x) => x.kind === 'BOOKING' && x.channel === 'EMAIL')!.status).toBe('SKIPPED');
  });

  it('pre-F16 appointment (contactEmail NULL, record has an email) still gets its mail', async () => {
    const phone = newPhone();
    const res = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    await pg.query(`UPDATE "Appointment" SET "contactEmail" = NULL WHERE id = $1`, [
      res.body!.appointment.id,
    ]);
    await runReminders(deps());
    expect(tos()).toEqual([OLD]);
  });

  it('the runner reads the address at SEND time (record corrected / appointment email changed after planning)', async () => {
    const phone = newPhone();
    const res = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    const id = res.body!.appointment.id as string;
    // Pre-F16 shape: no contactEmail, the record is corrected afterwards.
    await pg.query(`UPDATE "Appointment" SET "contactEmail" = NULL WHERE id = $1`, [id]);
    await pg.query(`UPDATE "Client" SET email = $1 WHERE phone = $2`, [
      'corrected@x.test',
      normalizePhone(phone),
    ]);
    await runReminders(deps());
    expect(tos()).toEqual(['corrected@x.test']);

    // An appointment with its own address: changing it before the unsent H24 applies to that job.
    fake.reset();
    await pg.query(`UPDATE "Appointment" SET "contactEmail" = $1 WHERE id = $2`, ['later@x.test', id]);
    const h24Due = new Date(Date.parse(SLOT) - 24 * 3_600_000 + 60_000);
    vi.setSystemTime(h24Due);
    await runReminders(deps(h24Due));
    expect(tos()).toEqual(['later@x.test']);
  });

  it('replay returns the original and sends once; a replay with a DIFFERENT email changes nothing', async () => {
    const phone = newPhone();
    const key = newKey();
    const first = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }), key);
    const again = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }), key);
    expect(again.status).toBe(200);
    expect(again.body!.appointment.id).toBe(first.body!.appointment.id);
    // Same rule as for the name: only service, staff, time and phone identify the request.
    const other = await bookPublicly(a.slug, body(0, SLOT, { phone, email: NEW }), key);
    expect(other.status).toBe(200);
    expect(other.body!.appointment.id).toBe(first.body!.appointment.id);
    expect((await row(first.body!.appointment.id)).contactEmail).toBe(OLD);
    await runReminders(deps());
    expect(tos()).toEqual([OLD]);
  });

  it('the booking response never carries an email', async () => {
    const res = await bookPublicly(a.slug, body(0, SLOT, { email: OLD }));
    expect(JSON.stringify(res.body)).not.toContain(OLD);
  });
});

describe('front desk', () => {
  it('with an email: stored on the appointment AND (as before) replaces a different record email', async () => {
    const phone = newPhone();
    await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    const res = await bookAtFrontDesk(a.cookie, body(1, SLOT, { phone, email: NEW }));
    expect(res.status).toBe(201);
    expect((await row(res.body!.appointment.id)).contactEmail).toBe(NEW);
    expect(await clientEmail(phone)).toBe(NEW); // unchanged behaviour: staff may correct the record
    fake.reset();
    await runReminders(deps());
    expect(tos()).toContain(NEW);
  });

  it('without an email: contactEmail NULL, the record email is used', async () => {
    const phone = newPhone();
    await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    const res = await bookAtFrontDesk(a.cookie, body(1, SLOT, { phone }));
    expect((await row(res.body!.appointment.id)).contactEmail).toBeNull();
    expect(res.body!.reminders.email).toBe(true);
  });
});

describe('deposit paid path', () => {
  it('the paid appointment is promised and mailed at its OWN address', async () => {
    const phone = newPhone();
    await seedClient(prisma, a.businessId, {
      name: 'Nadia',
      phone: normalizePhone(phone)!,
      noShows: 1,
      email: OLD,
    });
    await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: { depositEnabled: true, depositThreshold: 1, depositAmount: 5 },
    });
    const hold = await bookPublicly(a.slug, body(0, SLOT, { phone, email: NEW }));
    expect(hold.body!.status).toBe('PENDING_PAYMENT');
    expect(hold.body!.reminders.email).toBe(true);
    const token = hold.body!.payToken as string;
    const paid = await call(postPay, `/api/pay/${token}`, { params: { token }, body: {} });
    expect(paid.status).toBe(200);
    expect(paid.body!.reminders).toEqual({ h24: true, h2: true, email: true });
    expect((await call(getPay, `/api/pay/${token}`, { params: { token } })).body!.reminders.email).toBe(true);
    await runReminders(deps());
    expect(tos()).toEqual([NEW]);
    expect(await clientEmail(phone)).toBe(OLD);
  });
});

describe('waitlist claim', () => {
  it("the claimed appointment's contactEmail is the ENTRY's email, not the record's", async () => {
    const holder = await bookPublicly(
      a.slug,
      body(0, SLOT, { name: 'Casey', email: 'casey@x.test' }),
    );
    const entryEmail = 'entry-contact@x.test';
    const wphone = `+9617${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const e = await seedEntry(prisma, a.businessId, scn.serviceId, {
      phone: wphone,
      email: 'record@x.test',
      contactEmail: entryEmail,
      createdAt: new Date(NOW.getTime() - 1_000_000),
    });
    expect((await staffCancel(a.cookie, holder.body!.appointment.id)).status).toBe(200);
    const mail = fake.calls.find((c) => c.to === entryEmail)!;
    const claim = await offerClaim(tokenFromEmail(mail.text));
    expect(claim.status).toBe(201);
    const appt = (
      await pg.query(`SELECT id, "contactEmail" FROM "Appointment" WHERE "clientId" = $1`, [e.clientId])
    ).rows[0];
    expect(appt.contactEmail).toBe(entryEmail);
    // The record keeps what it had.
    expect((await pg.query(`SELECT email FROM "Client" WHERE id = $1`, [e.clientId])).rows[0].email).toBe(
      'record@x.test',
    );
    fake.reset();
    await runReminders(deps());
    expect(tos()).toEqual([entryEmail]);
  });
});

describe('NFR-04: anonymisation, CSV, logs', () => {
  it('DELETE /api/clients/{id} nulls contactEmail on ALL of the client appointments', async () => {
    const phone = newPhone();
    const r1 = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    const r2 = await bookPublicly(a.slug, body(1, SLOT, { phone, email: NEW }));
    const other = await bookPublicly(a.slug, body(2, SLOT, { email: 'bystander@x.test' }));
    // A past appointment of the same client carries one too.
    const { clientId } = await row(r1.body!.appointment.id);
    await pg.query(`UPDATE "Appointment" SET status = 'ATTENDED', "startAt" = "startAt" - interval '30 days', "endAt" = "endAt" - interval '30 days', "blockedUntil" = "blockedUntil" - interval '30 days' WHERE id = $1`, [
      r2.body!.appointment.id,
    ]);
    const del = await call(deleteClient, `/api/clients/${clientId}`, {
      method: 'DELETE',
      cookie: a.cookie,
      params: { id: clientId },
    });
    expect(del.status).toBe(204);
    const left = await pg.query(
      `SELECT id, "contactEmail" FROM "Appointment" WHERE "clientId" = $1`,
      [clientId],
    );
    expect(left.rowCount).toBe(2);
    expect(left.rows.every((x) => x.contactEmail === null)).toBe(true);
    expect((await row(other.body!.appointment.id)).contactEmail).toBe('bystander@x.test');
    // Nothing of the client's addresses is left anywhere in Appointment or Client.
    const leak = await pg.query(
      `SELECT 1 FROM "Appointment" WHERE "contactEmail" IN ($1, $2) UNION ALL SELECT 1 FROM "Client" WHERE email IN ($1, $2)`,
      [OLD, NEW],
    );
    expect(leak.rowCount).toBe(0);
  });

  it('the CSV export does not include any email', async () => {
    const day = '2026-11-04';
    await bookPublicly(a.slug, body(0, SLOT, { email: OLD }));
    await bookAtFrontDesk(a.cookie, body(1, SLOT, { email: NEW }));
    const url = new URL('http://localhost/api/pilot/export.csv');
    url.searchParams.set('from', day);
    url.searchParams.set('to', day);
    const res = await exportCsv(new Request(url, { headers: { cookie: a.cookie } }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text.split('\n')[0]).not.toMatch(/mail/i);
    expect(text).not.toContain(OLD);
    expect(text).not.toContain(NEW);
    expect(text).not.toContain('@');
  });

  it('logs carry ids only, never the address', async () => {
    const lines: string[] = [];
    const spy = (..._args: unknown[]) => lines.push(JSON.stringify(_args));
    const logger: any = new Proxy(
      {},
      { get: () => (...args: unknown[]) => spy(...args) },
    );
    await bookPublicly(a.slug, body(0, SLOT, { email: OLD }));
    await runReminders({ ...deps(), logger });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(OLD);
  });
});

describe('tenant isolation and validation', () => {
  it("another business's client id cannot be deleted (404) and its appointment emails are untouched", async () => {
    const r = await bookPublicly(a.slug, body(0, SLOT, { email: OLD }));
    const { clientId } = await row(r.body!.appointment.id);
    const del = await call(deleteClient, `/api/clients/${clientId}`, {
      method: 'DELETE',
      cookie: b.cookie,
      params: { id: clientId },
    });
    expect(del.status).toBe(404);
    expect((await row(r.body!.appointment.id)).contactEmail).toBe(OLD);
    void bScn;
  });

  it('the booking contract is unchanged: a bad email is 400 with fields, unknown fields rejected', async () => {
    const bad = await bookPublicly(a.slug, body(0, SLOT, { email: 'not-an-email' }));
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields['client.email']).toBeTruthy();
    const unknown = await bookPublicly(a.slug, {
      ...body(0, SLOT, {}),
      contactEmail: 'x@y.test',
    });
    expect(unknown.status).toBe(400);
  });
});
