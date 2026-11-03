/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies and SQL rows */
import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import {
  api,
  createBusiness,
  cron,
  linkFor,
  linksIn,
  mailsTo,
  newPhone,
  offerMailsTo,
  outbox,
  PASSWORD,
  resetOutbox,
  sql,
  uniqueTag,
  waitForMail,
  type Business,
  type Mail,
} from './helpers/journey';
import { JOURNEY_URL } from './helpers/journeyEnv';

/**
 * F26: the scope document's stage item 5 on the REAL stack. A production build (second `next start`, see
 * playwright.config.ts) with real Postgres, real route handlers, a real browser and the real cron routes. The only
 * stand-in is the network edge of the email provider: the server runs the real Resend provider and a preloaded stub
 * answers its HTTPS call and writes every email to a file, which this spec reads like an inbox. NO page.route.
 *
 * One serial journey on the mobile project. Business timezone is Asia/Tokyo on purpose: neither the dev machine
 * (Beirut) nor CI (UTC) is in it, so a server-zone leak into the emails or pages would show up as a wrong time.
 */

test.use({ baseURL: JOURNEY_URL });
test.describe.configure({ mode: 'serial' });
test.skip(
  ({ isMobile }) => !isMobile,
  'the journey is a phone flow and mutates shared state: run it once',
);

const TZ = 'Asia/Tokyo';
const SERVICE = 'Haircut';
const OTHER_SERVICE = 'Beard trim';

// ---- shared journey state --------------------------------------------------------------------------------

interface Person {
  name: string;
  email: string;
  phone: { typed: string; e164: string };
}
const person = (name: string, tag: string): Person => ({
  name: `${name} ${tag}`, // unique per run: the database outlives a run
  email: `${name.toLowerCase().replace(/\W+/g, '')}-${tag}@example.test`,
  phone: newPhone(),
});

/** The dashboard and the booked screen show first names only. */
const first = (p: Person) => p.name.split(' ')[0]!;
const tag = uniqueTag();
let biz: Business;
let bizB: Business;
let A: Person, W1: Person, W2: Person, W3: Person, W4: Person, W5: Person;
let day: DateTime; // the local day of slot S (two days ahead: always more than 24 h away, so H24 and H2 both apply)
let slotStart: Date;
let aAppointmentId: string;
const offers: { id: string; entryName: string; mail: Mail }[] = [];
let winner: Person;
let loser: Person;

// ---- page helpers ------------------------------------------------------------------------------------------

