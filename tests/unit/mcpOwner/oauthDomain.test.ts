import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_PREFIX,
  REFRESH_PREFIX,
  isAllowedRedirectUri,
  isValidChallenge,
  newAccessToken,
  newRefreshToken,
  redirectUriMatches,
  tokenKind,
  verifyPkceS256,
} from '@/server/domain/oauth';
import { sha256Hex } from '@/server/services/crypto';

const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = createHash('sha256').update(verifier).digest('base64url');

describe('PKCE S256', () => {
  it('accepts the matching verifier (RFC 7636 appendix B vector)', () => {
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });
  it('rejects a wrong verifier, an empty one, a too short one and a plain-method style challenge', () => {
    expect(verifyPkceS256(verifier + 'x', challenge)).toBe(false);
    expect(verifyPkceS256('', challenge)).toBe(false);
    expect(verifyPkceS256('short', challenge)).toBe(false);
    // method "plain": challenge == verifier must NOT verify
    expect(verifyPkceS256(verifier, verifier)).toBe(false);
  });
  it('validates the challenge shape (43 base64url chars)', () => {
    expect(isValidChallenge(challenge)).toBe(true);
    expect(isValidChallenge('abc')).toBe(false);
    expect(isValidChallenge(challenge + '=')).toBe(false);
    expect(isValidChallenge('')).toBe(false);
  });
});

describe('redirect URI allowlist', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'http://localhost:54321/callback',
    'http://127.0.0.1:8080/oauth/callback',
    'http://localhost:3000/',
    'http://LOCALHOST:3000/cb',
    'http://LocalHost:8080/cb',
  ])('allows %s', (uri) => expect(isAllowedRedirectUri(uri)).toBe(true));

  it.each([
    'https://evil.example/cb',
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai/api/mcp/auth_callback?x=1',
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    'https://evil.example/https://claude.ai/api/mcp/auth_callback',
    'http://claude.ai/api/mcp/auth_callback',
    'https://claude.ai:444/api/mcp/auth_callback',
    'https://user@claude.ai/api/mcp/auth_callback',
    'http://localhost/cb', // no port
    'http://localhost:0/cb',
    'http://localhost:99999/cb',
    'http://localhost:3000@evil.example/cb',
    'http://localhost.evil.example:3000/cb',
    'http://LOCALHOST.evil.example:3000/cb',
    'HTTPS://CLAUDE.AI/api/mcp/auth_callback',
    'http://[::1]:3000/cb',
    'http://localhost:3000/cb#frag',
    'https://localhost:3000/cb',
    'javascript:alert(1)',
    'myapp://callback',
    '',
    'claude.ai/api/mcp/auth_callback',
  ])('rejects %s', (uri) => expect(isAllowedRedirectUri(uri)).toBe(false));

  it('matches a registered URI by exact string only', () => {
    const reg = ['https://claude.ai/api/mcp/auth_callback'];
    expect(redirectUriMatches(reg, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriMatches(reg, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(redirectUriMatches(reg, 'https://claude.ai/api/mcp/auth_callback?a=b')).toBe(false);
    expect(redirectUriMatches(reg, 'HTTPS://CLAUDE.AI/api/mcp/auth_callback')).toBe(false);
    expect(redirectUriMatches([], 'https://claude.ai/api/mcp/auth_callback')).toBe(false);
  });
});

describe('opaque tokens', () => {
  it('have the documented prefixes, 256 bits of entropy and distinct values', () => {
    const a = newAccessToken();
    const r = newRefreshToken();
    expect(a.startsWith(ACCESS_PREFIX)).toBe(true);
    expect(r.startsWith(REFRESH_PREFIX)).toBe(true);
    expect(a.slice(ACCESS_PREFIX.length)).toHaveLength(43); // 32 bytes base64url
    expect(newAccessToken()).not.toBe(a);
    expect(tokenKind(a)).toBe('access');
    expect(tokenKind(r)).toBe('refresh');
    expect(tokenKind('whatever')).toBe(null);
  });
  it('are stored only as sha256 (the hash never contains the token)', () => {
    const a = newAccessToken();
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(a)).not.toContain(a.slice(ACCESS_PREFIX.length));
  });
});
