import { describe, expect, it } from 'vitest';
import { loginHref, safeNext } from '@/lib/auth/safeNext';

const q = new URLSearchParams({
  response_type: 'code',
  client_id: 'maw3ed-claude',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  state: 'a b&c',
}).toString();

describe('safeNext allows the OAuth consent page and nothing else outside /app/', () => {
  it('accepts /oauth/authorize with a percent-encoded query', () => {
    const next = `/oauth/authorize?${q}`;
    expect(safeNext(next)).toBe(next);
    expect(loginHref(next)).toBe(`/login?next=${encodeURIComponent(next)}`);
  });

  it.each([
    '//evil.com/oauth/authorize?x=1',
    '/oauth/authorize', // no query: not the OAuth flow
    '/oauth/authorizeevil?x=1',
    '/oauth/authorize/../x?y=1',
    '/oauth/authorize?x=1#frag',
    '/oauth/authorize?x=https://evil.com', // a literal URL in the query is not encoded: refuse
    '/oauth/authorize?x=1\r\nSet-Cookie: a=b',
    '/oauth/authorize?x=1 y',
    '/oauth/authorize?x=1\\evil.com',
    '/oauth/authorize?x=‮',
    'https://evil.com/oauth/authorize?x=1',
    '/oauth/token?x=1',
    '/api/oauth/authorize?x=1',
    `/oauth/authorize?${'a=b&'.repeat(500)}`,
  ])('rejects %j', (bad) => expect(safeNext(bad)).toBeNull());
});
