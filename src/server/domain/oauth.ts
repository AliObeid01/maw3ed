import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pure OAuth 2.1 helpers for the owner assistant connector: PKCE S256, the redirect-URI allowlist, opaque token
 * shapes. No I/O, no clock, no env. See docs/MCP_OWNER.md.
 */
export const STATIC_CLIENT_ID = 'maw3ed-claude';
export const STATIC_CLIENT_NAME = 'Claude';
export const OWNER_SCOPE = 'setup';

export const ACCESS_PREFIX = 'mw_at_';
export const REFRESH_PREFIX = 'mw_rt_';
export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

const CLAUDE_CALLBACKS: readonly string[] = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];
// Loopback (Claude Code): http, localhost or 127.0.0.1, an explicit port, an absolute path, no userinfo, no fragment.
const LOOPBACK = /^http:\/\/(?:[lL][oO][cC][aA][lL][hH][oO][sS][tT]|127\.0\.0\.1):([1-9]\d{0,4})(\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*)?$/;

/** May this redirect URI be registered at all? Exact match for the two Claude callbacks, loopback with a port. */
export function isAllowedRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 300) return false;
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  const m = LOOPBACK.exec(uri);
  if (!m) return false;
  if (Number(m[1]) > 65535) return false;
  // An `@` in the path is harmless, but nothing resembling userinfo ever passes.
  return !(m[2] ?? '').includes('@');
}

/** Exact string equality against the client's registered list (no normalisation, no prefix, no wildcard). */
export function redirectUriMatches(registered: readonly string[], given: string): boolean {
  return registered.some((r) => r === given);
}

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const isValidChallenge = (c: unknown): c is string => typeof c === 'string' && CHALLENGE.test(c);

/** PKCE S256: base64url(sha256(verifier)) equals the challenge, compared in constant time. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !isValidChallenge(challenge)) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  // Hash both sides first so the comparison is over equal-length buffers whatever the inputs were.
  const a = createHash('sha256').update(computed).digest();
  const b = createHash('sha256').update(challenge).digest();
  return timingSafeEqual(a, b);
}

export const newAccessToken = () => ACCESS_PREFIX + randomBytes(32).toString('base64url');
export const newRefreshToken = () => REFRESH_PREFIX + randomBytes(32).toString('base64url');
export const newAuthorizationCode = () => randomBytes(32).toString('base64url');

export function tokenKind(token: string): 'access' | 'refresh' | null {
  if (token.startsWith(ACCESS_PREFIX)) return 'access';
  if (token.startsWith(REFRESH_PREFIX)) return 'refresh';
  return null;
}
