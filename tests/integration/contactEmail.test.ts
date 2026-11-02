/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { PATCH as patchBusiness } from '@/app/api/business/route';
import { DELETE as deleteClient } from '@/app/api/clients/[id]/route';
import { GET as getLink } from '@/app/api/links/[token]/route';
import { GET as getPay, POST as postPay } from '@/app/api/pay/[token]/route';
import { DELETED_CLIENT_NAME } from '@/server/domain/clientFlags';
import { clientRepo } from '@/server/repositories/client.repo';
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
import {
  joinBody,
  joinWaitlist,
  offerClaim,
  runExpiry,
  seedEntry,
  staffCancel,
  tokenFromEmail,
} from './helpers/waitlist';

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
    // N1: a waitlist claim stores no typed name, and the entry address is not the record email, so the
    // claimed appointment's mail is greeted generically (never with the record name).
    expect(
      (await pg.query(`SELECT "contactName" FROM "Appointment" WHERE id = $1`, [appt.id])).rows[0]
        .contactName,
    ).toBeNull();
    expect(fake.calls[0]!.text.startsWith('Hello,')).toBe(true);
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
      `SELECT id, "contactEmail", "contactName" FROM "Appointment" WHERE "clientId" = $1`,
      [clientId],
    );
    expect(left.rowCount).toBe(2);
    expect(left.rows.every((x) => x.contactEmail === null && x.contactName === null)).toBe(true);
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

