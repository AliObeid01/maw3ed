import { DateTime } from 'luxon';
import { plannedJobs } from '../../src/server/domain/bookingPlan';
import { generateReference } from '../../src/server/domain/reference';
import {
  FLAGSHIP_DEPOSIT,
  MANIFEST,
  planOf,
  placeholderOwnerEmail,
  placeholderReceptionEmail,
  type BusinessSpec,
  type WeeklyHours,
} from './manifest';
import { generateClientIdentities } from './names';
import { makeIdFactory, makeRng, seedFrom, type Rng } from './rng';
import { placeDay, splitCapacity, weekdayOf, workingIntervals, type PlacedSlot } from './schedule';

/**
 * The whole demo data set as plain rows, built by pure functions: same `seed` + same `now` = identical output.
 * The clock is always injected (`now`), every date is computed with Luxon in the business zone, and there is no
 * Math.random(). Writing the rows is the seeder's job (seed.ts); nothing here touches a database.
 */

export const ZONE = 'Asia/Beirut';
export const DEFAULT_SEED = 20261110;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** No-show percentage per calendar week of the pilot, oldest first (the last entry is the current week). */
export const FLAGSHIP_WEEK_NO_SHOW_PCT = [12.5, 10.5, 9.5, 8.6, 7.8, 7.8] as const;
export const FLAGSHIP_BASELINE = { days: 14, appointments: 112, noShows: 20, lateCancels: 6 } as const;
const OTHER_NO_SHOW_PCT = 12;