/** Book through the real public page: service -> person -> day and time -> details (4 screens). */
async function bookViaUi(page: Page, b: Business, who: Person, dayIso: DateTime, time = '09:00') {
  await page.goto(`/b/${b.slug}`);
  await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(SERVICE) }).click();
  // With one bookable person the staff screen is skipped (fewer screens, still within four).
  const staffHeading = page.getByRole('heading', { name: 'Who would you like?' });
  const timeHeading = page.getByRole('heading', { name: 'Pick a day and time' });
  await expect(staffHeading.or(timeHeading)).toBeVisible();
  if (await staffHeading.isVisible())
    await page.getByRole('button', { name: /Anyone available/ }).click();
  await expect(timeHeading).toBeVisible();
  // Pill label: 'Mon, Nov 2, 5 times available' (the date comes first; the count after it must not match).
  const [d, mon] = [dayIso.toFormat('d'), dayIso.toFormat('LLL')];
  const dayRe = new RegExp(`^\\w{3},? (?:${mon} ${d}|${d} ${mon})\\b`);
  const pill = page.getByRole('radio', { name: dayRe });
  await pill.click();
  await expect(pill).toBeChecked();
  await page.getByRole('radio', { name: time, exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
  await page.getByLabel('Full name').fill(who.name);
  await page.getByLabel('Mobile number').fill(who.phone.typed);
  await page.getByLabel('Email (optional)').fill(who.email);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(
    page.getByRole('heading', { name: `You're booked, ${who.name.split(' ')[0]}!` }),
  ).toBeVisible();
}

/** Join through the real waitlist page (any staff member, default date range = today .. +13 days). */
async function joinViaUi(page: Page, b: Business, who: Person, service: string) {
  await page.goto(`/b/${b.slug}/waitlist`);
  await expect(page.getByRole('heading', { name: 'Join the waitlist', level: 2 })).toBeVisible();
  await page.getByLabel('Service').selectOption(b.services[service]!.id);
  await page.getByLabel('Full name').fill(who.name);
  await page.getByLabel('Mobile number').fill(who.phone.typed);
  await page.getByLabel('Email').fill(who.email);
  await page.getByRole('button', { name: 'Join the waitlist' }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
}

async function cancelViaLink(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Need to cancel?' })).toBeVisible();
  await page.getByRole('button', { name: "I can't come, cancel" }).click();
  await page
    .getByRole('dialog', { name: 'Cancel this appointment?' })
    .getByRole('button', { name: 'Yes, cancel appointment' })
    .click();
  await expect(page.getByRole('heading', { name: 'Appointment cancelled' })).toBeVisible();
}

const claimButton = (page: Page) => page.getByRole('button', { name: 'Book this slot' });
const takenHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Someone else got this slot' });
const bookedHeading = (page: Page) => page.getByRole('heading', { name: "You're booked" });

async function newPhoneContext(browser: Browser, playwrightDevices: any): Promise<BrowserContext> {
  return browser.newContext({ ...playwrightDevices['Pixel 5'], baseURL: JOURNEY_URL });
}

const localTime = (d: Date | string) =>
  DateTime.fromJSDate(new Date(d), { zone: TZ }).toFormat('HH:mm');

/** Offers of one freed appointment, joined with the entry's client name, oldest first. */
const offersOf = (appointmentId: string) =>
  sql(
    `SELECT o.id, o.status, o.batch, o."expiresAt", o."startAt", o."emailedAt", c.name, e.status AS "entryStatus", e.id AS "entryId"
       FROM "WaitlistOffer" o
       JOIN "WaitlistEntry" e ON e.id = o."entryId"
       JOIN "Client" c ON c.id = e."clientId"
      WHERE o."freedFromAppointmentId" = $1
      ORDER BY o.batch, e."createdAt"`,
    [appointmentId],
  );

/** The statement from scripts/db/check-overlaps.sql, restricted to this journey's businesses. */
async function overlappingRows() {
  const file = readFileSync('scripts/db/check-overlaps.sql', 'utf8');
  const rows = await sql(file.replace(/;\s*$/, ''));
  return rows;
}

test.beforeAll(async () => {
  // Real server clock on purpose (the only real-stack spec). All dates are computed in the BUSINESS zone, two
  // days ahead, so neither the runner's zone nor today's remaining slots matter. The Today view and the day
  // labels would shift if the business day rolled over mid-run, so do not start in the last minutes of it.
  const nowLocal = DateTime.now().setZone(TZ);
  const minutesToMidnight = nowLocal.endOf('day').diff(nowLocal, 'minutes').minutes;
  test.skip(
    minutesToMidnight < 5,
    `within 5 minutes of midnight in ${TZ} (${nowLocal.toFormat('HH:mm')}): the business day would roll over mid-journey; run again shortly`,
  );
  resetOutbox();
  day = nowLocal.startOf('day').plus({ days: 2 });
});

// ---- 1. setup and the first booking ----------------------------------------------------------------------------

test('1. a client books slot S through the real booking page; four waitlisted people join through the real waitlist page', async ({
  page,
}) => {
  test.setTimeout(180_000);
  biz = await createBusiness({
    name: `Studio F26 ${tag}`,
    timezone: TZ,
    services: [SERVICE, OTHER_SERVICE],
  });
  bizB = await createBusiness({ name: `Other Place ${tag}`, timezone: TZ, services: [SERVICE] });
  A = person('Aya Client', tag);
  W1 = person('Wendy One', tag);
  W2 = person('Wally Two', tag);
  W3 = person('Willa Three', tag);
  W4 = person('Wes Four', tag);
  W5 = person('Wren Five', tag);

  await bookViaUi(page, biz, A, day);
  const [appt] = await sql(
    `SELECT a.id, a.status, a.source, a."startAt", a."blockedUntil" FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId" WHERE c.name = $1 AND a."staffId" = $2`,
    [A.name, biz.staffId],
  );
  expect(appt.status).toBe('BOOKED');
  expect(appt.source).toBe('PUBLIC');
  aAppointmentId = appt.id;
  slotStart = appt.startAt;
  // 09:00 in the BUSINESS zone (Tokyo), not in the server's or the browser's zone.
  expect(localTime(slotStart)).toBe('09:00');
  expect(DateTime.fromJSDate(slotStart, { zone: TZ }).toISODate()).toBe(day.toISODate());

  // The waitlist: W1, W2, W3 want a Haircut (any staff); W4 wants another service; W5 waits at another business.
  await joinViaUi(page, biz, W1, SERVICE);
  await joinViaUi(page, biz, W2, SERVICE);
  await joinViaUi(page, biz, W3, SERVICE);
  await joinViaUi(page, biz, W4, OTHER_SERVICE);
  await joinViaUi(page, bizB, W5, SERVICE);

  const entries = await sql(
    `SELECT c.name, e.status, e."staffId", e."createdAt" FROM "WaitlistEntry" e JOIN "Client" c ON c.id = e."clientId" WHERE c.name = ANY($1) ORDER BY e."createdAt"`,
    [[W1.name, W2.name, W3.name, W4.name, W5.name]],
  );
  expect(entries.map((e: any) => e.name)).toEqual([W1, W2, W3, W4, W5].map((w) => w.name));
  expect(entries.every((e: any) => e.status === 'OPEN' && e.staffId === null)).toBe(true);
});

// ---- 2. the cancellation frees the slot and offers go out -------------------------------------------------------

test('2. A cancels from the link in the confirmation email: slot freed, reminders skipped, offers go to W1..W3 only', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The booking confirmation is produced by the reminders cron (as in production), then read from the inbox.
  expect((await cron('reminders')).status).toBe(200);
  const confirmation = await waitForMail('A booking confirmation', () => mailsTo(A.email)[0]);
  expect(confirmation.subject).toContain('Booking confirmed');
  expect(confirmation.idempotencyKey).toBeTruthy();

  const cancelPath = linkFor(confirmation, 'cancel');
  const before = outbox().length;
  await cancelViaLink(page, cancelPath);
  await expect(page.getByText('No fee was charged.')).toBeVisible();

  // DB: cancelled by the client's link, the slot is bookable again, the remaining reminders are skipped.
  const [appt] = await sql(`SELECT status, "cancelledVia" FROM "Appointment" WHERE id = $1`, [
    aAppointmentId,
  ]);
  expect(appt).toMatchObject({ status: 'CANCELLED', cancelledVia: 'LINK' });
  const jobs = await sql(
    `SELECT kind, channel, status FROM "ReminderJob" WHERE "appointmentId" = $1 ORDER BY kind, channel`,
    [aAppointmentId],
  );
  const status = (kind: string, channel: string) =>
    jobs.find((j: any) => j.kind === kind && j.channel === channel)?.status;
  expect(status('BOOKING', 'EMAIL')).toBe('SENT');
  for (const [kind, channel] of [
    ['H24', 'EMAIL'],
    ['H24', 'WHATSAPP'],
    ['H2', 'EMAIL'],
    ['H2', 'WHATSAPP'],
  ] as const)
    expect(status(kind, channel), `${kind}/${channel}`).toBe('SKIPPED');
  const free = await api(
    `/api/public/${biz.slug}/slots?serviceId=${biz.services[SERVICE]!.id}&staffId=${biz.staffId}&from=${day.toISODate()}&to=${day.toISODate()}`,
  );
  expect(free.status).toBe(200);
  expect(free.body.slots.map((s: any) => new Date(s.startAt).getTime())).toContain(
    new Date(slotStart).getTime(),
  );

  // Offers: batch 1 = the first three matching entries in join order (W1, W2, W3); never W4 (other service) or W5 (other business).
  const rows = await offersOf(aAppointmentId);
  expect(rows.map((r: any) => r.name)).toEqual([W1.name, W2.name, W3.name]);
  expect(rows.every((r: any) => r.status === 'OPEN' && r.batch === 1 && r.emailedAt)).toBe(true);
  expect(
    rows.every((r: any) => new Date(r.startAt).getTime() === new Date(slotStart).getTime()),
  ).toBe(true);

  for (const who of [W1, W2, W3]) {
    const mail = await waitForMail(`offer to ${who.name}`, () => offerMailsTo(who.email)[0]);
    const row = rows.find((r: any) => r.name === who.name);
    // One email per entry; the provider idempotency key is derived from the offer id.
    expect(offerMailsTo(who.email)).toHaveLength(1);
    expect(mail.idempotencyKey).toBe(`waitlist-offer-${row.id}`);
    // Content: business, service, the slot in the BUSINESS zone, the expiry in the same zone, both links.
    expect(mail.subject).toBe(
      `A spot opened up: ${SERVICE} on ${day.toFormat('cccc d LLLL yyyy')} at 09:00`,
    );
    expect(mail.text).toContain(biz.name);
    expect(mail.text).toContain(`Service: ${SERVICE}`);
    expect(mail.text).toContain(`With: ${biz.staffName}`);
    expect(mail.text).toContain(`When: ${day.toFormat('cccc d LLLL yyyy')}, 09:00`);
    expect(mail.text).toContain(`held for you until ${localTime(row.expiresAt)}.`);
    expect(mail.html).toContain('Take this spot');
    const claim = linksIn(mail).find((l) => l.payload.act === 'claim')!;
    const leave = linksIn(mail).find((l) => l.payload.act === 'leave')!;
    expect(claim.payload.o).toBe(row.id);
    expect(leave.payload.o).toBe(row.id);
    expect(leave.path).toMatch(/\/leave$/);
    // Offer lasts about 30 minutes (slot is days away, so min(now + 30 min, start - minNotice) = 30 min).
    const minutes =
      (new Date(row.expiresAt).getTime() - new Date(row.emailedAt).getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(25);
    expect(minutes).toBeLessThanOrEqual(30.5);
    offers.push({ id: row.id, entryName: who.name, mail });
  }
  // Nobody else got an offer: not W4 (different service), not W5 (different business), not A.
  for (const other of [W4, W5, A]) expect(offerMailsTo(other.email), other.name).toHaveLength(0);
  const sent = outbox()
    .slice(before)
    .filter((m) => m.idempotencyKey.startsWith('waitlist-offer-'));
  expect(sent).toHaveLength(3);
  expect(new Set(sent.map((m) => m.idempotencyKey)).size).toBe(3);
  expect(outbox().some((m) => m.duplicate)).toBe(false);
  expect(
    await api(`/api/offers/${linkFor(offers[0]!.mail, 'claim').split('/o/')[1]}`).then(
      (r) => r.status,
    ),
  ).toBe(200);
});

// ---- 3. two people claim at the same moment ----------------------------------------------------------------------

test('3. W1 and W2 tap "Book this slot" at the same moment: exactly one booking, the loser is told and stays on the list', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const [c1, c2] = await Promise.all([
    newPhoneContext(browser, playwright.devices),
    newPhoneContext(browser, playwright.devices),
  ]);
  try {
    const [p1, p2] = await Promise.all([c1.newPage(), c2.newPage()]);
    await Promise.all([
      p1.goto(linkFor(offers[0]!.mail, 'claim')),
      p2.goto(linkFor(offers[1]!.mail, 'claim')),
    ]);
    // Both see the live offer (opening it changes nothing).
    for (const p of [p1, p2]) {
      await expect(p.getByRole('heading', { name: 'A spot just opened up' })).toBeVisible();
      await expect(claimButton(p)).toBeEnabled();
    }
    await expect(
      p1.getByText(
        `Offer expires at ${DateTime.fromJSDate((await offersOf(aAppointmentId))[0].expiresAt, { zone: TZ }).toFormat('HH:mm')}`,
      ),
    ).toBeVisible();
    expect(
      await sql(
        `SELECT count(*)::int AS n FROM "Appointment" WHERE "staffId" = $1 AND "startAt" = $2 AND status IN ('BOOKED','CONFIRMED','PENDING_PAYMENT')`,
        [biz.staffId, slotStart],
      ),
    ).toEqual([{ n: 0 }]);

    // Fire both claims together.
    await Promise.all([claimButton(p1).click(), claimButton(p2).click()]);
    await expect(async () => {
      const booked = (await bookedHeading(p1).count()) + (await bookedHeading(p2).count());
      const taken = (await takenHeading(p1).count()) + (await takenHeading(p2).count());
      expect({ booked, taken }).toEqual({ booked: 1, taken: 1 });
    }).toPass({ timeout: 20_000 });

    const w1Won = (await bookedHeading(p1).count()) === 1;
    winner = w1Won ? W1 : W2;
    loser = w1Won ? W2 : W1;
    const [winPage, losePage] = w1Won ? [p1, p2] : [p2, p1];

    // Winner: confirmation with the slot, the reminders note and a manage link.
    await expect(winPage.getByText(`${SERVICE}`).first()).toBeVisible();
    await expect(winPage.getByText('We will email you reminders 24 hours and 2 hours before.')).toBeVisible();
    await expect(
      winPage.getByRole('link', { name: /Confirm or cancel your booking/ }),
    ).toHaveAttribute('href', /\/l\//);
    // Loser: the clear state, a way forward, and nothing booked for them.
    await expect(
      losePage.getByText(/You stay on the waitlist until the last day you chose/),
    ).toBeVisible();
    await expect(losePage.getByRole('link', { name: 'See free times' })).toHaveAttribute(
      'href',
      `/b/${biz.slug}`,
    );
    await expect(claimButton(losePage)).toHaveCount(0);
  } finally {
    await Promise.all([c1.close(), c2.close()]);
  }

  // DB: ONE active booking for S, source WAITLIST, owned by the winner; the loser's entry is still OPEN.
  const active = await sql(
    `SELECT a.id, a.status, a.source, c.name FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId"
      WHERE a."staffId" = $1 AND a."startAt" = $2 AND a.status IN ('BOOKED','CONFIRMED','PENDING_PAYMENT')`,
    [biz.staffId, slotStart],
  );
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ source: 'WAITLIST', name: winner.name, status: 'BOOKED' });
  const rows = await offersOf(aAppointmentId);
  const byName = (n: string) => rows.find((r: any) => r.name === n);
  expect(byName(winner.name)).toMatchObject({ status: 'CLAIMED', entryStatus: 'FULFILLED' });
  expect(byName(loser.name)).toMatchObject({ status: 'SUPERSEDED', entryStatus: 'OPEN' });
  expect(byName(W3.name)).toMatchObject({ status: 'SUPERSEDED', entryStatus: 'OPEN' });
  expect(rows.filter((r: any) => r.status === 'CLAIMED')).toHaveLength(1);
  // W4 and W5 are untouched.
  const others = await sql(
    `SELECT c.name, e.status FROM "WaitlistEntry" e JOIN "Client" c ON c.id = e."clientId" WHERE c.name = ANY($1)`,
    [[W4.name, W5.name]],
  );
  expect(others.every((o: any) => o.status === 'OPEN')).toBe(true);
});

