import type { Prisma } from '@/generated/prisma/client';

export const clientRepo = {
  /**
   * Find-or-create by (businessId, E.164 phone) that NEVER modifies an existing client (not even empty
   * fields). Used by the unauthenticated waitlist join: whatever the caller supplies for an existing
   * phone number must not reach that client's record.
   */
  async findOrCreateUntouched(
    businessId: string,
    tx: Prisma.TransactionClient,
    input: { name: string; phone: string; email?: string | undefined },
  ) {
    await tx.client.createMany({
      data: [{ businessId, name: input.name, phone: input.phone, email: input.email ?? null }],
      skipDuplicates: true,
    });
    return tx.client.findFirstOrThrow({ where: { businessId, phone: input.phone } });
  },

  /**
   * Find-or-create by (businessId, E.164 phone), safe under concurrency (ON CONFLICT DO NOTHING).
   * Runs on the caller's transaction so a failed booking leaves no client behind.
   *
   * Contact data of an EXISTING client:
   * - `overwriteContact = false` (public and waitlist bookings, which are unauthenticated): only FILL a
   *   name/email that is null or empty. A non-empty stored value is never replaced, otherwise anyone who
   *   knows a victim's phone number could redirect that client's reminder emails to themselves.
   * - `overwriteContact = true` (session-authenticated front-desk booking): a provided, different
   *   name/email replaces the stored one. Nothing is ever wiped by an omitted value.
   * Long-term fix: a verified, per-appointment contact email (reminders go to the address the booker
   * proved they own) instead of one mutable email per client.
   */
  async upsertByPhone(
    businessId: string,
    tx: Prisma.TransactionClient,
    input: { name: string; phone: string; email?: string | undefined },
    overwriteContact: boolean,
  ) {
    await tx.client.createMany({
      data: [{ businessId, name: input.name, phone: input.phone, email: input.email ?? null }],
      skipDuplicates: true,
    });
    const client = await tx.client.findFirstOrThrow({
      where: { businessId, phone: input.phone },
    });
    const data: { name?: string; email?: string } = {};
    if (input.name && input.name !== client.name && (overwriteContact || !client.name.trim()))
      data.name = input.name;
    if (input.email && input.email !== client.email && (overwriteContact || !client.email))
      data.email = input.email;
    if (Object.keys(data).length === 0) return client;
    return tx.client.update({ where: { id: client.id }, data });
  },
};