export type Status = 'BOOKED' | 'CONFIRMED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED' | 'LATE_CANCEL';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  emailVerifiedAt: Date;
  createdAt: Date;
}
export interface MembershipRow {
  id: string;
  businessId: string;
  userId: string;
  role: 'OWNER' | 'STAFF';
  createdAt: Date;
}
export interface ClientRow {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  email: null;
  attended: number;
  noShows: number;
  lateCancels: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface AppointmentRow {
  id: string;
  businessId: string;
  clientId: string;
  staffId: string;
  serviceId: string;
  startAt: Date;
  endAt: Date;
  blockedUntil: Date;
  status: Status;
  source: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
  reference: string;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelledVia: 'LINK' | 'STAFF' | null;
  outcomeMarkedById: string | null;
  outcomeMarkedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ReminderJobRow {
  id: string;
  businessId: string;
  appointmentId: string;
  kind: 'BOOKING' | 'H24' | 'H2' | 'LATE';
  channel: 'EMAIL' | 'WHATSAPP';
  dueAt: Date;
  status: 'PENDING' | 'SENT' | 'SKIPPED';
  attempts: number;
  sentAt: Date | null;
  sentById: string | null;
  lastError: string | null;
  createdAt: Date;
}
export interface WaitlistEntryRow {
  id: string;
  businessId: string;
  clientId: string;
  serviceId: string;
  staffId: string | null;
  fromDate: Date;
  toDate: Date;
  status: 'OPEN' | 'FULFILLED' | 'CANCELLED';
  createdAt: Date;
}
export interface WaitlistOfferRow {
  id: string;
  businessId: string;
  entryId: string;
  staffId: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
  status: 'CLAIMED' | 'EXPIRED';
  claimedAppointmentId: string | null;
  freedFromAppointmentId: string;
  createdAt: Date;
}

export interface BusinessPlan {
  spec: BusinessSpec;
  business: {
    id: string;
    slug: string;
    name: string;
    category: string;
    area: string;
    address: string;
    timezone: string;
    locale: string;
    currency: string;
    plan: 'FREE' | 'PRO';
    listed: true;
    depositEnabled: boolean;
    depositThreshold: number;
    depositAmount: number;
    createdAt: Date;
  };
  owner: UserRow;
  reception: UserRow | null;
  memberships: MembershipRow[];
  staff: { id: string; businessId: string; displayName: string; colour: string; createdAt: Date }[];
  services: {
    id: string;
    businessId: string;
    name: string;
    durationMin: number;
    bufferMin: number;
    price: number;
    sortOrder: number;
    createdAt: Date;
  }[];
  staffServices: { staffId: string; serviceId: string; businessId: string }[];
  workingHours: { id: string; businessId: string; staffId: string; weekday: number; startLocal: string; endLocal: string }[];
  timeOff: { id: string; businessId: string; staffId: string; startAt: Date; endAt: Date; reason: 'VACATION' | 'SICK' }[];
  clients: ClientRow[];
  appointments: AppointmentRow[];
  reminderJobs: ReminderJobRow[];
  waitlistEntries: WaitlistEntryRow[];
  waitlistOffers: WaitlistOfferRow[];
  baseline: {
    id: string;
    businessId: string;
    fromDate: Date;
    toDate: Date;
    appointments: number;
    noShows: number;
    lateCancels: number;
  } | null;
}

export interface DemoPlan {
  now: Date;
  seed: number;
  businesses: BusinessPlan[];
}

export interface PlanOptions {
  now: Date;
  seed?: number;
  owner: { email: string; name: string; passwordHash: string };
  /** An argon2 hash of a random secret that nobody keeps: the placeholder logins cannot be used. */
  placeholderHash: string;
  /** Restrict to some slugs (tests). */
  only?: string[];
}

/** Builds the whole plan. `usedPhones` is shared so every phone number is unique across businesses. */
export function buildPlan(opts: PlanOptions): DemoPlan {
  const seed = opts.seed ?? DEFAULT_SEED;
  const used = new Set<string>();
  const refs = new Set<string>();
  const specs = MANIFEST.filter((b) => !opts.only || opts.only.includes(b.slug));
  return {
    now: opts.now,
    seed,
    businesses: specs.map((spec) => buildBusiness(spec, { ...opts, seed }, used, refs)),
  };
}

const iso = (ms: number) => new Date(ms);
const clampMs = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Draft {
  slot: PlacedSlot;
  staffIdx: number;
  clientIdx: number;
  source: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
  createdMs: number;
  kind: 'future' | 'attended' | 'noshow' | 'unmarked' | 'cancelEarly' | 'cancelStaff' | 'late';
  cancelledMs: number | null;
  confirmedMs: number | null;
  markedMs: number | null;
  markedBy: 'owner' | 'reception' | null;
  excused: boolean;
  /** For refill drafts: the cancelled draft they replace. */
  refillOf: Draft | null;
  id: string;
  weekKey: number;
  /** Index into the business services. */
  svc: number;
}

export function buildBusiness(
  spec: BusinessSpec,
  opts: PlanOptions & { seed: number },
  usedPhones: Set<string>,
  usedRefs: Set<string>,
): BusinessPlan {
  // Lighter businesses promise 20 to 45 appointments over the last four weeks. Each retry rescales the fill so the
  // count lands near the manifest target (placement overshoots small daily targets); all of it is deterministic.
  let scale = 1;
  for (let attempt = 0; attempt < 14; attempt++) {
    const plan = tryBuild(spec, opts, usedPhones, usedRefs, attempt, scale);
    if (spec.flagship) return plan;
    const nowMs = opts.now.getTime();
    const past = plan.appointments.filter(
      (a) => a.startAt.getTime() < nowMs && a.startAt.getTime() >= nowMs - 28 * DAY,
    ).length;
    const target = spec.pastAppointments;
    if (past >= 20 && past <= 45 && Math.abs(past - target) <= Math.max(4, target * 0.15)) return plan;
    if (process.env.DEMO_DEBUG) console.error(spec.slug, attempt, past, scale);
    scale *= clampMs(target / Math.max(1, past), 0.5, 1.6);
    // Roll back the shared sets so the retry is deterministic.
    for (const c of plan.clients) usedPhones.delete(c.phone);
    for (const a of plan.appointments) usedRefs.delete(a.reference);
  }
  throw new Error(`could not build ${spec.slug} inside the appointment range`);
}

function tryBuild(
  spec: BusinessSpec,
  opts: PlanOptions & { seed: number },
  usedPhones: Set<string>,
  usedRefs: Set<string>,
  attempt: number,
  scale = 1,
): BusinessPlan {
  const flagship = spec.flagship === true;
  const rng = makeRng(seedFrom(opts.seed, `${spec.slug}#${attempt}`));
  const newId = makeIdFactory(rng);
  const now = opts.now;
  const nowMs = now.getTime();
  const nowL = DateTime.fromMillis(nowMs, { zone: ZONE });
  const today = nowL.startOf('day');
  const currentMonday = nowL.startOf('week');

  // ---- period -----------------------------------------------------------------------------------------------
  const from = flagship ? currentMonday.minus({ weeks: 5 }) : today.minus({ days: 28 });
  const to = today.plus({ days: 7 });
  const createdMs = flagship
    ? today.minus({ weeks: 6 }).set({ hour: 10 }).toMillis()
    : from.minus({ days: 10 }).set({ hour: 10 }).toMillis();

  const businessId = newId();
  const business: BusinessPlan['business'] = {
    id: businessId,
    slug: spec.slug,
    name: spec.name,
    category: spec.category,
    area: spec.area,
    address: spec.address,
    timezone: ZONE,
    locale: spec.locale,
    currency: 'USD',
    plan: planOf(spec),
    listed: true,
    depositEnabled: flagship,
    depositThreshold: flagship ? FLAGSHIP_DEPOSIT.threshold : 1,
    depositAmount: flagship ? FLAGSHIP_DEPOSIT.amount : 5,
    createdAt: iso(createdMs),
  };

  // ---- users ------------------------------------------------------------------------------------------------
  const owner: UserRow = flagship
    ? {
        id: newId(),
        email: opts.owner.email.toLowerCase(),
        name: opts.owner.name,
        passwordHash: opts.owner.passwordHash,
        emailVerifiedAt: iso(createdMs + HOUR),
        createdAt: iso(createdMs),
      }
    : {
        id: newId(),
        email: placeholderOwnerEmail(spec.slug),
        name: rng.pick(['Owner', 'Manager']),
        passwordHash: opts.placeholderHash,
        emailVerifiedAt: iso(createdMs + HOUR),
        createdAt: iso(createdMs),
      };
  const reception: UserRow | null = flagship
    ? {
        id: newId(),
        email: placeholderReceptionEmail(spec.slug),
        name: 'Rana',
        passwordHash: opts.placeholderHash,
        emailVerifiedAt: iso(createdMs + HOUR),
        createdAt: iso(createdMs + DAY),
      }
    : null;
  const memberships: MembershipRow[] = [
    { id: newId(), businessId, userId: owner.id, role: 'OWNER', createdAt: iso(createdMs) },
    ...(reception
      ? [{ id: newId(), businessId, userId: reception.id, role: 'STAFF' as const, createdAt: iso(createdMs + DAY) }]
      : []),
  ];
  const sentBy = reception ?? owner;

  // ---- catalogue --------------------------------------------------------------------------------------------
  const services = spec.services.map((s, i) => ({
    id: newId(),
    businessId,
    name: s.name,
    durationMin: s.durationMin,
    bufferMin: s.bufferMin,
    price: s.price,
    sortOrder: i,
    createdAt: iso(createdMs),
  }));
  const staff = spec.staff.map((s) => ({
    id: newId(),
    businessId,
    displayName: s.name,
    colour: s.colour,
    createdAt: iso(createdMs),
  }));
  const staffServices: BusinessPlan['staffServices'] = [];
  const workingHours: BusinessPlan['workingHours'] = [];
  spec.staff.forEach((s, si) => {
    for (const name of s.services)
      staffServices.push({
        staffId: staff[si]!.id,
        serviceId: services.find((x) => x.name === name)!.id,
        businessId,
      });
    const hours: WeeklyHours = s.hours ?? spec.hours;
    for (const wd of [0, 1, 2, 3, 4, 5, 6] as const)
      for (const [startLocal, endLocal] of hours[wd] ?? [])
        workingHours.push({ id: newId(), businessId, staffId: staff[si]!.id, weekday: wd, startLocal, endLocal });
  });

  // ---- time off (flagship only) -----------------------------------------------------------------------------
  const timeOff: BusinessPlan['timeOff'] = [];
  const offDays = new Map<number, Set<string>>();
  const addOff = (si: number, day: DateTime, reason: 'VACATION' | 'SICK') => {
    const key = day.toISODate()!;
    if (!offDays.has(si)) offDays.set(si, new Set());
    offDays.get(si)!.add(key);
    timeOff.push({
      id: newId(),
      businessId,
      staffId: staff[si]!.id,
      startAt: iso(day.startOf('day').toMillis()),
      endAt: iso(day.plus({ days: 1 }).startOf('day').toMillis()),
      reason,
    });
  };
  if (flagship) {
    // Lina (a Tuesday and a Thursday): a short holiday three weeks back; Rami: one sick day two weeks back;
    // Karim: a day off in the coming week.
    addOff(1, currentMonday.minus({ weeks: 3 }).plus({ days: 1 }), 'VACATION');
    addOff(1, currentMonday.minus({ weeks: 3 }).plus({ days: 3 }), 'VACATION');
    addOff(0, currentMonday.minus({ weeks: 2 }).plus({ days: 2 }), 'SICK');
    for (let k = 3; k <= 6; k++) {
      const d = today.plus({ days: k });
      if (weekdayOf(d) >= 1 && weekdayOf(d) <= 5) {
        addOff(2, d, 'VACATION');
        break;
      }
    }
  }

  // ---- slots ------------------------------------------------------------------------------------------------
  const perStaffLoads = spec.staff.map((s) =>
    s.services.map((name, i) => {
      const sv = spec.services.find((x) => x.name === name)!;
      return { durationMin: sv.durationMin, bufferMin: sv.bufferMin, weight: Math.pow(0.78, i), name };
    }),
  );
  // Fill factor for the past: flagship 0.68 to 0.8 of working time; lighter businesses derive it from the target count.
  let pastFactor = 0.83;
  if (!flagship) {
    let capPast = 0;
    let blockSum = 0;
    let blockN = 0;
    for (let d = from; d < today; d = d.plus({ days: 1 }))
      spec.staff.forEach((s) => {
        capPast += splitCapacity(workingIntervals(d, s.hours ?? spec.hours), nowMs).past;
      });
    for (const s of spec.staff)
      for (const name of s.services) {
        const sv = spec.services.find((x) => x.name === name)!;
        blockSum += sv.durationMin + sv.bufferMin;
        blockN++;
      }
    const avgBlock = blockSum / Math.max(1, blockN);
    pastFactor = clampMs((spec.pastAppointments * 1.04 * avgBlock) / Math.max(1, capPast), 0.05, 0.9);
  }
  const futureFactor = (k: number): number => {
    if (flagship) return [0.7, 0.64, 0.56, 0.5, 0.44, 0.38, 0.32, 0.28][clampMs(k, 0, 7)]!;
    return [0.16, 0.14, 0.12, 0.1, 0.09, 0.08, 0.07, 0.06][clampMs(k, 0, 7)]!;
  };

  const slots: { staffIdx: number; slot: PlacedSlot; serviceIdxInBiz: number }[] = [];
  for (let d = from; d <= to; d = d.plus({ days: 1 })) {
    const k = Math.round((d.startOf('day').toMillis() - today.toMillis()) / DAY);
    const dayNoise = flagship ? 0.9 + rng.next() * 0.2 : 0.65 + rng.next() * 0.7;
    const satFactor = weekdayOf(d) === 6 ? 0.9 : 1;
    spec.staff.forEach((s, si) => {
      if (offDays.get(si)?.has(d.toISODate()!)) return;
      const intervals = workingIntervals(d, s.hours ?? spec.hours);
      if (intervals.length === 0) return;
      const cap = splitCapacity(intervals, nowMs);
      const loads = perStaffLoads[si]!;
      const placed = placeDay(
        rng,
        intervals,
        loads,
        {
          pastMinutes: cap.past * pastFactor * scale * dayNoise * satFactor,
          futureMinutes: cap.future * (k <= 0 ? futureFactor(0) : futureFactor(k)) * dayNoise * satFactor,
        },
        nowMs,
      );
      for (const slot of placed) {
        const svcName = loads[slot.serviceIndex]!.name;
        slots.push({ staffIdx: si, slot, serviceIdxInBiz: spec.services.findIndex((x) => x.name === svcName) });
      }
    });
  }
  slots.sort((a, b) => a.slot.startMs - b.slot.startMs || a.staffIdx - b.staffIdx);

  // ---- clients ----------------------------------------------------------------------------------------------
  const identities = generateClientIdentities(rng, spec.clients, usedPhones);
  const clientCreatedMs: number[] = identities.map(() => nowMs);
  const flakyCount = flagship ? 8 : 0;
  const clientOrder = rng.shuffle(identities.map((_, i) => i));
  const flaky = new Set(clientOrder.slice(0, flakyCount));
  const flakyTarget = new Map<number, number>();
  [...flaky].forEach((c, i) => flakyTarget.set(c, i % 2 === 0 ? 2 : 3));
  const flakyDone = new Map<number, number>();
  const usedClients = new Set<number>();
  const clientBusy: [number, number][][] = identities.map(() => []);
  const clientFree = (c: number, s: number, b: number) => clientBusy[c]!.every(([x, y]) => b <= x || s >= y);

  const drafts: Draft[] = [];
  const makeDraft = (si: number, slot: PlacedSlot, client: number, source: Draft['source'], createdMs0: number, svc: number): Draft => ({
    slot,
    staffIdx: si,
    clientIdx: client,
    source,
    createdMs: createdMs0,
    kind: 'future',
    cancelledMs: null,
    confirmedMs: null,
    markedMs: null,
    markedBy: null,
    excused: false,
    refillOf: null,
    id: newId(),
    weekKey: 0,
    svc,
  });
  const pickClient = (s: number, b: number, exclude?: number): number => {
    for (let tries = 0; tries < 60; tries++) {
      const weights = identities.map((_, i) => {
        if (i === exclude || !clientFree(i, s, b)) return 0;
        let w = flaky.has(i) ? 3.2 : 1;
        if (!usedClients.has(i)) w *= 3.5;
        return w;
      });
      if (weights.every((w) => w === 0)) break;
      return rng.weighted(weights);
    }
    return -1;
  };
  const bookedAt = (startMs: number, source: Draft['source']): number => {
    let leadMs: number;
    if (source === 'FRONT_DESK') leadMs = (0.05 + 2 * Math.pow(rng.next(), 1.5)) * DAY;
    else if (rng.chance(0.06)) leadMs = (0.5 + rng.next() * 5) * HOUR;
    else leadMs = (1 + 9 * Math.pow(rng.next(), 1.6)) * DAY;
    let created = startMs - leadMs;
    created = Math.max(created, createdMs + 2 * HOUR);
    created = Math.min(created, nowMs - (5 + rng.int(0, 360)) * MIN, startMs - 30 * MIN);
    return created;
  };

  for (const { staffIdx, slot, serviceIdxInBiz } of slots) {
    const client = pickClient(slot.startMs, slot.blockedMs);
    if (client < 0) continue;
    usedClients.add(client);
    clientBusy[client]!.push([slot.startMs, slot.blockedMs]);
    const source = rng.chance(0.62) ? 'PUBLIC' : 'FRONT_DESK';
    const d = makeDraft(staffIdx, slot, client, source, bookedAt(slot.startMs, source), serviceIdxInBiz);
    d.weekKey = Math.round((DateTime.fromMillis(slot.startMs, { zone: ZONE }).startOf('week').toMillis() - currentMonday.toMillis()) / (7 * DAY));
    drafts.push(d);
  }
  const svcOf = (d: Draft) => d.svc;

  // ---- classify -----------------------------------------------------------------------------------------------
  const isPast = (d: Draft) => d.slot.endMs <= nowMs - 5 * MIN;
  const pastDrafts = drafts.filter(isPast);
  const cancelEarly: Draft[] = [];
  const rest: Draft[] = [];
  const shares = flagship
    ? { link: 0.085, late: 0.04, staff: 0.015 }
    : { link: 0.06, late: 0.03, staff: 0.01 };
  for (const d of pastDrafts) {
    const r = rng.next();
    const lead = d.slot.startMs - d.createdMs;
    if (r < shares.link && lead >= 26 * HOUR) {
      d.kind = 'cancelEarly';
      // cancelled through the link, more than a day before the start
      d.cancelledMs = d.createdMs + (rng.next() * 0.9 + 0.05) * (d.slot.startMs - 24 * HOUR - d.createdMs);
      cancelEarly.push(d);
    } else if (r < shares.link + shares.late && lead >= 3 * HOUR) {
      d.kind = 'late';
      const lo = Math.max(d.createdMs + 10 * MIN, d.slot.startMs - 23 * HOUR);
      d.cancelledMs = lo + rng.next() * (d.slot.startMs - 45 * MIN - lo);
    } else if (r < shares.link + shares.late + shares.staff && lead >= 3 * HOUR) {
      d.kind = 'cancelStaff';
      d.cancelledMs = d.createdMs + (rng.next() * 0.9 + 0.05) * (d.slot.startMs - 30 * MIN - d.createdMs);
    } else rest.push(d);
  }

  // Waitlist refills: a third of the freed slots (cancelled early) are taken again by someone from the waitlist.
  const offeredSet = flagship ? cancelEarly.filter(() => rng.chance(0.9)) : [];
  const refillTarget = Math.round(offeredSet.length * 0.34);
  const refilled = new Set(rng.shuffle(offeredSet).slice(0, refillTarget));
  const refills: Draft[] = [];
  for (const orig of refilled) {
    const client = pickClient(orig.slot.startMs, orig.slot.blockedMs, orig.clientIdx);
    if (client < 0) {
      refilled.delete(orig);
      continue;
    }
    usedClients.add(client);
    clientBusy[client]!.push([orig.slot.startMs, orig.slot.blockedMs]);
    const created = clampMs(orig.cancelledMs! + (10 + rng.int(0, 50)) * MIN, 0, orig.slot.startMs - 2 * HOUR);
    const r = makeDraft(orig.staffIdx, orig.slot, client, 'WAITLIST', created, orig.svc);
    r.weekKey = orig.weekKey;
    r.refillOf = orig;
    refills.push(r);
  }
  drafts.push(...refills);
  const decidedPool = [...rest, ...refills];

  // Unmarked queue: about six ended appointments of yesterday and today still wait for an outcome.
  const unmarkedWindow = today.minus({ days: 1 }).toMillis();
  const queueCandidates = decidedPool.filter((d) => d.slot.endMs >= unmarkedWindow);
  const unmarked = new Set(rng.shuffle(queueCandidates).slice(0, flagship ? 6 : 3));
  for (const d of unmarked) d.kind = 'unmarked';
  const toMark = decidedPool.filter((d) => !unmarked.has(d));

  // ---- outcomes by week quota ---------------------------------------------------------------------------------
  const weeks = new Map<number, Draft[]>();
  for (const d of toMark) {
    const key = flagship ? clampMs(d.weekKey, -5, 0) : 0;
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key)!.push(d);
  }
  const noShowOk = (d: Draft) => d.slot.startMs + 10 * MIN <= nowMs; // the app's grace period
  let excusedLeft = flagship ? 2 : 0;
  const plainNoShows = new Map<number, number>();
  for (const [key, list] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
    const pct = flagship ? FLAGSHIP_WEEK_NO_SHOW_PCT[key + 5]! : OTHER_NO_SHOW_PCT;
    let k = Math.round((pct / 100) * list.length);
    const willExcuse = excusedLeft > 0 && key <= -1 && k >= 3 && (key === -4 || key === -2);
    if (willExcuse) k += 1;
    const shuffled = rng.shuffle(list).filter(noShowOk);
    const picks: Draft[] = [];
    const flakyHere = shuffled.filter(
      (d) => flaky.has(d.clientIdx) && (flakyDone.get(d.clientIdx) ?? 0) < (flakyTarget.get(d.clientIdx) ?? 0),
    );
    const pickedClients = new Set<number>();
    for (const d of flakyHere) {
      if (picks.length >= Math.ceil(k * 0.6)) break;
      if (pickedClients.has(d.clientIdx)) continue;
      picks.push(d);
      pickedClients.add(d.clientIdx);
      flakyDone.set(d.clientIdx, (flakyDone.get(d.clientIdx) ?? 0) + 1);
    }
    for (const d of shuffled) {
      if (picks.length >= k) break;
      if (picks.includes(d) || flaky.has(d.clientIdx) || pickedClients.has(d.clientIdx)) continue;
      if ((plainNoShows.get(d.clientIdx) ?? 0) > 0) continue;
      picks.push(d);
      pickedClients.add(d.clientIdx);
      plainNoShows.set(d.clientIdx, 1);
    }
    const pickSet = new Set(picks);
    list.forEach((d) => {
      d.kind = pickSet.has(d) ? 'noshow' : 'attended';
    });
    if (willExcuse) {
      const candidate = picks.find((d) => !flaky.has(d.clientIdx));
      if (candidate) {
        candidate.excused = true;
        excusedLeft--;
      }
    }
  }

  // ---- timestamps: confirmation, marking ----------------------------------------------------------------------
  for (const d of drafts) {
    const startMs = d.slot.startMs;
    const endMs = d.slot.endMs;
    if (d.kind === 'attended' || d.kind === 'noshow' || d.kind === 'unmarked') {
      const p = d.kind === 'attended' ? 0.68 : d.kind === 'noshow' ? 0.12 : 0.66;
      if (rng.chance(p)) {
        const lo = d.createdMs + 30 * MIN;
        const hi = startMs - 3 * HOUR;
        d.confirmedMs = hi > lo ? lo + (0.4 + rng.next() * 0.6) * (hi - lo) : null;
        if (d.confirmedMs !== null && d.confirmedMs > startMs - 30 * MIN) d.confirmedMs = null;
      }
    }
    if (d.kind === 'attended') {
      d.markedMs = Math.min(nowMs - MIN, endMs + (5 + rng.int(0, 115)) * MIN);
      d.markedBy = rng.chance(0.8) ? 'reception' : 'owner';
    } else if (d.kind === 'noshow') {
      d.markedMs = Math.min(nowMs - MIN, startMs + (12 + rng.int(0, 150)) * MIN);
      d.markedBy = rng.chance(0.8) ? 'reception' : 'owner';
      if (d.excused) d.cancelledMs = Math.min(nowMs - MIN, d.markedMs + (20 + rng.int(0, 600)) * MIN);
    } else if (d.kind === 'future') {
      const k = Math.round((DateTime.fromMillis(startMs, { zone: ZONE }).startOf('day').toMillis() - today.toMillis()) / DAY);
      const p = k <= 1 ? 0.55 : k <= 3 ? 0.3 : 0.12;
      if (rng.chance(p)) {
        const lo = Math.max(d.createdMs + 20 * MIN, nowMs - 30 * HOUR);
        d.confirmedMs = lo + rng.next() * Math.max(MIN, nowMs - lo - 5 * MIN);
      }
    }
  }

  // ---- appointment rows -----------------------------------------------------------------------------------------
  const newRef = () => {
    for (;;) {
      const r = generateReference((max) => rng.int(0, max - 1));
      if (!usedRefs.has(r)) {
        usedRefs.add(r);
        return r;
      }
    }
  };
  const staffUser = (d: Draft) => (d.markedBy === 'owner' ? owner : sentBy);
  const appointments: AppointmentRow[] = [];
  const draftById = new Map<string, AppointmentRow>();
  for (const d of drafts) {
    const svc = services[svcOf(d)]!;
    let status: Status;
    let cancelledVia: 'LINK' | 'STAFF' | null = null;
    let cancelledAt: number | null = null;
    let markedById: string | null = null;
    let markedAt: number | null = null;
    switch (d.kind) {
      case 'attended':
        status = 'ATTENDED';
        break;
      case 'noshow':
        status = d.excused ? 'CANCELLED' : 'NO_SHOW';
        break;
      case 'cancelEarly':
        status = 'CANCELLED';
        break;
      case 'cancelStaff':
        status = 'CANCELLED';
        break;
      case 'late':
        status = 'LATE_CANCEL';
        break;
      case 'unmarked':
        status = d.confirmedMs !== null ? 'CONFIRMED' : 'BOOKED';
        break;
      default:
        status = d.confirmedMs !== null ? 'CONFIRMED' : 'BOOKED';
    }
    if (d.kind === 'cancelEarly' || d.kind === 'late') {
      cancelledVia = 'LINK';
      cancelledAt = d.cancelledMs;
    } else if (d.kind === 'cancelStaff') {
      cancelledVia = 'STAFF';
      cancelledAt = d.cancelledMs;
    } else if (d.kind === 'noshow' && d.excused) {
      cancelledVia = 'STAFF';
      cancelledAt = d.cancelledMs;
    }
    if (d.kind === 'attended' || d.kind === 'noshow') {
      markedById = staffUser(d).id;
      markedAt = d.markedMs;
    }
    const updated = Math.max(d.createdMs, cancelledAt ?? 0, markedAt ?? 0, d.confirmedMs ?? 0);
    const row: AppointmentRow = {
      id: d.id,
      businessId,
      clientId: '',
      staffId: staff[d.staffIdx]!.id,
      serviceId: svc.id,
      startAt: iso(d.slot.startMs),
      endAt: iso(d.slot.endMs),
      blockedUntil: iso(d.slot.blockedMs),
      status,
      source: d.source,
      reference: newRef(),
      confirmedAt: d.confirmedMs !== null ? iso(d.confirmedMs) : null,
      cancelledAt: cancelledAt !== null ? iso(cancelledAt) : null,
      cancelledVia,
      outcomeMarkedById: markedById,
      outcomeMarkedAt: markedAt !== null ? iso(markedAt) : null,
      createdAt: iso(d.createdMs),
      updatedAt: iso(updated),
    };
    appointments.push(row);
    draftById.set(d.id, row);
  }

  // ---- clients (counters come from the history, the way the outcome service would have left them) -----------
  const clients: ClientRow[] = identities.map((idn, i) => ({
    id: newId(),
    businessId,
    name: idn.name,
    phone: idn.phone,
    email: null,
    attended: 0,
    noShows: 0,
    lateCancels: 0,
    createdAt: iso(clientCreatedMs[i]!),
    updatedAt: iso(clientCreatedMs[i]!),
  }));
  drafts.forEach((d) => {
    const row = draftById.get(d.id)!;
    row.clientId = clients[d.clientIdx]!.id;
  });
  const counters = recomputeClientCounters(appointments);
  for (const c of clients) {
    const k = counters.get(c.id);
    if (k) Object.assign(c, k);
    const mine = appointments.filter((a) => a.clientId === c.id);
    const first = mine.length ? Math.min(...mine.map((a) => a.createdAt.getTime())) : nowMs - 20 * DAY;
    const last = mine.length ? Math.max(...mine.map((a) => a.updatedAt.getTime())) : first;
    c.createdAt = iso(Math.max(createdMs + HOUR, first - rng.int(0, 90) * MIN));
    c.updatedAt = iso(Math.max(last, c.createdAt.getTime()));
  }

  // ---- reminder jobs ----------------------------------------------------------------------------------------------
  const reminderJobs: ReminderJobRow[] = [];
  for (const a of appointments) {
    const start = a.startAt.getTime();
    const upcoming = start > nowMs;
    const created = a.createdAt.getTime();
    const cancelled = a.cancelledAt?.getTime() ?? null;
    const planned = plannedJobs(a.startAt, a.createdAt, { source: a.source });
    for (const j of planned) {
      const due = j.dueAt.getTime();
      const base = { id: newId(), businessId, appointmentId: a.id, kind: j.kind, channel: j.channel, dueAt: j.dueAt, createdAt: a.createdAt } as const;
      if (j.channel === 'EMAIL') {
        // Clients have no e-mail: the real runner skips every EMAIL job as `no_email` the moment it falls due.
        // Only history of that kind is recorded, and only for upcoming bookings; nothing is ever PENDING.
        if (upcoming && due <= nowMs && (cancelled === null || cancelled > due))
          reminderJobs.push({ ...base, status: 'SKIPPED', attempts: 1, sentAt: null, sentById: null, lastError: 'no_email' });
        continue;
      }
      // WhatsApp (the receptionist's list). Skipped when the booking was cancelled before the job fell due.
      if (cancelled !== null && cancelled <= due) {
        reminderJobs.push({ ...base, status: 'SKIPPED', attempts: 0, sentAt: null, sentById: null, lastError: null });
        continue;
      }
      if (!upcoming) {
        // Past: only appointments that were not cancelled need reminder history (the confirm rate counts SENT).
        if (a.status === 'CANCELLED' || a.status === 'LATE_CANCEL') continue;
        const sendP = j.kind === 'H24' ? 0.93 : j.kind === 'H2' ? 0.3 : 0.9;
        if (rng.chance(sendP)) {
          const window = (j.kind === 'H24' ? start - 2 * HOUR : start - 15 * MIN) - due;
          const sentAt = due + Math.max(MIN, rng.next() * Math.min(window, 3 * HOUR));
          reminderJobs.push({ ...base, status: 'SENT', attempts: 0, sentAt: iso(Math.max(sentAt, created)), sentById: sentBy.id, lastError: null });
        } else if (j.kind === 'H24')
          reminderJobs.push({ ...base, status: 'SKIPPED', attempts: 0, sentAt: null, sentById: null, lastError: 'window' });
        continue;
      }
      // Upcoming. Not yet due: waiting. Due: still in its send window -> on the list, or already sent by staff.
      const windowEnd = j.kind === 'H24' ? start - 2 * HOUR : j.kind === 'H2' ? start - 15 * MIN : start;
      if (due > nowMs) reminderJobs.push({ ...base, status: 'PENDING', attempts: 0, sentAt: null, sentById: null, lastError: null });
      else if (nowMs >= windowEnd)
        reminderJobs.push({ ...base, status: 'SKIPPED', attempts: 0, sentAt: null, sentById: null, lastError: 'window' });
      else if (rng.chance(0.3)) {
        const lo = Math.max(due, nowMs - 5 * HOUR);
        const sentAt = lo + rng.next() * (nowMs - 8 * MIN - lo);
        reminderJobs.push({ ...base, status: 'SENT', attempts: 0, sentAt: iso(Math.max(due, sentAt)), sentById: sentBy.id, lastError: null });
      } else reminderJobs.push({ ...base, status: 'PENDING', attempts: 0, sentAt: null, sentById: null, lastError: null });
    }
  }

  // ---- waitlist ------------------------------------------------------------------------------------------------------
  const waitlistEntries: WaitlistEntryRow[] = [];
  const waitlistOffers: WaitlistOfferRow[] = [];
  const byId = (id: string) => appointments.find((a) => a.id === id)!;
  for (const orig of offeredSet) {
    const slotStart = orig.slot.startMs;
    const refill = refills.find((r) => r.refillOf === orig);
    const entryClient = refill ? refill.clientIdx : pickAnyClient(rng, identities.length, orig.clientIdx);
    const createdAt = orig.cancelledMs! + MIN;
    const entry: WaitlistEntryRow = {
      id: newId(),
      businessId,
      clientId: clients[entryClient]!.id,
      serviceId: services[svcOf(orig)]!.id,
      staffId: rng.chance(0.4) ? staff[orig.staffIdx]!.id : null,
      fromDate: iso(DateTime.fromMillis(slotStart, { zone: ZONE }).startOf('day').toMillis()),
      toDate: iso(DateTime.fromMillis(slotStart, { zone: ZONE }).plus({ days: 3 }).startOf('day').toMillis()),
      status: refill ? 'FULFILLED' : 'CANCELLED',
      createdAt: iso(Math.max(createdMs + HOUR, createdAt - rng.int(1, 4) * DAY)),
    };
    waitlistEntries.push(entry);
    waitlistOffers.push({
      id: newId(),
      businessId,
      entryId: entry.id,
      staffId: staff[orig.staffIdx]!.id,
      startAt: iso(slotStart),
      endAt: iso(orig.slot.endMs),
      expiresAt: iso(createdAt + 3 * HOUR),
      status: refill ? 'CLAIMED' : 'EXPIRED',
      claimedAppointmentId: refill ? refill.id : null,
      freedFromAppointmentId: orig.id,
      createdAt: iso(createdAt),
    });
    void byId;
  }
  if (flagship) {
    // About six people are waiting right now, with date ranges in the future.
    const eligible = clients.map((_, i) => i).filter((i) => !flaky.has(i));
    const picks = rng.shuffle(eligible).slice(0, 6);
    picks.forEach((ci, n) => {
      const svc = services[[0, 3, 1, 4, 3, 0][n]!]!;
      const startDay = today.plus({ days: 1 + (n % 3) });
      waitlistEntries.push({
        id: newId(),
        businessId,
        clientId: clients[ci]!.id,
        serviceId: svc.id,
        staffId: n % 3 === 0 ? staff[0]!.id : null,
        fromDate: iso(startDay.toMillis()),
        toDate: iso(startDay.plus({ days: 5 + n }).toMillis()),
        status: 'OPEN',
        createdAt: iso(nowMs - (n + 1) * 14 * HOUR - rng.int(0, 120) * MIN),
      });
    });
  }

  // ---- baseline -------------------------------------------------------------------------------------------------------
  const baseline = flagship
    ? (() => {
        const startLocal = DateTime.fromMillis(createdMs, { zone: ZONE }).startOf('day');
        const asUtc = (d: DateTime) => new Date(`${d.toISODate()}T00:00:00.000Z`);
        return {
          id: newId(),
          businessId,
          fromDate: asUtc(startLocal.minus({ days: FLAGSHIP_BASELINE.days })),
          toDate: asUtc(startLocal.minus({ days: 1 })),
          appointments: FLAGSHIP_BASELINE.appointments,
          noShows: FLAGSHIP_BASELINE.noShows,
          lateCancels: FLAGSHIP_BASELINE.lateCancels,
        };
      })()
    : null;

  return {
    spec,
    business,
    owner,
    reception,
    memberships,
    staff,
    services,
    staffServices,
    workingHours,
    timeOff,
    clients,
    appointments,
    reminderJobs,
    waitlistEntries,
    waitlistOffers,
    baseline,
  };
}

function pickAnyClient(rng: Rng, n: number, not: number): number {
  for (;;) {
    const i = rng.int(0, n - 1);
    if (i !== not) return i;
  }
}

/** The counters the outcome service would have produced from these rows: ATTENDED, NO_SHOW and LATE_CANCEL. */
export function recomputeClientCounters(
  appointments: { clientId: string; status: string }[],
): Map<string, { attended: number; noShows: number; lateCancels: number }> {
  const out = new Map<string, { attended: number; noShows: number; lateCancels: number }>();
  for (const a of appointments) {
    const c = out.get(a.clientId) ?? { attended: 0, noShows: 0, lateCancels: 0 };
    if (a.status === 'ATTENDED') c.attended++;
    else if (a.status === 'NO_SHOW') c.noShows++;
    else if (a.status === 'LATE_CANCEL') c.lateCancels++;
    out.set(a.clientId, c);
  }
  return out;
}

/** Counts used by the dry-run and the final summary. */
export function summarizePlan(plan: DemoPlan) {
  const total = {
    businesses: plan.businesses.length,
    users: 0,
    staff: 0,
    services: 0,
    clients: 0,
    appointments: 0,
    reminderJobs: 0,
    waitlistEntries: 0,
    waitlistOffers: 0,
    logos: plan.businesses.filter((b) => b.spec.logo).length,
    baselines: plan.businesses.filter((b) => b.baseline).length,
    timeOff: 0,
    workingHours: 0,
  };
  const byStatus: Record<string, number> = {};
  const jobs: Record<string, number> = {};
  for (const b of plan.businesses) {
    total.users += 1 + (b.reception ? 1 : 0);
    total.staff += b.staff.length;
    total.services += b.services.length;
    total.clients += b.clients.length;
    total.appointments += b.appointments.length;
    total.reminderJobs += b.reminderJobs.length;
    total.waitlistEntries += b.waitlistEntries.length;
    total.waitlistOffers += b.waitlistOffers.length;
    total.timeOff += b.timeOff.length;
    total.workingHours += b.workingHours.length;
    for (const a of b.appointments) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    for (const j of b.reminderJobs) {
      const k = `${j.kind}/${j.channel}/${j.status}`;
      jobs[k] = (jobs[k] ?? 0) + 1;
    }
  }
  return { total, byStatus, jobs };
}
