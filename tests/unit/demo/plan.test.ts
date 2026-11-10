import { DateTime } from 'luxon';
import { beforeAll, describe, expect, it } from 'vitest';
import { FLAGSHIP_SLUG, MANIFEST } from '../../../scripts/demo/manifest';
import {
  FLAGSHIP_BASELINE,
  ZONE,
  buildPlan,
  recomputeClientCounters,
  summarizePlan,
  type BusinessPlan,
  type DemoPlan,
} from '../../../scripts/demo/plan';
import { weekdayOf } from '../../../scripts/demo/schedule';

const NOW = new Date('2026-11-10T09:30:00Z'); // Tuesday 11:30 in Beirut
const OWNER = { email: 'demo-owner@demo.invalid', name: 'Demo Owner', passwordHash: 'fixed-test-hash' };
const make = (now: Date, only?: string[]) =>
  buildPlan({ now, owner: OWNER, placeholderHash: 'unusable-test-hash', ...(only ? { only } : {}) });

let plan: DemoPlan;
let flagship: BusinessPlan;
const nowMs = NOW.getTime();
const HOUR = 3_600_000;

beforeAll(() => {
  plan = make(NOW);
  flagship = plan.businesses.find((b) => b.spec.slug === FLAGSHIP_SLUG)!;
});

describe('determinism', () => {
  it('same seed and now give identical output; another now or seed does not', () => {
    const a = JSON.stringify(make(NOW, [FLAGSHIP_SLUG, 'olive-branch-barbers']));
    const b = JSON.stringify(make(NOW, [FLAGSHIP_SLUG, 'olive-branch-barbers']));
    expect(a).toBe(b);
    expect(JSON.stringify(make(new Date(NOW.getTime() + 86_400_000), [FLAGSHIP_SLUG]))).not.toBe(
      JSON.stringify(make(NOW, [FLAGSHIP_SLUG])),
    );
    expect(
      JSON.stringify(buildPlan({ now: NOW, seed: 1, owner: OWNER, placeholderHash: 'x', only: [FLAGSHIP_SLUG] })),
    ).not.toBe(JSON.stringify(make(NOW, [FLAGSHIP_SLUG])));
  });
});

