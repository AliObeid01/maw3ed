import { describe, expect, it } from 'vitest';
import { clientIp } from '@/server/http/clientIp';

const req = (headers: Record<string, string>) => new Request('http://x.test/', { headers });

describe('clientIp', () => {
  it('prefers x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for entry', () => {
    const all = {
      'x-vercel-forwarded-for': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
      'x-forwarded-for': '3.3.3.3, 4.4.4.4',
    };
    expect(clientIp(req(all))).toBe('1.1.1.1');
    expect(clientIp(req({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }))).toBe('2.2.2.2');
    expect(clientIp(req({ 'x-forwarded-for': ' 3.3.3.3 , 4.4.4.4' }))).toBe('3.3.3.3');
  });
  it('falls back to unknown, and refuses junk values as keys', () => {
    expect(clientIp(req({}))).toBe('unknown');
    expect(clientIp(req({ 'x-real-ip': 'a b; DROP TABLE' }))).toBe('unknown');
    expect(clientIp(req({ 'x-real-ip': 'x'.repeat(200) }))).toBe('unknown');
    expect(clientIp(req({ 'x-forwarded-for': '2001:DB8::1' }))).toBe('2001:db8::1');
  });
});