// ---- 4. the owner sees the refill ------------------------------------------------------------------------------------

test('4. the owner logs in and sees the replacement booking as refilled from the waitlist, with reminders and a confirmation email', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Reminder jobs exist for the winner: the confirmation now, 24 h and 2 h before (the slot is two days away).
  const [appt] = await sql(
    `SELECT a.id FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId" WHERE a."staffId" = $1 AND a."startAt" = $2 AND a.status = 'BOOKED'`,
    [biz.staffId, slotStart],
  );
  const jobs = await sql(
    `SELECT kind, channel, status FROM "ReminderJob" WHERE "appointmentId" = $1`,
    [appt.id],
  );
  expect(jobs.map((j: any) => `${j.kind}/${j.channel}`).sort()).toEqual(
    ['BOOKING/EMAIL', 'H24/EMAIL', 'H24/WHATSAPP', 'H2/EMAIL', 'H2/WHATSAPP'].sort(),
  );
  expect(await cron('reminders').then((r) => r.status)).toBe(200);
  const confirmation = await waitForMail('winner booking confirmation', () =>
    mailsTo(winner.email).find((m) => m.subject.startsWith('Booking confirmed')),
  );
  expect(confirmation.text).toContain(`${day.toFormat('cccc d LLLL yyyy')}, 09:00`);
  expect(
    mailsTo(winner.email).filter((m) => m.subject.startsWith('Booking confirmed')),
  ).toHaveLength(1);

  // Real login, then the dashboard.
  await page.goto('/login');
  await page.locator('input[name=email]').fill(biz.ownerEmail);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/app/);
  await expect(page.getByRole('heading', { name: 'Waitlist activity' })).toBeVisible();
  // The activity card names the winner and the slot.
  await expect(page.getByText(`${first(winner)} took 09:00 with ${biz.staffName}`)).toBeVisible();

  // F45: the tile counts refills made ON the viewed day, so today (when the claim happened) reads 1 ...
  await expect(page.getByText('Refilled from waitlist today').locator('..')).toContainText('1');

  // ... and on the day of the slot the replacement booking is listed, but the counter reads 0.
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Next day' }).click();
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: new RegExp(`${day.toFormat('LLLL')} ${day.toFormat('d')}$`),
    }),
  ).toBeVisible();
  const refilledTile = page.getByText('Refilled from waitlist on this day').locator('..');
  await expect(refilledTile).toContainText('0');
  // The agenda card is badged "Waitlist" so the front desk sees where the booking came from.
  const card = page.getByRole('button', { name: new RegExp(`${first(winner)}.*Waitlist`) });
  await expect(card).toHaveCount(1);
  // A, who cancelled, is not on the day.
  await expect(page.getByText(A.name)).toHaveCount(0);

  // The booking's own page says where it came from.
  await page.goto(`/app/appointments/${appt.id}`);
  await expect(page.getByText(/from the waitlist/)).toBeVisible();

  // The data behind the pilot refill count is right: this business has exactly one CLAIMED offer.
  // (The pilot report itself is checked at the end of this file, finding F26-1.)
  const claimed = await sql(
    `SELECT count(DISTINCT o."freedFromAppointmentId")::int AS n FROM "WaitlistOffer" o JOIN "Appointment" a ON a.id = o."freedFromAppointmentId" WHERE a."staffId" = $1 AND o.status = 'CLAIMED'`,
    [biz.staffId],
  );
  expect(claimed).toEqual([{ n: 1 }]);
});