describe('whole plan', () => {
  it('has the 18 manifest businesses and the expected account shape', () => {
    expect(plan.businesses).toHaveLength(18);
    expect(flagship.owner.email).toBe(OWNER.email);
    expect(flagship.reception?.name).toBe('Rana');
    for (const b of plan.businesses) {
      if (b.spec.flagship) continue;
      expect(b.owner.email).toBe(`owner+${b.spec.slug}@demo.invalid`);
      expect(b.owner.passwordHash).toBe('unusable-test-hash');
      expect(b.reception).toBeNull();
    }
    // the real owner address exists only for the flagship
    expect(plan.businesses.filter((b) => b.owner.email === OWNER.email)).toHaveLength(1);
    expect(flagship.memberships.map((m) => m.role).sort()).toEqual(['OWNER', 'STAFF']);
  });

  it('gives clients a name, a valid LB phone and NO e-mail, unique across businesses', () => {
    const phones = new Set<string>();
    for (const b of plan.businesses)
      for (const c of b.clients) {
        expect(c.email).toBeNull();
        expect(c.phone).toMatch(/^\+961\d{7,8}$/);
        expect(c.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
        phones.add(c.phone);
      }
    expect(phones.size).toBe(plan.businesses.reduce((n, b) => n + b.clients.length, 0));
    expect(JSON.stringify(plan)).not.toMatch(/lorem|ipsum|placeholder text/i);
  });

  it('keeps references unique and 6 characters', () => {
    const refs = plan.businesses.flatMap((b) => b.appointments.map((a) => a.reference));
    expect(new Set(refs).size).toBe(refs.length);
    for (const r of refs) expect(r).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
  });

  it('sizes lighter businesses: 8 to 25 clients, 20 to 45 appointments over the last four weeks', () => {
    for (const b of plan.businesses) {
      if (b.spec.flagship) continue;
      expect(b.clients.length).toBeGreaterThanOrEqual(8);
      expect(b.clients.length).toBeLessThanOrEqual(25);
      const past = b.appointments.filter(
        (a) => a.startAt.getTime() < nowMs && a.startAt.getTime() >= nowMs - 28 * 24 * HOUR,
      ).length;
      expect(past).toBeGreaterThanOrEqual(20);
      expect(past).toBeLessThanOrEqual(45);
      expect(b.baseline).toBeNull();
      expect(b.waitlistEntries).toHaveLength(0);
    }
  });
});

describe('schedule (every business)', () => {
  it('never overlaps per staff for active statuses, stays inside hours, never on Sunday, respects buffers', () => {
    for (const b of plan.businesses) {
      const hours = new Map<string, { weekday: number; s: string; e: string }[]>();
      for (const w of b.workingHours) {
        const l = hours.get(w.staffId) ?? [];
        l.push({ weekday: w.weekday, s: w.startLocal, e: w.endLocal });
        hours.set(w.staffId, l);
      }
      const svc = new Map(b.services.map((s) => [s.id, s]));
      const byStaff = new Map<string, typeof b.appointments>();
      for (const a of b.appointments) {
        const s = svc.get(a.serviceId)!;
        expect(a.endAt.getTime() - a.startAt.getTime()).toBe(s.durationMin * 60_000);
        expect(a.blockedUntil.getTime() - a.endAt.getTime()).toBe(s.bufferMin * 60_000);
        const start = DateTime.fromJSDate(a.startAt, { zone: ZONE });
        const wd = weekdayOf(start);
        expect(wd).not.toBe(0);
        const end = DateTime.fromJSDate(a.blockedUntil, { zone: ZONE });
        const inside = (hours.get(a.staffId) ?? []).some(
          (h) =>
            h.weekday === wd &&
            start.toFormat('HH:mm') >= h.s &&
            end.toFormat('HH:mm') <= h.e &&
            end.toISODate() === start.toISODate(),
        );
        expect(inside).toBe(true);
        if (['BOOKED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW'].includes(a.status)) {
          const l = byStaff.get(a.staffId) ?? [];
          l.push(a);
          byStaff.set(a.staffId, l);
        }
      }
      for (const list of byStaff.values()) {
        list.sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
        for (let i = 1; i < list.length; i++)
          expect(list[i]!.startAt.getTime()).toBeGreaterThanOrEqual(list[i - 1]!.blockedUntil.getTime());
      }
    }
  });

  it('keeps clients from being in two places at once', () => {
    for (const b of plan.businesses) {
      const by = new Map<string, typeof b.appointments>();
      for (const a of b.appointments) {
        if (['CANCELLED', 'LATE_CANCEL'].includes(a.status)) continue;
        by.set(a.clientId, [...(by.get(a.clientId) ?? []), a]);
      }
      for (const list of by.values()) {
        list.sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
        for (let i = 1; i < list.length; i++)
          expect(list[i]!.startAt.getTime()).toBeGreaterThanOrEqual(list[i - 1]!.blockedUntil.getTime());
      }
    }
  });

  it('stays inside the hours across the March 2026 DST change', () => {
    const p = make(new Date('2026-04-01T10:00:00Z'), [FLAGSHIP_SLUG, 'cedar-barber-lounge']);
    const spring = DateTime.fromISO('2026-03-29', { zone: ZONE });
    let sawAround = false;
    for (const b of p.businesses)
      for (const a of b.appointments) {
        const d = DateTime.fromJSDate(a.startAt, { zone: ZONE });
        expect(d.toFormat('HH:mm') >= '09:00' && d.toFormat('HH:mm') <= '19:59').toBe(true);
        expect(weekdayOf(d)).not.toBe(0);
        if (Math.abs(d.diff(spring, 'days').days) < 3) sawAround = true;
      }
    expect(sawAround).toBe(true);
  });
});

describe('statuses and outcomes follow the real domain rules', () => {
  it('every row is consistent with its status', () => {
    for (const b of plan.businesses)
      for (const a of b.appointments) {
        expect(a.createdAt.getTime()).toBeLessThanOrEqual(nowMs);
        expect(a.createdAt.getTime()).toBeLessThan(a.startAt.getTime());
        expect(a.createdAt.getTime()).toBeGreaterThanOrEqual(b.business.createdAt.getTime());
        expect(a.status).not.toBe('PENDING_PAYMENT' as never);
        const ended = a.endAt.getTime() <= nowMs;
        switch (a.status) {
          case 'BOOKED':
          case 'CONFIRMED':
            expect(a.cancelledAt).toBeNull();
            expect(a.outcomeMarkedAt).toBeNull();
            expect(a.status === 'CONFIRMED').toBe(a.confirmedAt !== null);
            break;
          case 'ATTENDED':
            expect(ended).toBe(true);
            expect(a.outcomeMarkedById).not.toBeNull();
            expect(a.outcomeMarkedAt!.getTime()).toBeGreaterThanOrEqual(a.endAt.getTime());
            expect(a.outcomeMarkedAt!.getTime()).toBeLessThanOrEqual(nowMs);
            break;
          case 'NO_SHOW':
            // the app's 10 minute grace period
            expect(a.startAt.getTime() + 10 * 60_000).toBeLessThanOrEqual(a.outcomeMarkedAt!.getTime());
            expect(a.outcomeMarkedAt!.getTime()).toBeLessThanOrEqual(nowMs);
            expect(a.cancelledAt).toBeNull();
            break;
          case 'LATE_CANCEL':
            expect(a.cancelledVia).toBe('LINK');
            expect(a.startAt.getTime() - a.cancelledAt!.getTime()).toBeLessThanOrEqual(24 * HOUR);
            expect(a.cancelledAt!.getTime()).toBeGreaterThan(a.createdAt.getTime());
            break;
          case 'CANCELLED':
            expect(a.cancelledVia).not.toBeNull();
            expect(a.cancelledAt).not.toBeNull();
            expect(a.cancelledAt!.getTime()).toBeLessThanOrEqual(nowMs);
            expect(a.cancelledAt!.getTime()).toBeGreaterThan(a.createdAt.getTime());
            break;
        }
        if (a.startAt.getTime() > nowMs) expect(['BOOKED', 'CONFIRMED']).toContain(a.status);
        if (a.confirmedAt) {
          expect(a.confirmedAt.getTime()).toBeGreaterThan(a.createdAt.getTime());
          expect(a.confirmedAt.getTime()).toBeLessThanOrEqual(Math.max(nowMs, a.startAt.getTime()));
        }
      }
  });

  it('client counters equal what the outcome service would have left', () => {
    for (const b of plan.businesses) {
      const expected = recomputeClientCounters(b.appointments);
      for (const c of b.clients) {
        const e = expected.get(c.id) ?? { attended: 0, noShows: 0, lateCancels: 0 };
        expect({ attended: c.attended, noShows: c.noShows, lateCancels: c.lateCancels }).toEqual(e);
      }
    }
    expect(
      recomputeClientCounters([
        { clientId: 'a', status: 'ATTENDED' },
        { clientId: 'a', status: 'NO_SHOW' },
        { clientId: 'a', status: 'CANCELLED' },
        { clientId: 'a', status: 'LATE_CANCEL' },
        { clientId: 'b', status: 'BOOKED' },
      ]).get('a'),
    ).toEqual({ attended: 1, noShows: 1, lateCancels: 1 });
  });
});

describe('flagship targets', () => {
  const rows = () => flagship.appointments.filter((a) => a.startAt.getTime() < nowMs);

  it('has about 140 clients, 4 staff, a 2-miss deposit rule and a backdated creation', () => {
    expect(flagship.clients).toHaveLength(140);
    expect(flagship.staff.map((s) => s.displayName)).toEqual(['Rami', 'Lina', 'Karim', 'Maya']);
    expect(flagship.business).toMatchObject({ plan: 'PRO', depositEnabled: true, depositThreshold: 2, depositAmount: 10 });
    const weeks = (nowMs - flagship.business.createdAt.getTime()) / (7 * 24 * HOUR);
    expect(weeks).toBeGreaterThan(5.9);
    expect(weeks).toBeLessThan(6.2);
  });

  it('has about 400 to 520 appointments (six weeks back plus the next week)', () => {
    expect(flagship.appointments.length).toBeGreaterThanOrEqual(380);
    expect(flagship.appointments.length).toBeLessThanOrEqual(520);
    expect(flagship.appointments.some((a) => a.startAt.getTime() > nowMs)).toBe(true);
  });

  it('has a baseline near 18 percent', () => {
    const b = flagship.baseline!;
    expect(b.appointments).toBe(FLAGSHIP_BASELINE.appointments);
    const rate = (b.noShows / b.appointments) * 100;
    expect(rate).toBeGreaterThanOrEqual(17);
    expect(rate).toBeLessThanOrEqual(19);
    expect(b.toDate.getTime()).toBeLessThan(flagship.business.createdAt.getTime());
  });

  it('trends down: overall 8.5 to 10.5 percent, the last full weeks 7.5 to 10.5', () => {
    const r = rows();
    const att = r.filter((a) => a.status === 'ATTENDED').length;
    const ns = r.filter((a) => a.status === 'NO_SHOW').length;
    const overall = (ns / (att + ns)) * 100;
    expect(overall).toBeGreaterThanOrEqual(8.5);
    expect(overall).toBeLessThanOrEqual(10.5);
    const monday = DateTime.fromMillis(nowMs, { zone: ZONE }).startOf('week');
    const weekRate = (back: number) => {
      const from = monday.minus({ weeks: back }).toMillis();
      const to = monday.minus({ weeks: back - 1 }).toMillis();
      const inWeek = r.filter((a) => a.startAt.getTime() >= from && a.startAt.getTime() < to);
      const a = inWeek.filter((x) => x.status === 'ATTENDED').length;
      const n = inWeek.filter((x) => x.status === 'NO_SHOW').length;
      return (n / (a + n)) * 100;
    };
    expect(weekRate(5)).toBeGreaterThan(weekRate(1));
    for (const back of [1, 2]) {
      expect(weekRate(back)).toBeGreaterThanOrEqual(7.5);
      expect(weekRate(back)).toBeLessThanOrEqual(10.5);
    }
  });

  it('has a believable confirm rate, link cancellations and waitlist refills', () => {
    const r = rows();
    const reminded = new Set(
      flagship.reminderJobs.filter((j) => j.status === 'SENT' && (j.kind === 'H24' || j.kind === 'H2')).map((j) => j.appointmentId),
    );
    const pop = r.filter((a) => !['CANCELLED', 'LATE_CANCEL'].includes(a.status) && reminded.has(a.id));
    const confirm = (pop.filter((a) => a.confirmedAt).length / pop.length) * 100;
    expect(confirm).toBeGreaterThanOrEqual(58);
    expect(confirm).toBeLessThanOrEqual(72);
    const viaLink = r.filter((a) => a.cancelledVia === 'LINK').length;
    const share = (viaLink / r.length) * 100;
    expect(share).toBeGreaterThanOrEqual(7);
    expect(share).toBeLessThanOrEqual(13);
    const offered = new Set(flagship.waitlistOffers.map((o) => o.freedFromAppointmentId)).size;
    const claimed = flagship.waitlistOffers.filter((o) => o.status === 'CLAIMED').length;
    expect(offered).toBeGreaterThanOrEqual(12);
    expect(claimed / offered).toBeGreaterThanOrEqual(0.25);
    expect(claimed / offered).toBeLessThanOrEqual(0.42);
    // each claimed offer points at a WAITLIST booking for the same slot
    const byId = new Map(flagship.appointments.map((a) => [a.id, a]));
    for (const o of flagship.waitlistOffers.filter((x) => x.status === 'CLAIMED')) {
      const taken = byId.get(o.claimedAppointmentId!)!;
      const freed = byId.get(o.freedFromAppointmentId)!;
      expect(taken.source).toBe('WAITLIST');
      expect(taken.staffId).toBe(freed.staffId);
      expect(taken.startAt.getTime()).toBe(freed.startAt.getTime());
      expect(taken.createdAt.getTime()).toBeGreaterThan(o.createdAt.getTime());
      expect(freed.status).toBe('CANCELLED');
    }
  });

  it('has repeat no-show clients, excused no-shows, an outcome queue and open waitlist entries', () => {
    const repeat = flagship.clients.filter((c) => c.noShows >= 2).length;
    expect(repeat).toBeGreaterThanOrEqual(7);
    expect(repeat).toBeLessThanOrEqual(10);
    const excused = flagship.appointments.filter((a) => a.status === 'CANCELLED' && a.outcomeMarkedById !== null);
    expect(excused.length).toBeGreaterThanOrEqual(1);
    expect(excused.length).toBeLessThanOrEqual(2);
    const queue = flagship.appointments.filter((a) => a.endAt.getTime() <= nowMs && ['BOOKED', 'CONFIRMED'].includes(a.status));
    expect(queue.length).toBeGreaterThanOrEqual(4);
    expect(queue.length).toBeLessThanOrEqual(8);
    const open = flagship.waitlistEntries.filter((e) => e.status === 'OPEN');
    expect(open).toHaveLength(6);
    for (const e of open) expect(e.fromDate.getTime()).toBeGreaterThan(nowMs - 24 * HOUR);
    expect(flagship.timeOff.length).toBeGreaterThanOrEqual(3);
  });
});

describe('reminder jobs (safety)', () => {
  it('never leaves an EMAIL job PENDING or SENDING, and has no duplicate keys', () => {
    for (const b of plan.businesses) {
      const keys = new Set<string>();
      for (const j of b.reminderJobs) {
        const k = `${j.appointmentId}/${j.kind}/${j.channel}`;
        expect(keys.has(k)).toBe(false);
        keys.add(k);
        if (j.channel === 'EMAIL') {
          expect(j.status).toBe('SKIPPED');
          expect(j.lastError).toBe('no_email');
          expect(j.dueAt.getTime()).toBeLessThanOrEqual(nowMs);
        }
      }
    }
  });

  it('gives upcoming appointments WhatsApp jobs: due now, some sent by staff', () => {
    const jobs = flagship.reminderJobs.filter((j) => j.channel === 'WHATSAPP');
    const dueNow = jobs.filter((j) => j.status === 'PENDING' && j.dueAt.getTime() <= nowMs);
    expect(dueNow.length).toBeGreaterThan(0);
    const sent = jobs.filter((j) => j.status === 'SENT');
    for (const j of sent) {
      expect(j.sentById).toBe(flagship.reception!.id);
      expect(j.sentAt!.getTime()).toBeGreaterThanOrEqual(j.dueAt.getTime());
      expect(j.sentAt!.getTime()).toBeLessThanOrEqual(nowMs);
    }
    const recentlySent = sent.filter((j) => j.sentAt!.getTime() > nowMs - 12 * HOUR);
    expect(recentlySent.length).toBeGreaterThan(0);
    for (const j of jobs.filter((x) => x.status === 'PENDING')) expect(j.sentAt).toBeNull();
  });

  it('summarises the plan for the dry run', () => {
    const s = summarizePlan(plan);
    expect(s.total.businesses).toBe(18);
    expect(s.total.logos).toBe(10);
    expect(s.total.users).toBe(19);
    expect(Object.keys(s.jobs).some((k) => k.startsWith('H24/WHATSAPP'))).toBe(true);
  });
});

describe('other starting points in time', () => {
  it.each([
    ['Saturday evening', '2026-11-14T17:00:00Z'],
    ['Sunday midday', '2026-11-15T10:00:00Z'],
    ['early Monday', '2026-11-16T05:00:00Z'],
  ])('builds a valid flagship on %s', (_label, iso) => {
    const now = new Date(iso);
    const p = make(now, [FLAGSHIP_SLUG, 'serenity-cedar-spa']);
    expect(p.businesses).toHaveLength(2);
    for (const b of p.businesses) {
      for (const a of b.appointments) expect(a.createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
      for (const j of b.reminderJobs)
        if (j.channel === 'EMAIL') expect(j.status).toBe('SKIPPED');
    }
  });
});

describe('manifest coverage', () => {
  it('builds every manifest business', () => {
    expect(plan.businesses.map((b) => b.spec.slug)).toEqual(MANIFEST.map((b) => b.slug));
  });
});