describe('review: the record name never reaches a recipient who is not the record email (oracle)', () => {
  const VICTIM = 'Zainab Haddad';
  const VICTIM_EMAIL = 'zainab.real@gmail.test';
  const ATTACKER = 'mallory@evil.test';
  const NAME_RE = /Zainab|Haddad/i;

  async function victim() {
    const phone = newPhone();
    const first = await bookPublicly(
      a.slug,
      body(0, SLOT, { phone, name: VICTIM, email: VICTIM_EMAIL }),
    );
    expect(first.status).toBe(201);
    await runReminders(deps()); // her own confirmation
    fake.reset();
    return { phone, first };
  }

  it.each([
    ['en', true],
    ['ar', true],
    ['en', false],
    ['ar', false],
  ])(
    'attacker books with the victim phone + own email (%s, typed name stored: %s): the mail has NO victim name, the response and link page neither',
    async (locale, typedName) => {
      await prisma.business.update({ where: { id: a.businessId }, data: { locale } });
      try {
        const { phone } = await victim();
        const evil = await bookPublicly(
          a.slug,
          body(1, SLOT2, { phone, name: 'Mallory', email: ATTACKER }),
        );
        expect(evil.status).toBe(201);
        expect(JSON.stringify(evil.body)).not.toMatch(NAME_RE);
        // typedName=false simulates an appointment without a typed name (waitlist claim): generic greeting.
        if (!typedName)
          await pg.query(`UPDATE "Appointment" SET "contactName" = NULL WHERE id = $1`, [
            evil.body!.appointment.id,
          ]);
        await runReminders(deps());
        const mail = fake.calls.find((c) => c.to === ATTACKER)!;
        expect(mail).toBeTruthy();
        expect(mail.text).not.toMatch(NAME_RE);
        expect(mail.html).not.toMatch(NAME_RE);
        expect(mail.subject).not.toMatch(NAME_RE);
        if (typedName) {
          expect(mail.text).toContain('Mallory');
          expect(mail.html).toContain('Mallory');
        } else {
          expect(mail.text.startsWith(locale === 'ar' ? 'مرحبا،' : 'Hello,')).toBe(true);
          expect(mail.html).toContain(locale === 'ar' ? 'مرحبا،' : 'Hello,');
          expect(mail.text).not.toContain('Mallory');
        }

        // The link page of the attacker's own booking shows no client name either.
        const token = /\/l\/([A-Za-z0-9_.-]+)/.exec(mail.text)![1]!;
        const view = await call(getLink, `/api/links/${token}`, { params: { token } });
        expect(view.status).toBe(200);
        expect(JSON.stringify(view.body)).not.toMatch(NAME_RE);

        // The H24 reminder to the attacker does not name her either.
        fake.reset();
        const due = new Date(Date.parse(SLOT2) - 24 * 3_600_000 + 60_000);
        vi.setSystemTime(due);
        await runReminders(deps(due));
        const h24 = fake.calls.filter((c) => c.to === ATTACKER);
        expect(h24.length).toBeGreaterThan(0);
        for (const m of h24) {
          expect(m.text).not.toMatch(NAME_RE);
          expect(m.html).not.toMatch(NAME_RE);
        }
      } finally {
        await prisma.business.update({ where: { id: a.businessId }, data: { locale: 'en' } });
      }
    },
  );

  it('the victim keeps her name in mail to the record email (same-email booking, and no-email booking)', async () => {
    const { phone } = await victim();
    const same = await bookPublicly(
      a.slug,
      body(1, SLOT2, { phone, name: 'Someone', email: VICTIM_EMAIL.toUpperCase() }),
    );
    expect(same.status).toBe(201);
    const bare = await bookPublicly(a.slug, body(2, SLOT, { phone, name: 'Else' }));
    expect(bare.status).toBe(201);
    // Rows without a typed name (pre-F16 rows, waitlist claims) fall back to the record name, which is
    // fine here because the recipient IS the record email.
    await pg.query(`UPDATE "Appointment" SET "contactName" = NULL WHERE "clientId" = $1`, [
      (await row(same.body!.appointment.id)).clientId,
    ]);
    await runReminders(deps());
    expect(tos()).toEqual([VICTIM_EMAIL, VICTIM_EMAIL]);
    for (const m of fake.calls) expect(m.text.startsWith(`Hi ${VICTIM},`)).toBe(true);
  });

  it('typed name: a same-email booking is greeted with the name typed for it', async () => {
    const { phone } = await victim();
    const same = await bookPublicly(
      a.slug,
      body(1, SLOT2, { phone, name: 'Someone', email: VICTIM_EMAIL }),
    );
    expect(same.status).toBe(201);
    await runReminders(deps());
    expect(fake.calls.map((c) => c.text.split('\n')[0])).toEqual(['Hi Someone,']);
  });

  it('a returning client with a NEW email is greeted with the name she typed for that booking', async () => {
    const { phone } = await victim();
    const again = await bookPublicly(a.slug, body(1, SLOT2, { phone, name: VICTIM, email: NEW }));
    expect(again.status).toBe(201);
    await runReminders(deps());
    const mail = fake.calls.find((c) => c.to === NEW)!;
    expect(mail.text.startsWith(`Hi ${VICTIM},`)).toBe(true);
    // The record name was not used: the stored name of the appointment is what she typed.
    expect(
      (await pg.query(`SELECT "contactName" FROM "Appointment" WHERE id = $1`, [again.body!.appointment.id]))
        .rows[0].contactName,
    ).toBe(VICTIM);
  });

  it('a record with an EMPTY email is NOT filled by a public booking, and the record name never reaches the booker', async () => {
    const phone = newPhone();
    await prisma.client.create({
      data: { businessId: a.businessId, name: VICTIM, phone: normalizePhone(phone)!, email: null },
    });
    const res = await bookPublicly(a.slug, body(0, SLOT, { phone, name: 'X', email: ATTACKER }));
    expect(res.status).toBe(201);
    await runReminders(deps());
    expect(fake.calls[0]!.to).toBe(ATTACKER);
    expect(await clientEmail(phone)).toBeNull();
    // The booker is greeted with the name HE typed, never the record's.
    expect(fake.calls[0]!.text.startsWith('Hi X,')).toBe(true);
    expect(fake.calls[0]!.text).not.toMatch(NAME_RE);
  });

  it('waitlist offer email: an entry joined with another address does not carry the record name', async () => {
    const holder = await bookPublicly(a.slug, body(0, SLOT, { name: 'Casey', email: 'casey@x.test' }));
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      name: VICTIM,
      email: VICTIM_EMAIL,
      contactEmail: ATTACKER,
      createdAt: new Date(NOW.getTime() - 1_000_000),
    });
    fake.reset();
    expect((await staffCancel(a.cookie, holder.body!.appointment.id)).status).toBe(200);
    const mail = fake.calls.find((c) => c.to === ATTACKER)!;
    expect(mail).toBeTruthy();
    expect(mail.text).not.toMatch(NAME_RE);
    expect(mail.html).not.toMatch(NAME_RE);
    expect(mail.text.startsWith('Hello,')).toBe(true);
  });

  // F60: the attack story end to end, through the real public routes, with a REAL offer email in the outbox.
  it.each(['en', 'ar'] as const)(
    'F60 (%s): booking then joining the waitlist with the victim phone and an attacker address sends an offer with NO victim name',
    async (locale) => {
      await prisma.business.update({ where: { id: a.businessId }, data: { locale } });
      try {
        const phone = newPhone();
        // The victim's record has a name and NO email.
        await prisma.client.create({
          data: { businessId: a.businessId, name: VICTIM, phone: normalizePhone(phone)!, email: null },
        });
        // The attacker books publicly with the victim's phone, name 'x' and his own email: the record stays untouched.
        const attack = await bookPublicly(a.slug, body(1, SLOT2, { phone, name: 'x', email: ATTACKER }));
        expect(attack.status).toBe(201);
        expect(await clientEmail(phone)).toBeNull();
        // ... then joins the waitlist with the same phone and email.
        const joined = await joinWaitlist(
          a.slug,
          joinBody(scn.serviceId, {
            staffId: null,
            fromDate: '2026-11-04',
            toDate: '2026-11-04',
            client: { name: 'x', phone, email: ATTACKER },
          }),
        );
        expect(joined.status).toBe(201);
        expect(await clientEmail(phone)).toBeNull();

        // A slot is freed: the offer delivery runs (inline on cancel, and the cron sweep after it).
        const holder = await bookPublicly(a.slug, body(0, SLOT, { name: 'Casey', email: 'casey@x.test' }));
        fake.reset();
        expect((await staffCancel(a.cookie, holder.body!.appointment.id)).status).toBe(200);
        await runExpiry();

        // Exactly one offer email, to the attacker's address (so the assertions below are about a real mail).
        const offers = fake.calls.filter((c) => /\/o\/[A-Za-z0-9_.-]+/.test(c.text));
        expect(offers).toHaveLength(1);
        const mail = offers[0]!;
        expect(mail.to).toBe(ATTACKER);
        const hello = locale === 'ar' ? 'مرحبا،' : 'Hello,';
        for (const part of [mail.text, mail.html, mail.subject]) expect(part).not.toMatch(NAME_RE);
        expect(mail.text.startsWith(hello)).toBe(true);
        expect(mail.html).toContain(hello);
      } finally {
        await prisma.business.update({ where: { id: a.businessId }, data: { locale: 'en' } });
      }
    },
  );

  it('waitlist offer email to the record email keeps the name', async () => {
    const holder = await bookPublicly(a.slug, body(0, SLOT, { name: 'Casey', email: 'casey@x.test' }));
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      name: VICTIM,
      email: VICTIM_EMAIL,
      createdAt: new Date(NOW.getTime() - 1_000_000),
    });
    fake.reset();
    expect((await staffCancel(a.cookie, holder.body!.appointment.id)).status).toBe(200);
    const mail = fake.calls.find((c) => c.to === VICTIM_EMAIL)!;
    expect(mail.text.startsWith(`Hi ${VICTIM},`)).toBe(true);
  });
});

