import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  OWNER_SCOPE,
  REFRESH_TTL_MS,
  STATIC_CLIENT_ID,
  STATIC_CLIENT_NAME,
  isAllowedRedirectUri,
  isValidChallenge,
  newAccessToken,
  newAuthorizationCode,
  newRefreshToken,
  redirectUriMatches,
  tokenKind,
  verifyPkceS256,
} from '@/server/domain/oauth';
import {
  CONSENT_TTL_SEC,
  deriveConsentKey,
  signConsent,
  verifyConsent,
  type ConsentPayload,
} from '@/server/domain/consentToken';
import { requireLinkSecret } from '@/server/env';
import { childLogger } from '@/server/http/logger';
import { cleanText } from '@/server/mcp/sanitize';
import { resourceMatches } from '@/server/mcp/ownerConfig';
import { membershipRepo } from '@/server/repositories/membership.repo';
import { oauthRepo, type ClientRow } from '@/server/repositories/oauth.repo';
import { sha256Hex } from './crypto';

/**
 * OAuth 2.1 authorization server of the owner connector: dynamic client registration (public clients), the
 * authorization decision, the token endpoint with PKCE, rotation and reuse detection, revocation, and bearer
 * authentication of /api/mcp/owner. No Prisma here (repositories only). See docs/MCP_OWNER.md for the threat model.
 */

export class OAuthError extends Error {
  constructor(
    readonly error:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'invalid_token'
      | 'invalid_target'
      | 'invalid_scope'
      | 'unsupported_grant_type'
      | 'invalid_redirect_uri'
      | 'invalid_client_metadata'
      | 'access_denied'
      | 'unsupported_response_type',
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export interface Deps {
  now: () => Date;
}
const defaultDeps: Deps = { now: () => new Date() };

export interface OwnerActor {
  userId: string;
  businessId: string;
  role: 'OWNER';
  grantId: string;
}

const staticClient = (): ClientRow => ({
  clientId: STATIC_CLIENT_ID,
  name: STATIC_CLIENT_NAME,
  redirectUris: [
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
  ],
});

/** The static client accepts any redirect URI the allowlist accepts (loopback ports vary per Claude Code run). */
const isStatic = (clientId: string) => clientId === STATIC_CLIENT_ID;

export async function findClient(clientId: string): Promise<ClientRow | null> {
  if (isStatic(clientId)) return staticClient();
  if (!/^mwc_[A-Za-z0-9_-]{16,40}$/.test(clientId)) return null;
  return oauthRepo.findClient(clientId);
}

/** Redirect URIs a client may use: the registered list (dynamic) or the allowlist (static). Exact match either way. */
function redirectOk(client: ClientRow, uri: string): boolean {
  if (!isAllowedRedirectUri(uri)) return false; // defence in depth: stored rows are re-checked on every use
  return isStatic(client.clientId) ? true : redirectUriMatches(client.redirectUris, uri);
}

/* ---------------------------------- registration (RFC 7591) ---------------------------------- */

const RegisterBody = z
  .object({
    redirect_uris: z.array(z.string().max(300)).min(1).max(5),
    client_name: z.string().max(200).optional(),
    token_endpoint_auth_method: z.string().max(40).optional(),
    grant_types: z.array(z.string().max(40)).max(5).optional(),
    response_types: z.array(z.string().max(40)).max(5).optional(),
    scope: z.string().max(100).optional(),
  })
  .loose();

export async function registerClient(input: unknown) {
  const parsed = RegisterBody.safeParse(input);
  if (!parsed.success)
    throw new OAuthError('invalid_client_metadata', 'redirect_uris is required: a list of up to 5 URIs.');
  const body = parsed.data;
  for (const uri of body.redirect_uris)
    if (!isAllowedRedirectUri(uri))
      throw new OAuthError(
        'invalid_redirect_uri',
        'A redirect URI is not allowed. Only the Claude callbacks and http://localhost or http://127.0.0.1 with a port are accepted.',
      );
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none')
    throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported.');
  const grants = body.grant_types ?? ['authorization_code', 'refresh_token'];
  if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))
    throw new OAuthError('invalid_client_metadata', 'Only the authorization_code and refresh_token grants are supported.');
  if ((body.response_types ?? ['code']).some((r) => r !== 'code'))
    throw new OAuthError('invalid_client_metadata', 'Only the "code" response type is supported.');
  const scopes = (body.scope ?? OWNER_SCOPE).split(/\s+/).filter(Boolean);
  if (scopes.some((s) => s !== OWNER_SCOPE))
    throw new OAuthError('invalid_client_metadata', `Only the "${OWNER_SCOPE}" scope is supported.`);

