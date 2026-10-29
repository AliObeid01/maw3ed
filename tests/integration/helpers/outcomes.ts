import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { POST as createInvite } from '@/app/api/invites/route';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { call, PASSWORD, unique } from './api';
import { newPhone } from './booking';

/** A STAFF session in the owner's business, through the real invite flow. */
export async function newStaffCookie(ownerCookie: string): Promise<string> {
  const tag = unique();
  const inv = await call(createInvite, '/api/invites', {
    cookie: ownerCookie,
    body: { email: `staff-${tag}@example.test`, role: 'STAFF' },
  });
  const token = inv.body!.acceptUrl.split('/invite/')[1] as string;
  const acc = await call(acceptInvite, `/api/invites/${token}/accept`, {
    params: { token },
    body: { name: 'Receptionist', password: PASSWORD },
  });
  if (acc.status !== 200 && acc.status !== 201) throw new Error(`accept failed ${acc.status}`);
  return acc.cookie as string;
}

export async function seedClient(
  prisma: PrismaClient,
  businessId: string,
  over: Partial<{
    name: string;
    phone: string;
    email: string | null;
    attended: number;
    noShows: number;
    lateCancels: number;
  }> = {},
) {
  return prisma.client.create({
    data: {
      businessId,
      name: over.name ?? 'Seed Client',
      phone: over.phone ?? `+9617${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      email: over.email === undefined ? 'seed@example.test' : over.email,
      attended: over.attended ?? 0,
      noShows: over.noShows ?? 0,
      lateCancels: over.lateCancels ?? 0,
    },
  });
}

export const e164 = () => `+961${newPhone().replace(/\s/g, '')}`;

/** Insert an appointment directly (the booking engine refuses the past). Callers keep times non-overlapping. */
export async function seedAppointment(
  prisma: PrismaClient,
  o: {
    businessId: string;
    clientId: string;
    staffId: string;
    serviceId: string;
    startAt: string;
    minutes?: number;
    status?:
      | 'BOOKED'
      | 'CONFIRMED'
      | 'ATTENDED'
      | 'NO_SHOW'
      | 'CANCELLED'
      | 'LATE_CANCEL'
      | 'PENDING_PAYMENT';
    source?: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
    cancelledVia?: 'LINK' | 'STAFF' | 'SYSTEM' | null;
    confirmedAt?: Date | null;
    createdAt?: Date;
  },
) {
  const start = new Date(o.startAt);
  const end = new Date(start.getTime() + (o.minutes ?? 30) * 60_000);
  return prisma.appointment.create({
    data: {
      businessId: o.businessId,
      clientId: o.clientId,
      staffId: o.staffId,
      serviceId: o.serviceId,
      startAt: start,
      endAt: end,
      blockedUntil: end,
      status: o.status ?? 'BOOKED',
      source: o.source ?? 'PUBLIC',
      cancelledVia: o.cancelledVia ?? null,
      confirmedAt: o.confirmedAt ?? null,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  });
}