// ---- 5. expiry cascade -------------------------------------------------------------------------------------------------

let secondFreed: string;
const secondOffers: { id: string; name: string; mail: Mail }[] = [];
let W6: Person, W7: Person;

test('5. an offer lapses: the job expires it, offers the NEXT batch once, and the expired link shows the friendly state', async ({
  page,
}) => {
  test.setTimeout(150_000);
  W6 = person('Wilma Six', tag);
  W7 = person('Walid Seven', tag);
  const C = person('Cleo Client', tag);
  const day2 = day.plus({ days: 1 });
  await joinViaUi(page, biz, W6, SERVICE);
  await joinViaUi(page, biz, W7, SERVICE);
  await bookViaUi(page, biz, C, day2);
  expect((await cron('reminders')).status).toBe(200);
  const confirmation = await waitForMail('C booking confirmation', () => mailsTo(C.email)[0]);
  await cancelViaLink(page, linkFor(confirmation, 'cancel'));

  const [freed] = await sql(
    `SELECT a.id FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId" WHERE c.name = $1`,
    [C.name],
  );
  secondFreed = freed.id;
  // Batch 1 = the first three open entries in join order: the winner is fulfilled and W4/W5 do not match, so it is the loser of step 3, W3 and W6.
  let rows = await offersOf(secondFreed);
  expect(rows.map((r: any) => `${r.batch}:${r.name}`)).toEqual([
    `1:${loser.name}`,
    `1:${W3.name}`,
    `1:${W6.name}`,
  ]);
  for (const r of rows) {
    const who = [loser, W3, W6].find((w) => w.name === r.name)!;
    const mail = await waitForMail(`offer to ${who.name}`, () =>
      offerMailsTo(who.email).find((m) => m.idempotencyKey === `waitlist-offer-${r.id}`),
    );
    secondOffers.push({ id: r.id, name: r.name, mail });
  }
  expect(offerMailsTo(W7.email)).toHaveLength(0);

  // Let the three offers lapse (the 30 minutes pass), then run the cron route.
  await sql(
    `UPDATE "WaitlistOffer" SET "expiresAt" = now() - interval '1 minute' WHERE "freedFromAppointmentId" = $1`,
    [secondFreed],
  );
  const mailsBefore = outbox().length;
  const run1 = await api('/api/jobs/waitlist-expiry', {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  });
  expect(run1.status).toBe(200);
  expect(run1.body).toMatchObject({ expired: 3, offered: 1 });
  rows = await offersOf(secondFreed);
  expect(rows.filter((r: any) => r.batch === 1).every((r: any) => r.status === 'EXPIRED')).toBe(
    true,
  );
  const next = rows.filter((r: any) => r.batch === 2);
  expect(next.map((r: any) => `${r.name}:${r.status}`)).toEqual([`${W7.name}:OPEN`]);
  const w7Mail = await waitForMail('batch 2 offer to W7', () => offerMailsTo(W7.email)[0]);
  expect(w7Mail.idempotencyKey).toBe(`waitlist-offer-${next[0].id}`);
  secondOffers.push({ id: next[0].id, name: W7.name, mail: w7Mail });

  // Running the job again does not double-send or create anything.
  const run2 = await cron('waitlist-expiry');
  expect(run2.body).toMatchObject({ expired: 0, offered: 0 });
  expect(outbox().length).toBe(mailsBefore + 1);
  expect(offerMailsTo(W7.email)).toHaveLength(1);
  expect(outbox().some((m) => m.duplicate)).toBe(false);

  // the step-3 loser opens the lapsed link: the friendly expired state (and cannot claim).
  await page.goto(linkFor(secondOffers.find((o) => o.name === loser.name)!.mail, 'claim'));
  await expect(page.getByRole('heading', { name: 'This offer has expired' })).toBeVisible();
  await expect(claimButton(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'See free times' })).toHaveAttribute(
    'href',
    `/b/${biz.slug}`,
  );
  // Still on the waitlist.
  const [w2] = await sql(
    `SELECT e.status FROM "WaitlistEntry" e JOIN "Client" c ON c.id = e."clientId" WHERE c.name = $1`,
    [loser.name],
  );
  expect(w2.status).toBe('OPEN');
  // Via the API too: 410 OFFER_EXPIRED, not a booking.
  const token = linkFor(secondOffers.find((o) => o.name === loser.name)!.mail, 'claim').split(
    '/o/',
  )[1]!;
  const claim = await api(`/api/offers/${token}/claim`, { body: {} });
  expect(claim.status).toBe(410);
  expect(claim.body.error.code).toBe('OFFER_EXPIRED');
});