  const clientId = `mwc_${randomBytes(16).toString('base64url')}`;
  const name = cleanText(body.client_name, 60) || STATIC_CLIENT_NAME;
  const redirectUris = [...new Set(body.redirect_uris)];
  await oauthRepo.createClient({ clientId, name, redirectUris });
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: OWNER_SCOPE,
    client_id_issued_at: Math.floor(defaultDeps.now().getTime() / 1000),
  };
}

/* ---------------------------------- authorization request ---------------------------------- */

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export type AuthorizeCheck =
  /** client_id or redirect_uri is bad: shown on OUR page, never redirected anywhere. */
  | { kind: 'page_error'; reason: 'client' | 'redirect_uri' }
  /** The redirect target is trusted but the request is malformed: send the error back to the client. */
  | { kind: 'redirect_error'; redirectUri: string; error: string; state: string | null }
  | {
      kind: 'ok';
      client: ClientRow;
      redirectUri: string;
      challenge: string;
      state: string;
      scope: string;
      resource: string | null;
    };

const MAX_STATE = 500;

export async function checkAuthorizeRequest(p: AuthorizeParams): Promise<AuthorizeCheck> {
  if (!p.client_id) return { kind: 'page_error', reason: 'client' };
  const client = await findClient(p.client_id);
  if (!client) return { kind: 'page_error', reason: 'client' };
  if (!p.redirect_uri || !redirectOk(client, p.redirect_uri))
    return { kind: 'page_error', reason: 'redirect_uri' };
  const redirectUri = p.redirect_uri;
  const state = p.state ?? '';
  const fail = (error: string): AuthorizeCheck => ({
    kind: 'redirect_error',
    redirectUri,
    error,
    state: state || null,
  });
  if (state.length > MAX_STATE) return fail('invalid_request');
  if (p.response_type !== 'code') return fail('unsupported_response_type');
  if (!isValidChallenge(p.code_challenge) || p.code_challenge_method !== 'S256') return fail('invalid_request');
  const scopes = (p.scope ?? OWNER_SCOPE).split(/\s+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((s) => s !== OWNER_SCOPE)) return fail('invalid_scope');
  if (p.resource !== undefined && !resourceMatches(p.resource)) return fail('invalid_target');
  return {
    kind: 'ok',
    client,
    redirectUri,
    challenge: p.code_challenge,
    state,
    scope: OWNER_SCOPE,
    resource: p.resource === undefined ? null : p.resource.replace(/\/+$/, ''),
  };
}

const consentKey = () => deriveConsentKey(requireLinkSecret());

/** The signed form token the consent page embeds. Bound to the user, business and every request parameter. */
export function signConsentToken(
  who: { userId: string; businessId: string },
  req: Extract<AuthorizeCheck, { kind: 'ok' }>,
  deps: Deps = defaultDeps,
): string {
  const payload: ConsentPayload = {
    u: who.userId,
    b: who.businessId,
    c: req.client.clientId,
    r: req.redirectUri,
    ch: req.challenge,
    s: req.state,
    res: req.resource,
    sc: req.scope,
    n: randomBytes(16).toString('base64url'),
    exp: Math.floor(deps.now().getTime() / 1000) + CONSENT_TTL_SEC,
  };
  return signConsent(payload, consentKey());
}

export type DecisionResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'invalid_form' }
  | { kind: 'not_owner' };

function withParams(base: string, params: Record<string, string | null>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== '') url.searchParams.set(k, v);
  return url.toString();
}

/**
 * The decision POST. `who` comes from the SESSION cookie (never from the form). Allow issues a single-use code
 * (60 s, only its sha256 stored); Cancel sends access_denied back. Re-checks everything the signed token carries.
 */
