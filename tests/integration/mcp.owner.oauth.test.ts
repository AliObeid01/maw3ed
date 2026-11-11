/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as grantsGet } from '@/app/api/oauth/grants/route';
import { POST as grantRevoke } from '@/app/api/oauth/grants/[id]/revoke/route';
import { POST as authorizePost, GET as authorizeGet } from '@/app/api/oauth/authorize/route';
import { POST as registerPost, GET as registerGet } from '@/app/api/oauth/register/route';
import { POST as revokePost } from '@/app/api/oauth/revoke/route';
import { POST as tokenPost } from '@/app/api/oauth/token/route';
import { POST as mcpPost } from '@/app/api/mcp/owner/route';
import { POST as publicMcpPost } from '@/app/api/mcp/route';
import { GET as asMeta } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as prMeta } from '@/app/.well-known/oauth-protected-resource/route';
import { GET as prMetaOwner } from '@/app/.well-known/oauth-protected-resource/api/mcp/owner/route';
import { sha256Hex } from '@/server/services/crypto';
import { checkAuthorizeRequest, signConsentToken } from '@/server/services/oauth';
import { sessionService } from '@/server/services/session';
import { call, signup, unique } from './helpers/api';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import type { PrismaClient } from '../../src/generated/prisma/client';

const ORIGIN = 'http://localhost:3000';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const RESOURCE = `${ORIGIN}/api/mcp/owner`;

let pg: Client;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.MCP_OWNER_ENABLED = 'true';
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
});
afterEach(() => {
  vi.useRealTimers();
  process.env.MCP_OWNER_ENABLED = 'true';
});
afterAll(async () => {
  delete process.env.MCP_OWNER_ENABLED;
  await prisma.$disconnect();
  await pg.end();
});

/* ---------------------------------- helpers ---------------------------------- */

const b64url = (b: Buffer) => b.toString('base64url');
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

async function form(handler: (r: Request) => Promise<Response>, path: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await handler(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body).toString(),
    }),
  );
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function register(redirectUris = [CALLBACK]) {
  const r = await call(registerPost, '/api/oauth/register', { body: { redirect_uris: redirectUris, client_name: 'Claude' } });
  return { status: r.status, body: r.body as any };
}

interface Owner {
  cookie: string;
  businessId: string;
  userId: string;
  email: string;
}
async function newOwner(): Promise<Owner> {
  const s = await signup();
  const u = await pg.query(`SELECT u.id AS "userId", m."businessId" FROM "User" u JOIN "Membership" m ON m."userId" = u.id WHERE u.email = $1`, [s.body.email]);
  return { cookie: s.cookie, businessId: u.rows[0].businessId, userId: u.rows[0].userId, email: s.body.email };
}

/** A logged-in user with another role in the same business (a receptionist or a practitioner). */
async function memberWithRole(businessId: string, role: 'STAFF' | 'PRACTITIONER') {
  const user = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${unique()}@example.test`, name: role } });
  await prisma.membership.create({ data: { businessId, userId: user.id, role } });
  const s = await sessionService.create(businessId, user.id);
  return { userId: user.id, cookie: `maw3ed_session=${s.token}` };
}

interface Auth {
  clientId: string;
  redirectUri: string;
  challenge: string;
  verifier: string;
  state: string;
}
async function authParams(over: Partial<Auth> = {}): Promise<Auth> {
  const { verifier, challenge } = pkce();
  const clientId = over.clientId ?? (await register()).body.client_id;
  return { clientId, redirectUri: CALLBACK, challenge, verifier, state: `st-${unique()}`, ...over };
}

/** What the consent page does for a signed-in user: validate the request and mint the signed form token. */
async function consent(who: { userId: string; businessId: string }, a: Auth) {
  const check = await checkAuthorizeRequest({
    response_type: 'code',
    client_id: a.clientId,
    redirect_uri: a.redirectUri,
    code_challenge: a.challenge,
    code_challenge_method: 'S256',
    state: a.state,
    scope: 'setup',
    resource: RESOURCE,
  });
  if (check.kind !== 'ok') throw new Error(`authorize check failed: ${JSON.stringify(check)}`);
  return signConsentToken(who, check);
}

async function decide(cookie: string | undefined, token: string, decision: 'allow' | 'deny', origin: string | null = ORIGIN, extra: Record<string, string> = {}) {
  return form(
    authorizePost,
    '/api/oauth/authorize',
    { consent: token, decision },
    { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...extra },
  );
}

const codeOf = (location: string | null) => new URL(location!).searchParams.get('code')!;

/** register -> consent -> allow -> code (the way the browser flow ends). */
async function getCode(o: Owner, a?: Auth) {
  const auth = a ?? (await authParams());
  const res = await decide(o.cookie, await consent(o, auth), 'allow');
  expect(res.status, res.text).toBe(302);
  return { auth, code: codeOf(res.headers.get('location')), location: res.headers.get('location')! };
}

const exchange = (a: Auth, code: string, over: Record<string, string> = {}) =>
  form(tokenPost, '/api/oauth/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: a.redirectUri,
    client_id: a.clientId,
    code_verifier: a.verifier,
    ...over,
  });

const refresh = (clientId: string, refresh_token: string) =>
  form(tokenPost, '/api/oauth/token', { grant_type: 'refresh_token', refresh_token, client_id: clientId });

async function connect(o?: Owner) {
  const owner = o ?? (await newOwner());
  const { auth, code } = await getCode(owner);
  const t = await exchange(auth, code);
  expect(t.status, t.text).toBe(200);
  return { owner, auth, code, tokens: t.json as { access_token: string; refresh_token: string; expires_in: number } };
}

const rpc = (token: string | null, method: string, params: unknown = {}, headers: Record<string, string> = {}) =>
  mcpPost(
    new Request(`${ORIGIN}/api/mcp/owner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );

