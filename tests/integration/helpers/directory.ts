import type { Client } from 'pg';

/** Weekly hours shorthand: every weekday 0..6, or only the listed ones. */
export const hoursFor = (start: string, end: string, days: number[] = [0, 1, 2, 3, 4, 5, 6]) =>
  days.map((weekday) => ({ weekday, start, end }));

export interface FixtureStaff {
  name?: string;
  /** Indexes into `services` this person performs; default: all. */
  serviceIdx?: number[];
  hours?: { weekday: number; start: string; end: string }[];
  bookable?: boolean;
  timeOff?: { startAt: string; endAt: string }[];
  /** Appointments (BOOKED) on service 0 for this person, as UTC ISO ranges; `blockedUntil` = end. */
  bookings?: { startAt: string; endAt: string; status?: string }[];
}

export interface FixtureOptions {
  name: string;
  slug?: string;
  listed?: boolean;
  category?: string | null;
  area?: string | null;
  timezone?: string;
  minNoticeMin?: number;
  slotStepMin?: number;
  bookingWindowDays?: number;
  services?: { name: string; durationMin: number; price: number; active?: boolean }[];
  staff?: FixtureStaff[];
}

let seq = 0;

/** A business written with plain SQL (no signup), with services, staff, hours, time off and bookings. */
export async function makeBusiness(pg: Client, o: FixtureOptions) {
  const n = ++seq;
  const id = `biz-${n}`;
  const slug = o.slug ?? `biz-${n}-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  await pg.query(
    `INSERT INTO "Business" (id, slug, name, category, area, timezone, "minNoticeMin", "slotStepMin", "bookingWindowDays", listed, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
    [
      id,
      slug,
      o.name,
      o.category === undefined ? 'barbers' : o.category,
      o.area === undefined ? 'beirut' : o.area,
      o.timezone ?? 'Asia/Beirut',
      o.minNoticeMin ?? 60,
      o.slotStepMin ?? 30,
      o.bookingWindowDays ?? 30,
      o.listed ?? true,
    ],
  );
  const services = o.services ?? [{ name: 'Haircut', durationMin: 30, price: 15 }];
  const serviceIds: string[] = [];
  for (const [i, s] of services.entries()) {
    const sid = `${id}-svc-${i}`;
    serviceIds.push(sid);
    await pg.query(
      `INSERT INTO "Service" (id, "businessId", name, "durationMin", price, active, "updatedAt") VALUES ($1,$2,$3,$4,$5,$6, now())`,
      [sid, id, s.name, s.durationMin, s.price, s.active ?? true],
    );
  }
  const staff = o.staff ?? [{}];
  const staffIds: string[] = [];
  for (const [i, st] of staff.entries()) {
    const stId = `${id}-staff-${i}`;
    staffIds.push(stId);
    await pg.query(
      `INSERT INTO "StaffMember" (id, "businessId", "displayName", bookable, active, "updatedAt") VALUES ($1,$2,$3,$4,true, now())`,
      [stId, id, st.name ?? `Barber ${n}-${i}`, st.bookable ?? true],
    );
    for (const idx of st.serviceIdx ?? services.map((_, k) => k))
      await pg.query(
        `INSERT INTO "StaffService" ("staffId", "serviceId", "businessId") VALUES ($1,$2,$3)`,
        [stId, serviceIds[idx], id],
      );
    for (const [k, h] of (st.hours ?? hoursFor('09:00', '17:00')).entries())
      await pg.query(
        `INSERT INTO "WorkingHours" (id, "businessId", "staffId", weekday, "startLocal", "endLocal") VALUES ($1,$2,$3,$4,$5,$6)`,
        [`${stId}-wh-${k}`, id, stId, h.weekday, h.start, h.end],
      );
    for (const [k, t] of (st.timeOff ?? []).entries())
      await pg.query(
        `INSERT INTO "TimeOff" (id, "businessId", "staffId", "startAt", "endAt") VALUES ($1,$2,$3,$4,$5)`,
        [`${stId}-to-${k}`, id, stId, t.startAt, t.endAt],
      );
    if (st.bookings?.length) {
      await pg.query(
        `INSERT INTO "Client" (id, "businessId", name, phone, email, "updatedAt") VALUES ($1,$2,'Private Person','+96171000000','private.person@example.test', now())
         ON CONFLICT DO NOTHING`,
        [`${id}-client`, id],
      );
      for (const [k, b] of st.bookings.entries())
        await pg.query(
          `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8::"AppointmentStatus", now())`,
          [
            `${stId}-ap-${k}`,
            id,
            `${id}-client`,
            stId,
            serviceIds[0],
            b.startAt,
            b.endAt,
            b.status ?? 'BOOKED',
          ],
        );
    }
  }
  return { id, slug, serviceIds, staffIds };
}