export async function decide(
  who: { userId: string; businessId: string; role: string },
  form: { consent: string; decision: string },
  deps: Deps = defaultDeps,
): Promise<DecisionResult> {
  const now = deps.now();
  const verified = verifyConsent(form.consent, consentKey(), now, who);
  if (!verified.ok) return { kind: 'invalid_form' };
  const p = verified.payload;
  // The decision is allowed only to the OWNER of this business, at the moment of the click.
  if (who.role !== 'OWNER') return { kind: 'not_owner' };
  const check = await checkAuthorizeRequest({
    response_type: 'code',
    client_id: p.c,
    redirect_uri: p.r,
    code_challenge: p.ch,
    code_challenge_method: 'S256',
    state: p.s,
    scope: p.sc,
    ...(p.res ? { resource: p.res } : {}),
  });
  if (check.kind !== 'ok') return { kind: 'invalid_form' };
  if (form.decision !== 'allow')
    return { kind: 'redirect', location: withParams(p.r, { error: 'access_denied', state: p.s }) };
  const code = newAuthorizationCode();
  try {
    await oauthRepo.insertCode({
      codeHash: sha256Hex(code),
      consentNonce: p.n,
      clientId: p.c,
      redirectUri: p.r,
      codeChallenge: p.ch,
      resource: p.res,
      scope: p.sc,
      userId: who.userId,
      businessId: who.businessId,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    });
  } catch (error) {
    // Unique violation on consentNonce: this consent form was already used. One consent = one code.
    if ((error as { code?: string })?.code === 'P2002') return { kind: 'invalid_form' };
    throw error;
  }
  return { kind: 'redirect', location: withParams(p.r, { code, state: p.s }) };
}

/* ---------------------------------- token endpoint ---------------------------------- */

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const logger = () => childLogger({ requestId: randomUUID(), component: 'oauth' });

