import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { sessionCookieName } from '@/server/http/cookies';
import { activatedPractitioner } from './helpers/practitioner';
import { newClient, setupSchema, truncateAll } from './helpers/db';
import { signup } from './helpers/api';

/**
 * ROUTE MATRIX. Every route handler under src/app/api is called with a real PRACTITIONER session. Session routes
 * must answer 403 except the self-service allow-list; public, token and cron routes do not look at the session.
 * Nothing about another business or its data can be reached, and the guard runs before params and body are parsed.
 */
const modules = import.meta.glob('../../src/app/api/**/route.ts');
const API = path.resolve(import.meta.dirname, '../../src/app/api');

/** Self-service routes (own account) and, since PR-5, the four scoped schedule routes. Nothing else. */
const ALLOWED = new Set([
  'POST auth/change-password',
  'POST auth/logout',
  'POST auth/resend-verification',
  'POST auth/sign-out-others',
  'GET me',
  'GET appointments/[id]',
  'PATCH appointments/[id]/outcome',
  'GET dashboard/today',
  'GET outcomes/queue',
]);

let pg: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
});

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const OWNER_PROTOCOL = new Set(['mcp/owner', 'oauth/authorize', 'oauth/register', 'oauth/revoke', 'oauth/token']);

describe('PRACTITIONER route matrix', () => {
  it('is 403 on every session route except the self-service and scoped allow-list, which still work', async () => {
    const owner = await signup();
    const barber = await activatedPractitioner(owner);
    const userId = barber.userId as string;
    const businessId = (await pg.query(`SELECT id FROM "Business" LIMIT 1`)).rows[0].id as string;

    const results: { route: string; method: string; status: number; mode: string; gated: boolean }[] = [];
    for (const [file, load] of Object.entries(modules)) {
      const rel = path
        .relative(API, path.dirname(path.resolve(import.meta.dirname, file)))
        .split(path.sep)
        .join('/');
      const src = readFileSync(path.join(API, rel, 'route.ts'), 'utf8');
      const mod = (await load()) as Record<
        string,
        (req: Request, args?: unknown) => Promise<Response>
      >;
      for (const method of METHODS) {
        const handler = mod[method];
        if (!handler) continue;
        const chunk =
          src
            .split(new RegExp(`^export const ${method} = withRoute`, 'm'))[1]
            ?.split(/^export const /m)[0] ?? '';
        // /api/mcp is the one JSON-RPC endpoint outside withRoute: no session at all (kill switch, then protocol).
        // The owner connector's protocol routes are outside withRoute on purpose (OAuth errors, Bearer tokens, PKCE, a signed
        // consent form): each guards itself and is proven in mcp.owner.oauth.test.ts. An unlisted new route still ends up '?'.
        const mode = rel === 'mcp' || OWNER_PROTOCOL.has(rel) ? 'protocol' : (/auth:\s*'(\w+)'/.exec(chunk)?.[1] ?? '?');
        if (mode !== 'session') {
          results.push({ route: rel, method, status: 0, mode, gated: false });
          continue;
        }
        // A fresh session per call so logout/sign-out-others cannot affect the next route.
        const token = randomBytes(24).toString('base64url');
        await pg.query(
          `INSERT INTO "Session" (id, "businessId", "userId", "tokenHash", "expiresAt") VALUES ($1,$2,$3,$4, now() + interval '1 day')`,
          [
            `s-${randomBytes(6).toString('hex')}`,
            businessId,
            userId,
            createHash('sha256').update(token).digest('hex'),
          ],
        );
        const params: Record<string, string> = {};
        for (const m of rel.matchAll(/\[(\w+)\]/g)) params[m[1]!] = 'a'.repeat(24);
        const mutating = method !== 'GET';
        const res = await handler(
          new Request(`http://localhost/api/${rel}`, {
            method,
            headers: {
              cookie: `${sessionCookieName()}=${token}`,
              ...(mutating ? { 'content-type': 'application/json' } : {}),
            },
            body: mutating ? '{}' : undefined,
          }),
          { params: Promise.resolve(params) },
        );
        results.push({ route: rel, method, status: res.status, mode, gated: /gate:/.test(chunk) });
      }
    }

    const session = results.filter((r) => r.mode === 'session');
    expect(session.length).toBeGreaterThan(40);
    // A route behind a feature gate (withRoute `gate:`) answers 404 while its switch is off (kill switch, before any
    // role check). Their role guards are proven with the switch ON in mcp.owner.oauth.test.ts; here the 404 is accepted
    // only for exactly these gated routes, so nothing else can hide behind it.
    const GATED = ['GET oauth/grants', 'POST oauth/grants/[id]/revoke'];
    expect(
      session.filter((r) => r.gated).map((r) => `${r.method} ${r.route}`).sort(),
    ).toEqual([...GATED].sort());
    const leaked = session.filter(
      (r) => !ALLOWED.has(`${r.method} ${r.route}`) && r.status !== 403 && !(r.gated && r.status === 404),
    );
    expect(leaked).toEqual([]);
    const allowed = session.filter((r) => ALLOWED.has(`${r.method} ${r.route}`));
    expect(allowed.map((r) => `${r.method} ${r.route}`).sort()).toEqual([...ALLOWED].sort());
    for (const r of allowed) expect(r.status, `${r.method} ${r.route}`).not.toBe(403);
    // Unknown modes would mean the scan missed a handler.
    expect(results.filter((r) => r.mode === '?')).toEqual([]);
    console.log(
      `route matrix: ${session.length} session handlers checked, ${session.length - allowed.length} refused with 403, ${allowed.length} allowed (self-service + scoped)`,
    );
  });
});