// ---- 6. leave link -----------------------------------------------------------------------------------------------------

test('6. the "remove me from the waitlist" link from an offer email: press once, the entry is gone, pressing again is harmless', async ({
  page,
}) => {
  const w7 = secondOffers.find((o) => o.name === W7.name)!;
  const leavePath = linkFor(w7.mail, 'leave');
  await page.goto(leavePath);
  await expect(page.getByRole('heading', { name: 'Stop waiting for a spot?' })).toBeVisible();
  // Opening the page alone removes nothing (mail scanners open links).
  expect(
    (
      await sql(
        `SELECT e.status FROM "WaitlistEntry" e JOIN "Client" c ON c.id = e."clientId" WHERE c.name = $1`,
        [W7.name],
      )
    )[0].status,
  ).toBe('OPEN');
  await page.getByRole('button', { name: 'Remove me from the waitlist' }).click();
  await expect(page.getByRole('heading', { name: "You're off the waitlist" })).toBeVisible();
  expect(
    (
      await sql(
        `SELECT e.status FROM "WaitlistEntry" e JOIN "Client" c ON c.id = e."clientId" WHERE c.name = $1`,
        [W7.name],
      )
    )[0].status,
  ).toBe('CANCELLED');
  // The owner's list no longer shows W7.
  const open = await api('/api/waitlist', { cookie: biz.cookie });
  expect(open.status).toBe(200);
  expect(open.body.entries.map((e: any) => e.client.firstName)).not.toContain(W7.name.split(' ')[0]);

  // Second press (reload the same link, press again): same friendly answer, no error.
  await page.goto(leavePath);
  await page.getByRole('button', { name: 'Remove me from the waitlist' }).click();
  await expect(page.getByRole('heading', { name: "You're off the waitlist" })).toBeVisible();
  // And a double click on a fresh load sends no error either.
  const again = await api(
    `/api/offers/${leavePath.split('/o/')[1]!.replace(/\/leave$/, '')}/leave`,
    { body: {} },
  );
  expect(again.status).toBeLessThan(300);
  // Their claim link can no longer book anything (the copy it shows is checked at the end, F26-2).
  await page.goto(linkFor(w7.mail, 'claim'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(claimButton(page)).toHaveCount(0);
  const stale = await api(`/api/offers/${linkFor(w7.mail, 'claim').split('/o/')[1]}`);
  expect(stale.body.canClaim).toBe(false);
});

// ---- 7. a direct booking beats the claim; 9. Arabic ----------------------------------------------------------------------

test('7. someone books the freed slot directly before the claim: the claim reports it taken with fresh options, and nothing double-books', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const day3 = day.plus({ days: 2 });
  const D = person('Dina Client', tag);
  const E = person('Eli Direct', tag);
  await bookViaUi(page, biz, D, day3);
  expect((await cron('reminders')).status).toBe(200);
  const confirmation = await waitForMail('D booking confirmation', () => mailsTo(D.email)[0]);
  await cancelViaLink(page, linkFor(confirmation, 'cancel'));
  const [freed] = await sql(
    `SELECT a.id, a."startAt" FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId" WHERE c.name = $1`,
    [D.name],
  );
  const rows = await offersOf(freed.id);
  // W7 left; the loser, W3 and W6 are the open entries, in join order.
  expect(rows.map((r: any) => r.name)).toEqual([loser.name, W3.name, W6.name]);
  const mails: Record<string, Mail> = {};
  for (const r of rows) {
    const who = [loser, W3, W6].find((w) => w.name === r.name)!;
    mails[r.name] = await waitForMail(`offer to ${who.name}`, () =>
      offerMailsTo(who.email).find((m) => m.idempotencyKey === `waitlist-offer-${r.id}`),
    );
  }

  // Eli books the same slot directly through the public booking API (the same insert path as the page).
  const direct = await api(`/api/public/${biz.slug}/bookings`, {
    headers: { 'idempotency-key': `f26-direct-${tag}` },
    body: {
      serviceId: biz.services[SERVICE]!.id,
      staffId: biz.staffId,
      startAt: new Date(freed.startAt).toISOString(),
      client: { name: E.name, phone: E.phone.e164, email: E.email },
    },
  });
  expect(direct.status, JSON.stringify(direct.body)).toBe(201);

  // W3's claim over the API: 409 SLOT_TAKEN, with fresh slot options to offer instead.
  const w3Token = linkFor(mails[W3.name]!, 'claim').split('/o/')[1]!;
  const view = await api(`/api/offers/${w3Token}`);
  expect(view.status).toBe(200);
  const lost = await api(`/api/offers/${w3Token}/claim`, { body: {} });
  expect(lost.status).toBe(409);
  expect(lost.body.error.code).toBe('SLOT_TAKEN');
  // Fresh options for the same day, none of them the slot that was just taken.
  const fresh: { startAt: string }[] = lost.body.error.data.slots;
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.map((x) => new Date(x.startAt).getTime())).not.toContain(
    new Date(freed.startAt).getTime(),
  );

  // the step-3 loser claim in the browser: the taken state with a way to see free times.
  await page.goto(linkFor(mails[loser.name]!, 'claim'));
  await claimButton(page).click();
  await expect(takenHeading(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'See free times' })).toBeVisible();

  // Arabic run (9): W6's offer, same situation, in Arabic and right-to-left.
  await context.addCookies([{ name: 'locale', value: 'ar', url: JOURNEY_URL }]);
  await page.goto(linkFor(mails[W6.name]!, 'claim'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'توفر موعد للتو' })).toBeVisible();
  await page.getByRole('button', { name: 'احجز هذا الموعد' }).click();
  await expect(page.getByRole('heading', { name: 'حجز شخص آخر هذا الموعد' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'عرض الأوقات المتاحة' })).toBeVisible();
  await context.clearCookies({ name: 'locale' });

  // No double booking: exactly one active appointment on that slot, and the entries are still waiting.
  const active = await sql(
    `SELECT c.name FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId" WHERE a."staffId" = $1 AND a."startAt" = $2 AND a.status IN ('BOOKED','CONFIRMED','PENDING_PAYMENT')`,
    [biz.staffId, freed.startAt],
  );
  expect(active.map((r: any) => r.name)).toEqual([E.name]);
  const waiting = await sql(
    `SELECT c.name, e.status FROM "WaitlistEntry" e JOIN "Client" c ON c.id = e."clientId" WHERE c.name = ANY($1) ORDER BY e."createdAt"`,
    [[loser.name, W3.name, W6.name]],
  );
  expect(waiting.every((w: any) => w.status === 'OPEN')).toBe(true);
});