function newPair(now: Date) {
  const access = newAccessToken();
  const refresh = newRefreshToken();
  return {
    access,
    refresh,
    stored: {
      accessHash: sha256Hex(access),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      refreshHash: sha256Hex(refresh),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
  };
}

const response = (pair: ReturnType<typeof newPair>, scope: string): TokenResponse => ({
  access_token: pair.access,
  token_type: 'Bearer',
  expires_in: Math.floor(ACCESS_TTL_MS / 1000),
  refresh_token: pair.refresh,
  scope,
});

const isOwner = async (businessId: string, userId: string) =>
  (await membershipRepo.findRole(businessId, userId))?.role === 'OWNER';

export type TokenForm = Record<string, string | undefined>;

export async function token(form: TokenForm, deps: Deps = defaultDeps): Promise<TokenResponse> {
  const now = deps.now();
  if (form.grant_type === 'authorization_code') return exchangeCode(form, now);
  if (form.grant_type === 'refresh_token') return refresh(form, now);
  throw new OAuthError('unsupported_grant_type', 'Use grant_type authorization_code or refresh_token.');
}

async function exchangeCode(form: TokenForm, now: Date): Promise<TokenResponse> {
  const { code, redirect_uri, client_id, code_verifier } = form;
  if (!code || !redirect_uri || !client_id || !code_verifier)
    throw new OAuthError('invalid_request', 'code, redirect_uri, client_id and code_verifier are required.');
  if (form.resource !== undefined && !resourceMatches(form.resource))
    throw new OAuthError('invalid_target', 'The resource must be this site\'s owner endpoint.');
  const hash = sha256Hex(code);
  const gone = () => new OAuthError('invalid_grant', 'The authorization code is invalid, expired or already used.');
  const replay = async (grantId: string | null) => {
    // A code that was already exchanged is shown again: assume theft and kill everything issued from it.
    if (grantId) await oauthRepo.revokeGrant(grantId, 'code_replay', now);
    logger().warn({ grantId }, 'oauth authorization code replayed; grant revoked');
    return gone();
  };
  const c = await oauthRepo.peekCode(hash);
  if (!c) throw gone();
  if (c.usedAt) throw await replay(c.grantId);
  // Validate BEFORE the claim transaction (it may query other tables; the transaction must use one connection).
  // Any mismatch burns the code: a guess at the verifier or the redirect gets one try.
  let problem: OAuthError | null = null;
  const bad = () => new OAuthError('invalid_grant', 'The authorization code does not match this request.');
  if (c.clientId !== client_id || c.redirectUri !== redirect_uri || !verifyPkceS256(code_verifier, c.codeChallenge))
    problem = bad();
  else if (form.resource !== undefined && form.resource.replace(/\/+$/, '') !== c.resource)
    problem = new OAuthError('invalid_target', 'The resource does not match the one this code was issued for.');
  const client = problem ? null : await findClient(c.clientId);
  if (!problem && !client) problem = bad();
  if (!problem && !(await isOwner(c.businessId, c.userId))) problem = bad();
  if (problem || !client) {
    await oauthRepo.claimCode(hash, now);
    throw problem ?? bad();
  }
  const pair = newPair(now);
  const issued = await oauthRepo.claimAndIssue(hash, now, client.name, pair.stored);
  if (issued.kind === 'replayed') throw await replay(issued.grantId);
  if (issued.kind === 'invalid') throw gone();
  return response(pair, issued.scope);
}

async function refresh(form: TokenForm, now: Date): Promise<TokenResponse> {
  const { refresh_token, client_id } = form;
  if (!refresh_token || !client_id) throw new OAuthError('invalid_request', 'refresh_token and client_id are required.');
  if (tokenKind(refresh_token) !== 'refresh') throw new OAuthError('invalid_grant', 'The refresh token is invalid.');
  const hash = sha256Hex(refresh_token);
  const invalid = () => new OAuthError('invalid_grant', 'The refresh token is invalid or expired.');
  // Checks that read other tables run BEFORE the rotation transaction (it uses a single connection).
  const known = await oauthRepo.findRefreshGrant(hash);
  if (!known || known.revoked || known.clientId !== client_id) throw invalid();
  if (!known.usedAt && !(await isOwner(known.businessId, known.userId))) throw invalid();
  const pair = newPair(now);
  const result = await oauthRepo.rotateRefresh(hash, now, pair.stored, client_id);
  if (result.kind === 'grace')
    // A retry of a refresh whose response was lost (inside the grace window): refused, nothing revoked.
    throw new OAuthError('invalid_grant', 'The refresh token was just used. Use the newest token you received or sign in again.');
  if (result.kind === 'reuse') {
    // An old (already rotated) refresh token came back: someone holds a stolen copy. Revoke the whole grant.
    await oauthRepo.revokeGrant(result.grantId, 'refresh_reuse', now);
    logger().warn({ grantId: result.grantId }, 'oauth refresh token reused; grant revoked');
    throw new OAuthError('invalid_grant', 'The refresh token is invalid or was already used.');
  }
  if (result.kind === 'invalid') throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired.');
  return response(pair, OWNER_SCOPE);
}

/** RFC 7009: always succeeds from the caller's view; a known token revokes its whole grant. */
export async function revoke(rawToken: string | undefined, deps: Deps = defaultDeps): Promise<void> {
  if (!rawToken || !tokenKind(rawToken)) return;
  const grantId = await oauthRepo.grantIdOfToken(sha256Hex(rawToken));
  if (grantId) await oauthRepo.revokeGrant(grantId, 'client_revoke', deps.now());
}

/* ---------------------------------- bearer authentication of /api/mcp/owner ---------------------------------- */

/**
 * Resolve a Bearer access token to its actor, re-verifying on EVERY call that the grant is live and that the
 * grant's user still holds an OWNER membership in that business (else the grant is revoked and the call is 401).
 */
export async function authenticateBearer(raw: string | null, deps: Deps = defaultDeps): Promise<OwnerActor> {
  const now = deps.now();
  const invalid = () => new OAuthError('invalid_token', 'The access token is missing, invalid or expired.', 401);
  if (!raw || raw.length > 200 || tokenKind(raw) !== 'access') throw invalid();
  const ctx = await oauthRepo.findByAccessHash(sha256Hex(raw));
  if (!ctx || ctx.revoked || ctx.tokenExpiresAt <= now || ctx.scope !== OWNER_SCOPE) throw invalid();
  if (!(await isOwner(ctx.businessId, ctx.userId))) {
    await oauthRepo.revokeGrant(ctx.grantId, 'owner_demoted', now);
    throw invalid();
  }
  await oauthRepo.touch(ctx.grantId, now).catch(() => {});
  return { userId: ctx.userId, businessId: ctx.businessId, role: 'OWNER', grantId: ctx.grantId };
}

/* ---------------------------------- owner-facing grants (session routes) ---------------------------------- */

export async function listGrants(businessId: string) {
  const rows = await oauthRepo.listActive(businessId);
  return {
    grants: rows.map((g) => ({
      id: g.id,
      clientName: g.clientName,
      createdAt: g.createdAt.toISOString(),
      lastUsedAt: g.lastUsedAt ? g.lastUsedAt.toISOString() : null,
    })),
  };
}

export async function revokeGrantForBusiness(businessId: string, grantId: string, deps: Deps = defaultDeps) {
  return oauthRepo.revokeForBusiness(businessId, grantId, deps.now());
}