describe('review B1: a public booking never fills or changes the record of an existing client', () => {
  const VICTIM = 'Zainab Haddad';
  const ATTACKER = 'mallory@evil.test';
  const NAME_RE = /Zainab|Haddad/i;
  const recordOf = async (phone: string) =>
    (
      await pg.query(`SELECT name, email FROM "Client" WHERE phone = $1 AND "businessId" = $2`, [
        normalizePhone(phone)!,
        a.businessId,
      ])
    ).rows[0] as { name: string; email: string | null };

  // The victim: a phone-only record created at the front desk, with an earlier appointment.
  async function phoneOnlyVictim() {
    const phone = newPhone();
    const earlier = await bookAtFrontDesk(a.cookie, body(0, SLOT, { phone, name: VICTIM }));
    expect(earlier.status).toBe(201);
    expect(await recordOf(phone)).toEqual({ name: VICTIM, email: null });
    return { phone, earlierId: earlier.body!.appointment.id as string };
  }

  it('scenario B: record name/email unchanged; the victim earlier appointment mails nobody (no attacker mail)', async () => {
    const { phone, earlierId } = await phoneOnlyVictim();
    const evil = await bookPublicly(a.slug, body(1, SLOT2, { phone, name: 'x', email: ATTACKER }));
    expect(evil.status).toBe(201);
    expect(await recordOf(phone)).toEqual({ name: VICTIM, email: null });
    expect((await row(evil.body!.appointment.id)).contactEmail).toBe(ATTACKER);
    await runReminders(deps());
    // Only the attacker's own booking is mailed, to the attacker, greeted with the typed name.
    expect(tos()).toEqual([ATTACKER]);
    expect(fake.calls[0]!.text.startsWith('Hi x,')).toBe(true);
    expect(fake.calls[0]!.text).not.toMatch(NAME_RE);
    expect((await jobs(earlierId)).every((j) => j.channel !== 'EMAIL' || j.status !== 'SENT')).toBe(true);
    // Later reminders of the victim's earlier appointment still go nowhere near the attacker.
    fake.reset();
    const due = new Date(Date.parse(SLOT) - 24 * 3_600_000 + 60_000);
    vi.setSystemTime(due);
    await runReminders(deps(due));
    expect(tos().includes(ATTACKER)).toBe(false);
  });

  it.each(['en', 'ar'])(
    'scenario A (%s): attacker also joins the waitlist with the same phone+email; the offer has no victim name',
    async (locale) => {
      await prisma.business.update({ where: { id: a.businessId }, data: { locale } });
      try {
        const { phone } = await phoneOnlyVictim();
        const evil = await bookPublicly(a.slug, body(1, SLOT2, { phone, name: 'x', email: ATTACKER }));
        expect(evil.status).toBe(201);
        const holder = await bookPublicly(a.slug, body(2, at('09:00'), { name: 'Casey', email: 'casey@x.test' }));
        const joined = await joinWaitlist(
          a.slug,
          joinBody(scn.serviceId, { client: { name: 'x', phone, email: ATTACKER } }),
        );
        expect([200, 201]).toContain(joined.status);
        expect(await recordOf(phone)).toEqual({ name: VICTIM, email: null });
        fake.reset();
        expect((await staffCancel(a.cookie, holder.body!.appointment.id)).status).toBe(200);
        const mail = fake.calls.find((c) => c.to === ATTACKER)!;
        expect(mail).toBeTruthy();
        expect(mail.text).not.toMatch(NAME_RE);
        expect(mail.html).not.toMatch(NAME_RE);
        expect(mail.subject).not.toMatch(NAME_RE);
        const hello = locale === 'ar' ? 'مرحبا،' : 'Hello,';
        expect(mail.text.startsWith(hello)).toBe(true);
        expect(mail.html).toContain(hello);
      } finally {
        await prisma.business.update({ where: { id: a.businessId }, data: { locale: 'en' } });
      }
    },
  );

  it('a brand-new phone: the booking creates the record with the typed name and email', async () => {
    const phone = newPhone();
    const r = await bookPublicly(a.slug, body(0, SLOT, { phone, name: 'Newcomer', email: OLD }));
    expect(r.status).toBe(201);
    expect(await recordOf(phone)).toEqual({ name: 'Newcomer', email: OLD });
  });

  it('a returning phone-only client booking publicly: record stays empty, mail and promise use the appointment address', async () => {
    const { phone } = await phoneOnlyVictim();
    const res = await bookPublicly(a.slug, body(1, SLOT2, { phone, name: VICTIM, email: NEW }));
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual({ h24: true, h2: true, email: true });
    expect(await recordOf(phone)).toEqual({ name: VICTIM, email: null });
    await runReminders(deps());
    expect(tos()).toEqual([NEW]);
    expect(fake.calls[0]!.text.startsWith(`Hi ${VICTIM},`)).toBe(true); // the name she typed
  });

  it('front desk still sets/replaces the record email and name', async () => {
    const { phone } = await phoneOnlyVictim();
    const fd = await bookAtFrontDesk(
      a.cookie,
      body(1, SLOT2, { phone, name: 'Zainab H.', email: OLD }),
    );
    expect(fd.status).toBe(201);
    expect(await recordOf(phone)).toEqual({ name: 'Zainab H.', email: OLD });
  });
});

