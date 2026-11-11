import { describe, expect, it } from 'vitest';
import { scrubString, scrubValue } from '@/lib/observability/scrub';

const at = 'mw_at_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const rt = 'mw_rt_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0F9e';

describe('scrub: OAuth tokens of the owner connector', () => {
  it('removes access and refresh tokens from any string', () => {
    for (const s of [`token ${at} failed`, `x=${rt}`, `mw_at_short`, `refresh ${rt} access ${at}`]) {
      const out = scrubString(s);
      expect(out).not.toContain('mw_at_');
      expect(out).not.toContain('mw_rt_');
    }
    expect(scrubString(`bad token ${at}`)).toBe('bad token [token]');
  });

  it('removes Authorization headers, code verifiers, consent tokens and redirect URIs from messages and objects', () => {
    expect(scrubString(`Authorization: Bearer ${at}`)).not.toContain(at);
    expect(scrubString('code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toContain('[redacted]');
    expect(scrubString('access_token=abc123 refresh_token=def456')).not.toMatch(/abc123|def456/);
    const obj = scrubValue({
      access_token: at,
      refresh_token: rt,
      code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      consent: 'abc.def',
      redirect_uri: 'http://localhost:1234/cb',
      ok: 'fine',
    }) as Record<string, unknown>;
    expect(JSON.stringify(obj)).not.toMatch(/mw_at_|mw_rt_|dBjft|E9Mel|abc\.def|localhost:1234/);
    expect(obj.ok).toBe('fine');
  });

  it('drops the query of the redirect that carries the authorization code', () => {
    const out = scrubString('GET https://claude.ai/api/mcp/auth_callback?code=Zm9vYmFyYmF6cXV4&state=xyz 302');
    expect(out).not.toMatch(/Zm9v|state=/);
  });
});