// ---- the guarantee, at the end -----------------------------------------------------------------------------------------------

test('no overlapping active appointments exist anywhere after the journey (scripts/db/check-overlaps.sql)', async () => {
  expect(await overlappingRows()).toEqual([]);
  // Every offer email has its own idempotency key and none was delivered twice.
  const keys = outbox()
    .filter((m) => !m.duplicate)
    .map((m) => m.idempotencyKey);
  expect(new Set(keys).size).toBe(keys.length);
  expect(outbox().some((m) => m.duplicate)).toBe(false);
});

// ---- finding F26-1 -------------------------------------------------------------------------------------------------------

test('pilot report counts the refill: waitlistRefills +1 and three freed slots offered (F26-1)', async () => {
  const report = await api('/api/pilot/report?weeks=4', { cookie: biz.cookie });
  expect(report.status).toBe(200);
  expect(report.body.signals).toMatchObject({ waitlistRefills: 1, waitlistSlotsOffered: 3 });
});

// ---- finding F26-2 -------------------------------------------------------------------------------------------------------

test('a link whose owner left the waitlist shows "This offer can\'t be claimed", in English and in Arabic (F26-2)', async ({
  page,
  context,
}) => {
  const claim = linkFor(secondOffers.find((o) => o.name === W7.name)!.mail, 'claim');
  await page.goto(claim);
  await expect(page.getByRole('heading', { name: "This offer can't be claimed" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Someone else got this slot' })).toHaveCount(0);
  await context.addCookies([{ name: 'locale', value: 'ar', url: JOURNEY_URL }]);
  await page.goto(claim);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'لا يمكن حجز هذا العرض' })).toBeVisible();
});
