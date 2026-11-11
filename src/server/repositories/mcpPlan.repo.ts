import { db } from './db';

/**
 * Previewed setup plans and the audit log of the owner assistant. Everything is bound to (businessId, grantId): a
 * plan of another grant or business simply does not exist for the caller. Plans hold business setup data only.
 */
export interface PlanRow {
  id: string;
  proposalJson: unknown;
  proposalHash: string;
  resultJson: unknown;
  expiresAt: Date;
  appliedAt: Date | null;
}

export interface ClaimedPlan {
  id: string;
  proposalJson: unknown;
  proposalHash: string;
}

const select = {
  id: true,
  proposalJson: true,
  proposalHash: true,
  resultJson: true,
  expiresAt: true,
  appliedAt: true,
} as const;

export const mcpPlanRepo = {
  create: (
    businessId: string,
    grantId: string,
    data: { id: string; proposalJson: unknown; proposalHash: string; expiresAt: Date },
  ) =>
    db.mcpPlan
      .create({
        data: {
          id: data.id,
          businessId,
          grantId,
          proposalJson: data.proposalJson as never,
          proposalHash: data.proposalHash,
          expiresAt: data.expiresAt,
        },
      })
      .then(() => undefined),

  find: (businessId: string, grantId: string, planId: string): Promise<PlanRow | null> =>
    db.mcpPlan.findFirst({ where: { id: planId, businessId, grantId }, select }),

  /**
   * THE claim: one UPDATE ... WHERE appliedAt IS NULL AND expiresAt > now RETURNING. Exactly one caller gets the
   * row; a concurrent second caller blocks on the row lock, re-evaluates the predicate after the first commits and
   * gets nothing. Call it inside the apply transaction so a failed apply releases the claim.
   */
  async claim(businessId: string, grantId: string, planId: string, now: Date): Promise<ClaimedPlan | null> {
    const rows = await db.$queryRaw<{ id: string; proposalJson: unknown; proposalHash: string }[]>`
      UPDATE "McpPlan" SET "appliedAt" = ${now}
      WHERE "id" = ${planId} AND "businessId" = ${businessId} AND "grantId" = ${grantId}
        AND "appliedAt" IS NULL AND "expiresAt" > ${now}
      RETURNING "id", "proposalJson", "proposalHash"`;
    return rows[0] ?? null;
  },

  saveResult: (businessId: string, planId: string, result: unknown) =>
    db.mcpPlan
      .updateMany({ where: { id: planId, businessId }, data: { resultJson: result as never } })
      .then(() => undefined),

  record: (
    businessId: string,
    grantId: string | null,
    entry: { tool: string; summary: Record<string, number | string | boolean>; outcome: string },
  ) =>
    db.mcpAuditLog
      .create({ data: { businessId, grantId, tool: entry.tool, summary: entry.summary, outcome: entry.outcome } })
      .then(() => undefined),
};
