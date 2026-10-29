/* eslint-disable @typescript-eslint/no-explicit-any -- test helper: response bodies are untyped JSON */
import { POST as bookPublic } from '@/app/api/public/[slug]/bookings/route';
import { GET as publicSlots } from '@/app/api/public/[slug]/slots/route';
import { POST as bookFrontDesk } from '@/app/api/appointments/route';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { call, signup, unique } from './api';

/** The frozen "now" for booking tests: Monday 2 Nov 2026, 10:00 in Beirut (UTC+2). */
export const NOW = new Date('2026-11-02T08:00:00Z');
/** Wednesday 4 Nov 2026 (Beirut local). 09:00 local = 07:00Z. */
export const DAY = '2026-11-04';
export const at = (hhmmZ: string, day = DAY) => `${day}T${hhmmZ}:00.000Z`;

export type Tenant = Awaited<ReturnType<typeof newTenant>>;

/** A business through the real signup route (owner session included). */
export async function newTenant(over: Record<string, unknown> = {}) {
  const s = await signup(over);
  return {
    businessId: s.info.business.id as string,
    slug: s.body.slug as string,
    cookie: s.cookie,
    info: s.info,
  };
}

/** One service plus n staff who perform it, all open 09:00-17:00 local every day. */
export async function newScenario(
  prisma: PrismaClient,
  t: { businessId: string },
  opts: { staff?: number; durationMin?: number; bufferMin?: number; hours?: [string, string] } = {},
) {
  const tag = unique();
  const service = await prisma.service.create({
    data: {
      businessId: t.businessId,
      name: `Cut ${tag}`,
      durationMin: opts.durationMin ?? 30,
      bufferMin: opts.bufferMin ?? 0,
      price: '15.00',
    },
  });
  const staffIds: string[] = [];
  for (let i = 0; i < (opts.staff ?? 1); i++) {
    const s = await prisma.staffMember.create({
      data: { businessId: t.businessId, displayName: `Staff ${tag}-${i}` },
    });
    await prisma.staffService.create({
      data: { businessId: t.businessId, staffId: s.id, serviceId: service.id },
    });
    await prisma.workingHours.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId: t.businessId,
        staffId: s.id,
        weekday,
        startLocal: opts.hours?.[0] ?? '09:00',
        endLocal: opts.hours?.[1] ?? '17:00',
      })),
    });
    staffIds.push(s.id);
  }
  return { serviceId: service.id, staffIds };
}

let phoneSeq = 0;
/** A valid, unique Lebanese mobile number in national format. */
export const newPhone = () => `71 ${String(100000 + phoneSeq++).padStart(6, '0')}`;

export function bookingBody(
  serviceId: string,
  staffId: string,
  startAt: string,
  client: Record<string, unknown> = {},
) {
  return {
    serviceId,
    staffId,
    startAt,
    client: { name: 'Client', phone: newPhone(), ...client },
  };
}

let keySeq = 0;
export const newKey = () => `key-${unique()}-${keySeq++}`;

export const bookPublicly = (
  slug: string,
  body: unknown,
  key: string | null = newKey(),
  extraHeaders: Record<string, string> = {},
) =>
  call(bookPublic, `/api/public/${slug}/bookings`, {
    params: { slug },
    body,
    headers: { ...(key ? { 'idempotency-key': key } : {}), ...extraHeaders },
  });

export const bookAtFrontDesk = (cookie: string, body: unknown, key?: string) =>
  call(bookFrontDesk, '/api/appointments', {
    cookie,
    body,
    headers: key ? { 'idempotency-key': key } : {},
  });

export const getSlots = (slug: string, query: Record<string, string>) =>
  call(publicSlots, `/api/public/${slug}/slots`, { params: { slug }, query });

export const startsOf = (slots: any[]) => slots.map((s) => s.startAt as string);