const count = async (sql: string, args: unknown[] = []) => Number((await pg.query(sql, args)).rows[0].count);

/* ---------------------------------- the kill switch ---------------------------------- */

describe('MCP_OWNER_ENABLED off: every new route answers 404 and the public connector is unaffected', () => {
  it('404s every route, page-less document and method', async () => {
    delete process.env.MCP_OWNER_ENABLED;
    const get = (path: string) => new Request(`${ORIGIN}${path}`);
    for (const [name, res] of [
      ['well-known as', await asMeta(get('/.well-known/oauth-authorization-server'))],
      ['well-known pr', await prMeta(get('/.well-known/oauth-protected-resource'))],
      ['well-known pr owner', await prMetaOwner(get('/.well-known/oauth-protected-resource/api/mcp/owner'))],
      ['register', await registerPost(new Request(`${ORIGIN}/api/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))],
      ['register GET', await registerGet(get('/api/oauth/register'))],
      ['token', await tokenPost(new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=x' }))],
      ['revoke', await revokePost(new Request(`${ORIGIN}/api/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=x' }))],
      ['authorize POST', await authorizePost(new Request(`${ORIGIN}/api/oauth/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: 'a=b' }))],
      ['authorize GET', await authorizeGet(get('/api/oauth/authorize'))],
      ['mcp owner', await rpc('mw_at_x', 'initialize')],
      ['grants', await grantsGet(get('/api/oauth/grants'))],
    ] as const) {
      expect(res.status, name).toBe(404);
    }
  });

  it('the public connector still works with MCP_ENABLED=true while the owner connector is off', async () => {
    delete process.env.MCP_OWNER_ENABLED;
    process.env.MCP_ENABLED = 'true';
    try {
      const res = await publicMcpPost(
        new Request(`${ORIGIN}/api/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      );
      expect(res.status).toBe(200);
      const tools = (await res.json()).result.tools.map((t: any) => t.name);
      expect(tools).toContain('search_businesses');
      expect(tools).not.toContain('preview_setup_changes');
    } finally {
      delete process.env.MCP_ENABLED;
    }
  });

  it('only the exact string "true" switches it on', async () => {
    for (const v of ['TRUE', '1', ' true', 'yes', '']) {
      process.env.MCP_OWNER_ENABLED = v;
      expect((await asMeta(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).status, v).toBe(404);
    }
  });
});

/* ---------------------------------- discovery ---------------------------------- */

describe('discovery documents and the 401 challenge', () => {
  it('serves the authorization server metadata from APP_URL, never from the request Host', async () => {
    const res = await asMeta(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`, { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      revocation_endpoint: `${ORIGIN}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['setup'],
    });
  });

  it('well-known documents are cacheable for 60 seconds only', async () => {
    for (const h of [asMeta, prMeta, prMetaOwner])
      expect((await h(new Request(`${ORIGIN}/.well-known/x`))).headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('serves the protected resource metadata (both URLs)', async () => {
    for (const handler of [prMeta, prMetaOwner]) {
      const res = await handler(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
      expect(await res.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ORIGIN],
        bearer_methods_supported: ['header'],
        scopes_supported: ['setup'],
      });
    }
  });

  it('answers 401 with WWW-Authenticate for a missing token and adds error="invalid_token" for a bad one', async () => {
    const meta = `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp/owner"`;
    const none = await rpc(null, 'initialize');
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe(`Bearer ${meta}`);
    for (const bad of ['mw_at_' + 'x'.repeat(43), 'garbage', 'mw_rt_' + 'y'.repeat(43)]) {
      const res = await rpc(bad, 'tools/list');
      expect(res.status, bad).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(`Bearer ${meta}, error="invalid_token"`);
    }
  });

  it('keeps the public connector rules: 405 for GET, 403 for a foreign Origin, 415 for a wrong content type, 413 for a big body', async () => {
    const { tokens } = await connect();
    const get = await mcpPost(new Request(`${ORIGIN}/api/mcp/owner`, { method: 'GET' }) as any).catch(() => undefined);
    expect(get?.status).toBeDefined();
    expect((await rpc(tokens.access_token, 'tools/list', {}, { origin: 'https://evil.example' })).status).toBe(403);
    const wrongType = await mcpPost(
      new Request(`${ORIGIN}/api/mcp/owner`, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: `Bearer ${tokens.access_token}` }, body: '{}' }),
    );
    expect(wrongType.status).toBe(415);
    const big = await mcpPost(
      new Request(`${ORIGIN}/api/mcp/owner`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` }, body: 'x'.repeat(70_000) }),
    );
    expect(big.status).toBe(413);
  });
});

/* ---------------------------------- registration ---------------------------------- */

describe('POST /api/oauth/register (RFC 7591)', () => {
  it('registers a public client for the Claude callbacks and loopback URIs', async () => {
    for (const uris of [[CALLBACK], ['https://claude.com/api/mcp/auth_callback'], ['http://localhost:34567/callback'], ['http://127.0.0.1:8123/cb']]) {
      const r = await register(uris);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.client_id).toMatch(/^mwc_/);
      expect(r.body.redirect_uris).toEqual(uris);
      expect(r.body.token_endpoint_auth_method).toBe('none');
    }
  });

  it('rejects every other redirect URI with 400 invalid_redirect_uri', async () => {
    for (const bad of ['https://evil.example/cb', 'https://claude.ai/api/mcp/auth_callback/x', 'http://localhost/cb', 'myapp://cb', 'http://localhost:1/cb#f', 'https://claude.ai.evil.example/api/mcp/auth_callback']) {
      const r = await register([bad]);
      expect(r.status, bad).toBe(400);
      expect(r.body.error, bad).toBe('invalid_redirect_uri');
    }
    // one bad URI among good ones rejects the whole registration
    const mixed = await register([CALLBACK, 'https://evil.example/cb']);
    expect(mixed.status).toBe(400);
  });

  it('answers 400 for a bad body (missing redirect_uris, not JSON, wrong content type, confidential client)', async () => {
    expect((await call(registerPost, '/api/oauth/register', { body: {} })).status).toBe(400);
    expect((await call(registerPost, '/api/oauth/register', { body: { redirect_uris: [] } })).status).toBe(400);
    expect((await call(registerPost, '/api/oauth/register', { body: { redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' } })).body?.error).toBe('invalid_client_metadata');
    const notJson = await registerPost(new Request(`${ORIGIN}/api/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' }));
    expect(notJson.status).toBe(400);
    const wrongType = await registerPost(new Request(`${ORIGIN}/api/oauth/register`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }));
    expect(wrongType.status).toBe(400);
    expect((await registerGet(new Request(`${ORIGIN}/api/oauth/register`))).status).toBe(405);
  });

  it('cleans the client name (no markup, no bidi)', async () => {
    const r = await call(registerPost, '/api/oauth/register', { body: { redirect_uris: [CALLBACK], client_name: 'Evil <script>‮Claude' } });
    expect(r.body?.client_name).not.toMatch(/[<>‮]/);
  });
});

/* ---------------------------------- the authorization request ---------------------------------- */

describe('authorization request validation (what the consent page enforces)', () => {
  const base = async () => {
    const a = await authParams();
    return { response_type: 'code', client_id: a.clientId, redirect_uri: a.redirectUri, code_challenge: a.challenge, code_challenge_method: 'S256', state: 's1', scope: 'setup' };
  };

  it('accepts a good request, and the static client maw3ed-claude', async () => {
    expect((await checkAuthorizeRequest(await base())).kind).toBe('ok');
    expect((await checkAuthorizeRequest({ ...(await base()), client_id: 'maw3ed-claude' })).kind).toBe('ok');
  });

  it('shows (never redirects) an unknown client or a redirect_uri that is not an exact match', async () => {
    expect(await checkAuthorizeRequest({ ...(await base()), client_id: 'nope' })).toEqual({ kind: 'page_error', reason: 'client' });
    expect(await checkAuthorizeRequest({ ...(await base()), client_id: undefined })).toEqual({ kind: 'page_error', reason: 'client' });
    for (const uri of ['https://evil.example/cb', `${CALLBACK}/`, `${CALLBACK}?x=1`, 'http://localhost:9999/cb', undefined]) {
      expect(await checkAuthorizeRequest({ ...(await base()), redirect_uri: uri }), String(uri)).toEqual({ kind: 'page_error', reason: 'redirect_uri' });
    }
    // a loopback URI that is allowed in general but was not registered for THIS client
    expect((await checkAuthorizeRequest({ ...(await base()), redirect_uri: 'http://127.0.0.1:5555/cb' })).kind).toBe('page_error');
  });

  it('requires response_type=code, a 43 character S256 challenge, a known scope and our own resource', async () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge_method: undefined }, 'invalid_request'],
      [{ scope: 'admin' }, 'invalid_scope'],
      [{ resource: 'https://evil.example/api/mcp/owner' }, 'invalid_target'],
      [{ state: 'x'.repeat(501) }, 'invalid_request'],
    ];
    for (const [over, error] of cases) {
      const r = await checkAuthorizeRequest({ ...(await base()), ...over });
      expect(r, JSON.stringify(over)).toMatchObject({ kind: 'redirect_error', error, redirectUri: CALLBACK });
    }
    expect((await checkAuthorizeRequest({ ...(await base()), resource: RESOURCE })).kind).toBe('ok');
    expect((await checkAuthorizeRequest({ ...(await base()), resource: `${RESOURCE}/` })).kind).toBe('ok');
  });
});

/* ---------------------------------- the consent decision ---------------------------------- */

describe('POST /api/oauth/authorize (the decision)', () => {
  it('Allow: issues a 60 second single-use code bound to client, redirect, challenge, user and business; only its sha256 is stored', async () => {
    const o = await newOwner();
    const a = await authParams();
    const res = await decide(o.cookie, await consent(o, a), 'allow');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(`${loc.origin}${loc.pathname}`).toBe(CALLBACK);
    expect(loc.searchParams.get('state')).toBe(a.state);
    const code = loc.searchParams.get('code')!;
    expect(Buffer.from(code, 'base64url')).toHaveLength(32); // 256 bits
    const rows = (await pg.query(`SELECT * FROM "OAuthAuthorizationCode" WHERE "businessId" = $1`, [o.businessId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ codeHash: sha256Hex(code), clientId: a.clientId, redirectUri: a.redirectUri, codeChallenge: a.challenge, userId: o.userId, businessId: o.businessId, resource: RESOURCE, usedAt: null });
    expect(JSON.stringify(rows[0])).not.toContain(code);
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(50_000);
  });

  it('Cancel: redirects with error=access_denied and the state, and issues nothing', async () => {
    const o = await newOwner();
    const a = await authParams();
    const res = await decide(o.cookie, await consent(o, a), 'deny');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe(a.state);
    expect(loc.searchParams.get('code')).toBeNull();
    expect(await count(`SELECT count(*) FROM "OAuthAuthorizationCode" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });

  it('a receptionist (STAFF) or a PRACTITIONER can NOT authorize: no code is ever issued to them', async () => {
    const o = await newOwner();
    for (const role of ['STAFF', 'PRACTITIONER'] as const) {
      const m = await memberWithRole(o.businessId, role);
      const a = await authParams();
      // even with a validly signed consent token for THEIR user, the decision is refused for non-owners
      const res = await decide(m.cookie, await consent({ userId: m.userId, businessId: o.businessId }, a), 'allow');
      expect(res.status, role).toBe(303);
      expect(res.headers.get('location'), role).toBe('/oauth/authorize?status=not_owner');
    }
    expect(await count(`SELECT count(*) FROM "OAuthAuthorizationCode" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });

  it('CSRF: a missing or foreign Origin is refused, and a consent token cannot be used by another user', async () => {
    const o = await newOwner();
    const m = await memberWithRole(o.businessId, 'STAFF');
    const a = await authParams();
    const token = await consent(o, a);
    const blocked = async (r: ReturnType<typeof decide>) => {
      const res = await r;
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/oauth/authorize?status=blocked');
    };
    await blocked(decide(o.cookie, token, 'allow', null));
    await blocked(decide(o.cookie, token, 'allow', 'https://evil.example'));
    await blocked(decide(o.cookie, token, 'allow', 'null'));
    // a real Origin of another site is refused even when Sec-Fetch-Site claims same-origin
    await blocked(decide(o.cookie, token, 'allow', 'https://evil.example', { 'sec-fetch-site': 'same-origin' }));
    // the owner's signed token submitted with someone else's session
    const stolen = await decide(m.cookie, token, 'allow');
    expect(stolen.headers.get('location')).toBe('/oauth/authorize?status=expired');
    expect(await count(`SELECT count(*) FROM "OAuthAuthorizationCode" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });

  it('browser reality: Origin can be absent or the literal "null" (Referrer-Policy no-referrer); Sec-Fetch-Site same-origin is then accepted', async () => {
    const o = await newOwner();
    const cases: [string | null, Record<string, string>, boolean][] = [
      [ORIGIN, {}, true],
      [ORIGIN, { 'sec-fetch-site': 'cross-site' }, true],
      [null, { 'sec-fetch-site': 'same-origin' }, true],
      ['null', { 'sec-fetch-site': 'same-origin' }, true],
      ['null', { 'sec-fetch-site': 'cross-site' }, false],
      ['null', { 'sec-fetch-site': 'same-site' }, false],
      ['null', { 'sec-fetch-site': 'none' }, false],
      ['null', {}, false],
      [null, { 'sec-fetch-site': 'cross-site' }, false],
      [null, {}, false],
      ['https://evil.example', { 'sec-fetch-site': 'same-origin' }, false],
      ['https://evil.example', { 'sec-fetch-site': 'cross-site' }, false],
    ];
    for (const [origin, extra, accepted] of cases) {
      const res = await decide(o.cookie, await consent(o, await authParams()), 'allow', origin, extra);
      const label = JSON.stringify([origin, extra]);
      if (accepted) expect(res.status, label).toBe(302);
      else {
        expect(res.status, label).toBe(303);
        expect(res.headers.get('location'), label).toBe('/oauth/authorize?status=blocked');
      }
    }
  });

  it('CSRF: a tampered, garbage or expired consent token issues nothing', async () => {
    const o = await newOwner();
    const a = await authParams();
    const token = await consent(o, a);
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, r: 'http://localhost:6666/steal' })).toString('base64url');
    for (const bad of [`${forged}.${sig}`, 'garbage', '', `${body}.AAAA`]) {
      const res = await decide(o.cookie, bad, 'allow');
      expect(res.headers.get('location'), bad).toBe('/oauth/authorize?status=expired');
    }
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11 * 60_000 });
    const late = await decide(o.cookie, token, 'allow');
    expect(late.headers.get('location')).toBe('/oauth/authorize?status=expired');
    vi.useRealTimers();
    expect(await count(`SELECT count(*) FROM "OAuthAuthorizationCode" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });

  it('the consent form is one-time: submitting the same form twice issues one code', async () => {
    const o = await newOwner();
    const a = await authParams();
    const token = await consent(o, a);
    expect((await decide(o.cookie, token, 'allow')).status).toBe(302);
    const again = await decide(o.cookie, token, 'allow');
    expect(again.status).toBe(303);
    expect(await count(`SELECT count(*) FROM "OAuthAuthorizationCode" WHERE "businessId" = $1`, [o.businessId])).toBe(1);
  });

  it('without a session it sends the person to the login page and issues nothing; a bad body is 400', async () => {
    const o = await newOwner();
    const a = await authParams();
    const res = await decide(undefined, await consent(o, a), 'allow');
    expect(res.headers.get('location')).toBe('/login');
    expect(await count(`SELECT count(*) FROM "OAuthAuthorizationCode" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
    const badType = await authorizePost(new Request(`${ORIGIN}/api/oauth/authorize`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: o.cookie }, body: '{}' }));
    expect(badType.status).toBe(400);
    const repeated = await form(authorizePost, '/api/oauth/authorize', {}, { origin: ORIGIN, cookie: o.cookie });
    expect(repeated.status).toBe(303); // missing fields: expired page, nothing issued
  });
});

/* ---------------------------------- the token endpoint ---------------------------------- */

describe('POST /api/oauth/token: authorization_code', () => {
  it('exchanges a code with the right verifier: opaque tokens, no-store, only hashes stored', async () => {
    const o = await newOwner();
    const { auth, code } = await getCode(o);
    const res = await exchange(auth, code);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const t = res.json;
    expect(t.token_type).toBe('Bearer');
    expect(t.expires_in).toBe(3600);
    expect(t.access_token).toMatch(/^mw_at_[A-Za-z0-9_-]{43}$/);
    expect(t.refresh_token).toMatch(/^mw_rt_[A-Za-z0-9_-]{43}$/);
    expect(t.scope).toBe('setup');
    // hashes only
    expect(await count(`SELECT count(*) FROM "OAuthAccessToken" WHERE "tokenHash" = $1`, [sha256Hex(t.access_token)])).toBe(1);
    expect(await count(`SELECT count(*) FROM "OAuthRefreshToken" WHERE "tokenHash" = $1`, [sha256Hex(t.refresh_token)])).toBe(1);
    for (const table of ['OAuthAccessToken', 'OAuthRefreshToken', 'OAuthAuthorizationCode', 'OAuthGrant']) {
      const dump = JSON.stringify((await pg.query(`SELECT * FROM "${table}"`)).rows);
      expect(dump, table).not.toContain(t.access_token);
      expect(dump, table).not.toContain(t.refresh_token);
      expect(dump, table).not.toContain(code);
    }
    const grant = (await pg.query(`SELECT * FROM "OAuthGrant" WHERE "businessId" = $1`, [o.businessId])).rows[0];
    expect(grant).toMatchObject({ userId: o.userId, clientId: auth.clientId, scope: 'setup', revokedAt: null });
    // access ~1h, refresh ~30 days
    const at = (await pg.query(`SELECT "expiresAt" FROM "OAuthAccessToken" WHERE "grantId" = $1`, [grant.id])).rows[0].expiresAt.getTime() - Date.now();
    const rtExp = (await pg.query(`SELECT "expiresAt" FROM "OAuthRefreshToken" WHERE "grantId" = $1`, [grant.id])).rows[0].expiresAt.getTime() - Date.now();
    expect(at).toBeGreaterThan(59 * 60_000);
    expect(at).toBeLessThanOrEqual(60 * 60_000);
    expect(rtExp).toBeGreaterThan(29 * 24 * 3600_000);
  });

  it('the static client maw3ed-claude works end to end', async () => {
    const o = await newOwner();
    const a = await authParams({ clientId: 'maw3ed-claude' });
    const { code } = await getCode(o, a);
    expect((await exchange(a, code)).status).toBe(200);
  });

  it('a wrong PKCE verifier is invalid_grant, and the code is burned (the right verifier no longer works)', async () => {
    const o = await newOwner();
    const { auth, code } = await getCode(o);
    const bad = await exchange(auth, code, { code_verifier: pkce().verifier });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('invalid_grant');
    const good = await exchange(auth, code);
    expect(good.json.error).toBe('invalid_grant');
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });

  it('a wrong redirect_uri or client_id is invalid_grant and issues nothing', async () => {
    const o = await newOwner();
    const first = await getCode(o);
    expect((await exchange(first.auth, first.code, { redirect_uri: 'https://claude.com/api/mcp/auth_callback' })).json.error).toBe('invalid_grant');
    const second = await getCode(o);
    expect((await exchange(second.auth, second.code, { client_id: 'maw3ed-claude' })).json.error).toBe('invalid_grant');
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });

  it('an expired code (60 s) is invalid_grant', async () => {
    const o = await newOwner();
    const { auth, code } = await getCode(o);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 });
    expect((await exchange(auth, code)).json.error).toBe('invalid_grant');
    vi.useRealTimers();
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });

  it('a replayed (already used) code is invalid_grant AND revokes every token issued from it', async () => {
    const { owner, auth, code, tokens } = await connect();
    // the first exchange succeeded; present the same code again
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(200);
    const again = await exchange(auth, code);
    expect(again.status).toBe(400);
    expect(again.json.error).toBe('invalid_grant');
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
    expect((await refresh(auth.clientId, tokens.refresh_token)).json.error).toBe('invalid_grant');
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1 AND "revokedAt" IS NOT NULL AND "revokedReason" = 'code_replay'`, [owner.businessId])).toBe(1);
  });

  it('concurrent exchanges of one code: exactly one wins', async () => {
    const o = await newOwner();
    const { auth, code } = await getCode(o);
    const results = await Promise.all([exchange(auth, code), exchange(auth, code), exchange(auth, code)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('a code exchanged several times at once: one grant, and the losers revoke it as a replay (no window between claim and grant)', async () => {
    const o = await newOwner();
    const { auth, code } = await getCode(o);
    const rs = await Promise.all([exchange(auth, code), exchange(auth, code), exchange(auth, code), exchange(auth, code)]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1`, [o.businessId])).toBe(1);
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1 AND "revokedReason" = 'code_replay'`, [o.businessId])).toBe(1);
    const winner = rs.find((r) => r.status === 200)!;
    expect((await rpc(winner.json.access_token, 'tools/list')).status).toBe(401);
  });

  it('a resource sent at the token endpoint must equal the one the code was issued for', async () => {
    const o = await newOwner();
    const a = await getCode(o);
    expect((await exchange(a.auth, a.code, { resource: 'https://evil.example/api/mcp/owner' })).json.error).toBe('invalid_target');
    const b = await getCode(o);
    expect((await exchange(b.auth, b.code, { resource: `${RESOURCE}/` })).status).toBe(200);
    // a code issued WITHOUT a resource refuses any resource at the token endpoint
    const c = await authParams();
    const check = await checkAuthorizeRequest({ response_type: 'code', client_id: c.clientId, redirect_uri: c.redirectUri, code_challenge: c.challenge, code_challenge_method: 'S256', state: 's', scope: 'setup' });
    if (check.kind !== 'ok') throw new Error('x');
    const res = await decide(o.cookie, signConsentToken(o, check), 'allow');
    expect((await exchange(c, codeOf(res.headers.get('location')), { resource: RESOURCE })).json.error).toBe('invalid_target');
  });

  it('answers 400 in OAuth format for bad requests', async () => {
    const o = await newOwner();
    const { auth, code } = await getCode(o);
    expect((await form(tokenPost, '/api/oauth/token', {})).json.error).toBe('unsupported_grant_type');
    expect((await form(tokenPost, '/api/oauth/token', { grant_type: 'password', username: 'a', password: 'b' })).json.error).toBe('unsupported_grant_type');
    expect((await form(tokenPost, '/api/oauth/token', { grant_type: 'authorization_code', code })).json.error).toBe('invalid_request');
    expect((await exchange(auth, code, { resource: 'https://evil.example/x' })).json.error).toBe('invalid_target');
    const json = await tokenPost(new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(json.status).toBe(400);
    expect((await json.json()).error).toBe('invalid_request');
    const repeated = await tokenPost(new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=a&grant_type=b' }));
    expect(repeated.status).toBe(400);
    expect((await tokenPost(new Request(`${ORIGIN}/api/oauth/token`))).status).toBe(405);
  });

  it('a user demoted before the exchange gets nothing', async () => {
    const o = await newOwner();
    const { auth, code } = await getCode(o);
    await pg.query(`UPDATE "Membership" SET role = 'STAFF' WHERE "userId" = $1 AND "businessId" = $2`, [o.userId, o.businessId]);
    expect((await exchange(auth, code)).json.error).toBe('invalid_grant');
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1`, [o.businessId])).toBe(0);
  });
});

/* ---------------------------------- refresh rotation ---------------------------------- */

describe('POST /api/oauth/token: refresh_token rotation', () => {
  it('rotates: a new pair every time, the old refresh token is dead', async () => {
    const { auth, tokens } = await connect();
    const r1 = await refresh(auth.clientId, tokens.refresh_token);
    expect(r1.status, r1.text).toBe(200);
    expect(r1.json.refresh_token).not.toBe(tokens.refresh_token);
    expect(r1.json.access_token).not.toBe(tokens.access_token);
    // the old access token was replaced, the new one works
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
    expect((await rpc(r1.json.access_token, 'tools/list')).status).toBe(200);
    const r2 = await refresh(auth.clientId, r1.json.refresh_token);
    expect(r2.status).toBe(200);
    // exactly one unused refresh token per grant
    expect(await count(`SELECT count(*) FROM "OAuthRefreshToken" WHERE "usedAt" IS NULL AND "grantId" = (SELECT "grantId" FROM "OAuthRefreshToken" WHERE "tokenHash" = $1)`, [sha256Hex(r2.json.refresh_token)])).toBe(1);
  });

  it('a retry with the just-rotated token inside the 20 s grace window is invalid_grant WITHOUT revoking; the new pair keeps working', async () => {
    const { owner, auth, tokens } = await connect();
    const r1 = await refresh(auth.clientId, tokens.refresh_token);
    expect(r1.status).toBe(200);
    const retry = await refresh(auth.clientId, tokens.refresh_token);
    expect(retry.json.error).toBe('invalid_grant');
    expect((await rpc(r1.json.access_token, 'tools/list')).status).toBe(200);
    expect((await refresh(auth.clientId, r1.json.refresh_token)).status).toBe(200);
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1 AND "revokedAt" IS NOT NULL`, [owner.businessId])).toBe(0);
  });

  it('a stolen old token presented by ANOTHER client_id inside the window is not a free pass: invalid_grant, no revoke, no tokens', async () => {
    const { auth, tokens } = await connect();
    expect((await refresh(auth.clientId, tokens.refresh_token)).status).toBe(200);
    const other = await refresh('maw3ed-claude', tokens.refresh_token);
    expect(other.json.error).toBe('invalid_grant');
    expect(other.json.access_token).toBeUndefined();
  });

  it('REUSE of an old refresh token OUTSIDE the grace window revokes the whole grant (the new tokens die too)', async () => {
    const { owner, auth, tokens } = await connect();
    const r1 = await refresh(auth.clientId, tokens.refresh_token);
    expect(r1.status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 21_000 });
    const reuse = await refresh(auth.clientId, tokens.refresh_token);
    expect(reuse.status).toBe(400);
    expect(reuse.json.error).toBe('invalid_grant');
    expect((await rpc(r1.json.access_token, 'tools/list')).status).toBe(401);
    expect((await refresh(auth.clientId, r1.json.refresh_token)).json.error).toBe('invalid_grant');
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1 AND "revokedReason" = 'refresh_reuse'`, [owner.businessId])).toBe(1);
  });

  it('concurrent refreshes with the same token: exactly one wins and the grant is revoked', async () => {
    const { auth, tokens } = await connect();
    const results = await Promise.all([refresh(auth.clientId, tokens.refresh_token), refresh(auth.clientId, tokens.refresh_token)]);
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(results.filter((r) => r.status === 400).length).toBeGreaterThanOrEqual(1);
  });

  it('refuses another client_id, an access token as refresh token, junk, and an expired refresh token', async () => {
    const { auth, tokens } = await connect();
    expect((await refresh('maw3ed-claude', tokens.refresh_token)).json.error).toBe('invalid_grant');
    expect((await refresh(auth.clientId, tokens.access_token)).json.error).toBe('invalid_grant');
    expect((await refresh(auth.clientId, 'mw_rt_' + 'z'.repeat(43))).json.error).toBe('invalid_grant');
    expect((await form(tokenPost, '/api/oauth/token', { grant_type: 'refresh_token', client_id: auth.clientId })).json.error).toBe('invalid_request');
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 24 * 3600_000 });
    expect((await refresh(auth.clientId, tokens.refresh_token)).json.error).toBe('invalid_grant');
  });

  it('many concurrent refreshes do not exhaust the connection pool (owner checks run before the transaction)', async () => {
    const conns = await Promise.all(Array.from({ length: 8 }, () => connect()));
    const results = await Promise.all(conns.map((c) => refresh(c.auth.clientId, c.tokens.refresh_token)));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
  });

  it('a demoted owner cannot refresh', async () => {
    const { owner, auth, tokens } = await connect();
    await pg.query(`UPDATE "Membership" SET role = 'STAFF' WHERE "userId" = $1 AND "businessId" = $2`, [owner.userId, owner.businessId]);
    expect((await refresh(auth.clientId, tokens.refresh_token)).json.error).toBe('invalid_grant');
  });
});

/* ---------------------------------- using the token ---------------------------------- */

describe('the access token on /api/mcp/owner', () => {
  it('an expired access token (1 h) is 401', async () => {
    const { tokens } = await connect();
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61 * 60_000 });
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
  });

  it('a revoked grant is 401 at once', async () => {
    const { owner, tokens } = await connect();
    const grants = await call(grantsGet, '/api/oauth/grants', { cookie: owner.cookie });
    expect(grants.status).toBe(200);
    expect(grants.body!.grants).toHaveLength(1);
    const id = grants.body!.grants[0].id;
    const rev = await call(grantRevoke, `/api/oauth/grants/${id}/revoke`, { method: 'POST', cookie: owner.cookie, params: { id } });
    expect(rev.status).toBe(204);
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
    expect((await call(grantsGet, '/api/oauth/grants', { cookie: owner.cookie })).body!.grants).toHaveLength(0);
    expect(await count(`SELECT count(*) FROM "OAuthAccessToken" WHERE "grantId" = $1`, [id])).toBe(0);
    expect(await count(`SELECT count(*) FROM "OAuthRefreshToken" WHERE "grantId" = $1`, [id])).toBe(0);
  });

  it('a grant flagged revoked is refused even if a token row survived (defence in depth)', async () => {
    const { owner, tokens } = await connect();
    await pg.query(`UPDATE "OAuthGrant" SET "revokedAt" = now() WHERE "businessId" = $1`, [owner.businessId]);
    expect(await count(`SELECT count(*) FROM "OAuthAccessToken" WHERE "tokenHash" = $1`, [sha256Hex(tokens.access_token)])).toBe(1);
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
  });

  it('an owner who lost the OWNER role is 401 on the very next call and the grant is revoked', async () => {
    const { owner, tokens } = await connect();
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(200);
    await pg.query(`UPDATE "Membership" SET role = 'STAFF' WHERE "userId" = $1 AND "businessId" = $2`, [owner.userId, owner.businessId]);
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
    expect(await count(`SELECT count(*) FROM "OAuthGrant" WHERE "businessId" = $1 AND "revokedReason" = 'owner_demoted'`, [owner.businessId])).toBe(1);
    // restoring the role does not resurrect it
    await pg.query(`UPDATE "Membership" SET role = 'OWNER' WHERE "userId" = $1 AND "businessId" = $2`, [owner.userId, owner.businessId]);
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
  });

  it('a removed membership (user left the business) is 401', async () => {
    const { owner, tokens } = await connect();
    await pg.query(`DELETE FROM "Membership" WHERE "userId" = $1 AND "businessId" = $2`, [owner.userId, owner.businessId]);
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
  });

  it('records lastUsedAt', async () => {
    const { owner, tokens } = await connect();
    await rpc(tokens.access_token, 'tools/list');
    const row = (await pg.query(`SELECT "lastUsedAt" FROM "OAuthGrant" WHERE "businessId" = $1`, [owner.businessId])).rows[0];
    expect(row.lastUsedAt).not.toBeNull();
  });
});

/* ---------------------------------- revocation (RFC 7009) ---------------------------------- */

describe('POST /api/oauth/revoke', () => {
  it('revokes the grant from an access token or a refresh token, and always answers 200', async () => {
    const a = await connect();
    const r1 = await form(revokePost, '/api/oauth/revoke', { token: a.tokens.access_token });
    expect(r1.status).toBe(200);
    expect((await rpc(a.tokens.access_token, 'tools/list')).status).toBe(401);
    expect((await refresh(a.auth.clientId, a.tokens.refresh_token)).json.error).toBe('invalid_grant');
    const b = await connect();
    expect((await form(revokePost, '/api/oauth/revoke', { token: b.tokens.refresh_token })).status).toBe(200);
    expect((await rpc(b.tokens.access_token, 'tools/list')).status).toBe(401);
    for (const unknown of ['mw_at_' + 'q'.repeat(43), 'junk', '']) expect((await form(revokePost, '/api/oauth/revoke', { token: unknown })).status).toBe(200);
    expect((await form(revokePost, '/api/oauth/revoke', {})).status).toBe(200);
    // a wrong content type is the one 400
    const wrong = await revokePost(new Request(`${ORIGIN}/api/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(wrong.status).toBe(400);
  });
});

/* ---------------------------------- the owner's connected-apps routes ---------------------------------- */

describe('GET /api/oauth/grants and POST /api/oauth/grants/{id}/revoke', () => {
  it('lists this business only: client name, createdAt, lastUsedAt (no tokens, no hashes)', async () => {
    const a = await connect();
    const b = await connect();
    const list = await call(grantsGet, '/api/oauth/grants', { cookie: a.owner.cookie });
    expect(list.status).toBe(200);
    expect(list.body!.grants).toHaveLength(1);
    expect(Object.keys(list.body!.grants[0]).sort()).toEqual(['clientName', 'createdAt', 'id', 'lastUsedAt']);
    expect(JSON.stringify(list.body)).not.toContain(b.tokens.access_token);
    expect(JSON.stringify(list.body)).not.toMatch(/hash/i);
  });

  it('401 without a session, 403 for a receptionist or practitioner', async () => {
    const o = await newOwner();
    expect((await call(grantsGet, '/api/oauth/grants', {})).status).toBe(401);
    for (const role of ['STAFF', 'PRACTITIONER'] as const) {
      const m = await memberWithRole(o.businessId, role);
      expect((await call(grantsGet, '/api/oauth/grants', { cookie: m.cookie })).status, role).toBe(403);
    }
  });

  it('400 for a malformed id, 404 for an unknown one', async () => {
    const o = await newOwner();
    const bad = await call(grantRevoke, '/api/oauth/grants/not-an-id/revoke', { method: 'POST', cookie: o.cookie, params: { id: 'not-an-id' } });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(bad.body!.error.fields).length).toBeGreaterThan(0);
    const unknown = 'c0123456789abcdefghijklmn';
    expect((await call(grantRevoke, `/api/oauth/grants/${unknown}/revoke`, { method: 'POST', cookie: o.cookie, params: { id: unknown } })).status).toBe(404);
  });

  it("cross-tenant: business A cannot revoke business B's grant (404) and B's token keeps working", async () => {
    const a = await newOwner();
    const b = await connect();
    const id = (await pg.query(`SELECT id FROM "OAuthGrant" WHERE "businessId" = $1`, [b.owner.businessId])).rows[0].id;
    const res = await call(grantRevoke, `/api/oauth/grants/${id}/revoke`, { method: 'POST', cookie: a.cookie, params: { id } });
    expect(res.status).toBe(404);
    expect((await rpc(b.tokens.access_token, 'tools/list')).status).toBe(200);
  });

  it('rejects a cross-origin POST', async () => {
    const { owner } = await connect();
    const id = (await pg.query(`SELECT id FROM "OAuthGrant" WHERE "businessId" = $1`, [owner.businessId])).rows[0].id;
    const res = await call(grantRevoke, `/api/oauth/grants/${id}/revoke`, { method: 'POST', cookie: owner.cookie, params: { id }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});
