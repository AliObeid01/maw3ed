import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { rootLogger } from '@/server/http/logger';
import { runCleanup } from '@/server/services/cleanup';
import { signup } from './helpers/api';
import { newClient, setupSchema, TEST_SCHEMA, truncateAll } from './helpers/db';

// The daily hygiene job also purges what the owner connector can no longer use, and keeps everything live.
let pg: Client;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
});
afterAll(async () => {
  await pg.end();
});

const count = async (table: string) => Number((await pg.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);

describe('cleanup of the owner connector tables', () => {
  it('deletes expired codes, tokens, old plans, long-revoked grants and unused clients; keeps live rows', async () => {
    const s = await signup();
    const u = (await pg.query(`SELECT u.id AS uid, m."businessId" AS bid FROM "User" u JOIN "Membership" m ON m."userId" = u.id WHERE u.email = $1`, [s.body.email])).rows[0];
    const grant = async (id: string, revokedAt: string | null) =>
      pg.query(`INSERT INTO "OAuthGrant" (id, "businessId", "userId", "clientId", "clientName", scope, "createdAt", "revokedAt") VALUES ($1, $2, $3, 'maw3ed-claude', 'Claude', 'setup', now(), ${revokedAt ? `now() - interval '${revokedAt}'` : 'NULL'})`, [id, u.bid, u.uid]);
    await grant('g-live', null);
    await grant('g-old-revoked', '40 days');
    await grant('g-new-revoked', '2 days');
    const token = (table: 'OAuthAccessToken' | 'OAuthRefreshToken', id: string, grantId: string, expires: string) =>
      pg.query(`INSERT INTO "${table}" (id, "grantId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, now() + interval '${expires}')`, [id, grantId, `hash-${id}`]);
    await token('OAuthAccessToken', 'at-live', 'g-live', '1 hour');
    await token('OAuthAccessToken', 'at-dead', 'g-live', '-1 hour');
    await token('OAuthRefreshToken', 'rt-live', 'g-live', '20 days');
    await token('OAuthRefreshToken', 'rt-dead', 'g-new-revoked', '-1 day');
    const code = (id: string, expires: string) =>
      pg.query(`INSERT INTO "OAuthAuthorizationCode" (id, "codeHash", "consentNonce", "clientId", "redirectUri", "codeChallenge", scope, "userId", "businessId", "expiresAt") VALUES ($1, $2, $3, 'maw3ed-claude', 'https://claude.ai/api/mcp/auth_callback', $4, 'setup', $5, $6, now() + interval '${expires}')`, [id, `ch-${id}`, `n-${id}`, 'A'.repeat(43), u.uid, u.bid]);
    await code('c-live', '30 seconds');
    await code('c-old', '-3 days');
    const plan = (id: string, expires: string) =>
      pg.query(`INSERT INTO "McpPlan" (id, "businessId", "grantId", "proposalJson", "proposalHash", "expiresAt") VALUES ($1, $2, 'g-live', '{}', 'h', now() + interval '${expires}')`, [id, u.bid]);
    await plan('p-live', '10 minutes');
    await plan('p-old', '-10 days');
    await plan('p-recent-expired', '-1 hour');
    const client = (id: string, age: string) =>
      pg.query(`INSERT INTO "OAuthClient" (id, "clientId", name, "redirectUris", "createdAt") VALUES ($1, $2, 'C', ARRAY['https://claude.ai/api/mcp/auth_callback'], now() - interval '${age}')`, [id, `mwc_${id}`]);
    await client('cl-old-unused', '10 days');
    await client('cl-new-unused', '1 day');

    await runCleanup(rootLogger);

    const ids = async (table: string) => (await pg.query(`SELECT id FROM "${table}" ORDER BY id`)).rows.map((r) => r.id);
    expect(await ids('OAuthAccessToken')).toEqual(['at-live']);
    expect(await ids('OAuthRefreshToken')).toEqual(['rt-live']);
    expect(await ids('OAuthAuthorizationCode')).toEqual(['c-live']);
    expect(await ids('McpPlan')).toEqual(['p-live', 'p-recent-expired']);
    expect(await ids('OAuthGrant')).toEqual(['g-live', 'g-new-revoked']);
    expect(await ids('OAuthClient')).toEqual(['cl-new-unused']);
    expect(await count('Business')).toBe(1);
  });

  it('every foreign key of the connector tables cascades from Business, User or the grant (nothing outlives its owner)', async () => {
    const rows = (
      await pg.query<{ tbl: string; ref: string; del: string }>(
        `SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS ref, c.confdeltype AS del
           FROM pg_constraint c
          WHERE c.contype = 'f' AND c.connamespace = $1::regnamespace
            AND c.conrelid::regclass::text ~ '(OAuth|McpPlan|McpAuditLog)'`,
        [TEST_SCHEMA],
      )
    ).rows;
    expect(rows.length).toBe(10);
    for (const r of rows) {
      const nullable = r.tbl.includes('McpAuditLog') && r.ref.includes('OAuthGrant');
      expect(r.del, `${r.tbl} -> ${r.ref}`).toBe(nullable ? 'n' : 'c');
    }
    expect(rows.some((r) => r.ref.includes('Business'))).toBe(true);
    expect(rows.some((r) => r.ref.includes('User'))).toBe(true);
  });
});