describe('review: anonymisation details', () => {
  it('in-flight anonymisation: a booking that lands on the tombstone stores contactEmail NULL', async () => {
    const tomb = await prisma.client.create({
      data: { businessId: a.businessId, name: DELETED_CLIENT_NAME, phone: 'deleted:inflight-1' },
    });
    const spy = vi.spyOn(clientRepo, 'upsertByPhone').mockResolvedValueOnce(tomb as never);
    try {
      const res = await bookPublicly(a.slug, body(0, SLOT, { email: OLD }));
      expect(res.status).toBe(201);
      expect((await row(res.body!.appointment.id)).contactEmail).toBeNull();
      expect(
        (await pg.query(`SELECT "contactName" FROM "Appointment" WHERE id = $1`, [res.body!.appointment.id]))
          .rows[0].contactName,
      ).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('DELETE nulls WaitlistEntry.contactEmail of that client only (any status), same tenant scope', async () => {
    const mine = await seedEntry(prisma, a.businessId, scn.serviceId, {
      email: 'mine@x.test',
      contactEmail: 'mine-contact@x.test',
      createdAt: new Date(NOW.getTime() - 1_000),
    });
    const other = await seedEntry(prisma, a.businessId, scn.serviceId, {
      email: 'other@x.test',
      contactEmail: 'other-contact@x.test',
      createdAt: new Date(NOW.getTime() - 1_000),
    });
    await pg.query(`UPDATE "WaitlistEntry" SET status = 'FULFILLED' WHERE id = $1`, [mine.entryId]);
    const del = await call(deleteClient, `/api/clients/${mine.clientId}`, {
      method: 'DELETE',
      cookie: a.cookie,
      params: { id: mine.clientId },
    });
    expect(del.status).toBe(204);
    const emailOf = async (id: string) =>
      (await pg.query(`SELECT "contactEmail" FROM "WaitlistEntry" WHERE id = $1`, [id])).rows[0]
        .contactEmail;
    expect(await emailOf(mine.entryId)).toBeNull();
    expect(await emailOf(other.entryId)).toBe('other-contact@x.test');
  });

  it('repo level: anonymise is scoped by businessId (same phone in another tenant is untouched)', async () => {
    const phone = newPhone();
    const mineBooking = await bookPublicly(a.slug, body(0, SLOT, { phone, email: OLD }));
    const theirs = await bookPublicly(
      b.slug,
      bookingBody(bScn.serviceId, bScn.staffIds[0]!, SLOT, { phone, email: NEW }),
    );
    expect(theirs.status).toBe(201);
    const theirClient = (await row(theirs.body!.appointment.id)).clientId;
    const mine = (await row(mineBooking.body!.appointment.id)).clientId;
    // Wrong tenant for the id: nothing happens.
    expect(await clientRepo.anonymise(a.businessId, theirClient, NOW)).toBeNull();
    expect((await row(theirs.body!.appointment.id)).contactEmail).toBe(NEW);
    // Right tenant: only its own appointments lose the address.
    expect(await clientRepo.anonymise(a.businessId, mine, NOW)).not.toBeNull();
    expect((await row(mineBooking.body!.appointment.id)).contactEmail).toBeNull();
    expect((await row(theirs.body!.appointment.id)).contactEmail).toBe(NEW);
  });

  it('a stored malformed address is skipped as no_email, not sent', async () => {
    const res = await bookPublicly(a.slug, body(0, SLOT, { email: OLD }));
    const id = res.body!.appointment.id as string;
    await pg.query(`UPDATE "Appointment" SET "contactEmail" = 'not an address' WHERE id = $1`, [id]);
    await pg.query(`UPDATE "Client" SET email = NULL WHERE id = $1`, [(await row(id)).clientId]);
    await runReminders(deps());
    expect(fake.calls).toHaveLength(0);
    const j = await jobs(id);
    expect(j.some((x) => x.status === 'SKIPPED')).toBe(true);
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
