import type { Prisma } from '@/generated/prisma/client';

export const clientRepo = {
  /**
   * Find-or-create by (businessId, E.164 phone), safe under concurrency (ON CONFLICT DO NOTHING).
   * An existing client's name/email are updated only when provided and different; nothing is ever wiped.
   * Runs on the caller's transaction so a failed booking leaves no client behind.
   */
  async upsertByPhone(
    businessId: string,
    tx: Prisma.TransactionClient,
    input: { name: string; phone: string; email?: string | undefined },
  ) {
    await tx.client.createMany({
      data: [{ businessId, name: input.name, phone: input.phone, email: input.email ?? null }],
      skipDuplicates: true,
    });
    const client = await tx.client.findFirstOrThrow({
      where: { businessId, phone: input.phone },
    });
    const data: { name?: string; email?: string } = {};
    if (input.name && input.name !== client.name) data.name = input.name;
    if (input.email && input.email !== client.email) data.email = input.email;
    if (Object.keys(data).length === 0) return client;
    return tx.client.update({ where: { id: client.id }, data });
  },
};
