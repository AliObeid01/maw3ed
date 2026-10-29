import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIp, normaliseIp, resetClientIpWarning } from '@/server/http/clientIp';
import { rootLogger } from '@/server/http/logger';

const req = (headers: Record<string, string>) => new Request('http://x.test/', { headers });
const VERCEL = { VERCEL: '1' } as NodeJS.ProcessEnv;
const PLAIN = {} as NodeJS.ProcessEnv;

describe('normaliseIp', () => {
  it('keeps IPv4, rejects malformed IPv4', () => {
    expect(normaliseIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('256.1.1.1')).toBeUndefined();
    expect(normaliseIp('1.2.3')).toBeUndefined();
  });
  it('masks IPv6 to its /64: addresses in one /64 share a key, another /64 does not', () => {
    const a = normaliseIp('2001:db8::1');
    expect(a).toBe('2001:0db8:0000:0000::/64');
    expect(normaliseIp('2001:db8:0:0:ffff::2')).toBe(a);
    expect(normaliseIp('2001:DB8:0:0:1:2:3:4')).toBe(a);
    expect(normaliseIp('2001:db8:0:1::1')).not.toBe(a);
  });
  it('maps ::ffff:a.b.c.d to the IPv4 address', () => {
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('::FFFF:cb00:7107')).toBe('203.0.113.7');
  });
  it('strips a zone suffix and brackets', () => {
    expect(normaliseIp('fe80::1%eth0')).toBe(normaliseIp('fe80::2'));
    expect(normaliseIp('[2001:db8::1]')).toBe('2001:0db8:0000:0000::/64');
  });
  it('rejects junk', () => {
    for (const bad of [
      'a b; DROP TABLE',
      'x'.repeat(200),
      '',
      'abc',
      '1:2:3',
      ':::',
      '::g',
      '1::2::3',
    ])
      expect(normaliseIp(bad), bad).toBeUndefined();
  });
});

describe('clientIp', () => {
  beforeEach(() => resetClientIpWarning());

  it('prefers x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for entry (trusted)', () => {
    const all = {
      'x-vercel-forwarded-for': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
      'x-forwarded-for': '3.3.3.3, 4.4.4.4',
    };
    expect(clientIp(req(all), VERCEL)).toBe('1.1.1.1');
    expect(clientIp(req({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }), VERCEL)).toBe(
      '2.2.2.2',
    );
    expect(clientIp(req({ 'x-forwarded-for': ' 3.3.3.3 , 4.4.4.4' }), VERCEL)).toBe('3.3.3.3');
    expect(
      clientIp(req({ 'x-forwarded-for': '3.3.3.3' }), { TRUST_PROXY_HEADERS: '1' } as never),
    ).toBe('3.3.3.3');
  });

  it('ignores x-real-ip and x-forwarded-for unless Vercel or TRUST_PROXY_HEADERS=1', () => {
    const spoof = { 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' };
    expect(clientIp(req(spoof), PLAIN)).toBe('unknown');
    expect(clientIp(req(spoof), { TRUST_PROXY_HEADERS: '0' } as never)).toBe('unknown');
    // x-vercel-forwarded-for is honoured everywhere.
    expect(clientIp(req({ 'x-vercel-forwarded-for': '1.1.1.1' }), PLAIN)).toBe('1.1.1.1');
  });

  it('an invalid x-vercel-forwarded-for falls through to the next trusted header', () => {
    expect(
      clientIp(req({ 'x-vercel-forwarded-for': 'garbage', 'x-real-ip': '2.2.2.2' }), VERCEL),
    ).toBe('2.2.2.2');
    expect(clientIp(req({ 'x-vercel-forwarded-for': 'garbage' }), PLAIN)).toBe('unknown');
  });

  it('falls back to unknown and normalises IPv6', () => {
    expect(clientIp(req({}), VERCEL)).toBe('unknown');
    expect(clientIp(req({ 'x-vercel-forwarded-for': '2001:DB8::1' }), PLAIN)).toBe(
      '2001:0db8:0000:0000::/64',
    );
  });

  it('warns once per process when production resolves unknown, never otherwise', () => {
    const warn = vi.spyOn(rootLogger, 'warn').mockImplementation(() => undefined);
    clientIp(req({}), { NODE_ENV: 'development' } as never);
    expect(warn).not.toHaveBeenCalled();
    clientIp(req({}), { NODE_ENV: 'production' } as never);
    clientIp(req({}), { NODE_ENV: 'production' } as never);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
