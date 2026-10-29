import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { GET as getOffer } from '@/app/api/offers/[token]/route';
import { POST as claimOffer } from '@/app/api/offers/[token]/claim/route';
import { POST as joinPost } from '@/app/api/public/[slug]/waitlist/route';
import { POST as expiryJob } from '@/app/api/jobs/waitlist-expiry/route';
import { offerExpiryFor, signToken } from '@/server/domain/tokens';
import { fakeEmailProvider } from '@/server/providers/email';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { call, PASSWORD, unique } from './api';
import { newPhone } from './booking';

export const joinWaitlist = (slug: string, body: unknown) =>
  call(joinPost, `/api/public/${slug}/waitlist`, { params: { slug }, body });

export function joinBody(serviceId: string, over: Record<string, unknown> = {}) {
  return {
    serviceId,
    staffId: null,
    fromDate: '2026-11-03',
    toDate: '2026-11-10',
    client: { name: 'Wendy Waits', phone: newPhone(), email: `w-${unique()}@example.test` },
    ...over,
  };
}

export const staffCancel = (cookie: string, id: string) =>
  call(cancelAppointment, `/api/appointments/${id}/cancel`, {
    method: 'POST',
    cookie,
    params: { id },
  });

export const offerGet = (token: string) =>
  call(getOffer, `/api/offers/${token}`, { params: { token } });
export const offerClaim = (token: string, body: unknown = {}) =>
  call(claimOffer, `/api/offers/${token}/claim`, { params: { token }, body });

export const runExpiry = () =>
  call(expiryJob, '/api/jobs/waitlist-expiry', {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  });

/** A claim token signed exactly like the one in the email. */
export const offerToken = (offerId: string, expiresAt: Date) =>
  signToken({ o: offerId, act: 'claim', exp: offerExpiryFor(expiresAt) }, process.env.LINK_SECRET!);

/** The claim token inside an offer email. */
export function tokenFromEmail(text: string): string {
  const m = /\/o\/([A-Za-z0-9_.-]+)/.exec(text);
  if (!m) throw new Error('no claim link in email');
  return m[1]!;
}

export const sentOffers = () => [...fakeEmailProvider.calls];

/**
 * An OPEN entry for a brand-new client with an explicit createdAt, so first-come-first-served order is
 * deterministic (two API calls can land in the same millisecond).
 */
export async function seedEntry(
  prisma: PrismaClient,
  businessId: string,
  serviceId: string,
  over: {
    name?: string;
    email?: string | null;
    /** Where offers go (defaults to the client email, or a fresh address). */
    contactEmail?: string;
    phone?: string;
    staffId?: string | null;
    fromDate?: string;
    toDate?: string;
    createdAt: Date;
    clientId?: string;
  },
) {
  const client = over.clientId
    ? { id: over.clientId }
    : await prisma.client.create({
        data: {
          businessId,
          name: over.name ?? `Waiter ${unique()}`,
          phone: over.phone ?? `+9617${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
          email: over.email === undefined ? `e-${unique()}@example.test` : over.email,
        },
      });
  const entry = await prisma.waitlistEntry.create({
    data: {
      businessId,
      clientId: client.id,
      contactEmail:
        over.contactEmail ??
        (typeof over.email === 'string' ? over.email : `c-${unique()}@example.test`),
      serviceId,
      staffId: over.staffId ?? null,
      fromDate: new Date(`${over.fromDate ?? '2026-11-03'}T00:00:00Z`),
      toDate: new Date(`${over.toDate ?? '2026-11-10'}T00:00:00Z`),
      createdAt: over.createdAt,
    },
  });
  return { entryId: entry.id, clientId: client.id };
}

/** Accept a STAFF invite for the business owned by `ownerCookie`; returns the staff session cookie. */
export async function staffSession(ownerCookie: string) {
  const invite = await call(createInvite, '/api/invites', {
    cookie: ownerCookie,
    body: { email: `staff-${unique()}@example.test`, role: 'STAFF' },
  });
  const token = invite.body!.acceptUrl.split('/invite/')[1] as string;
  const accepted = await call(acceptInvite, `/api/invites/${token}/accept`, {
    params: { token },
    body: { name: 'Receptionist', password: PASSWORD },
  });
  if (accepted.status !== 200) throw new Error('staff invite failed');
  return accepted.cookie as string;
}
