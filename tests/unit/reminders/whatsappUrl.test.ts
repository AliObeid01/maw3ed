import { describe, expect, it } from 'vitest';
import { whatsappUrl } from '@/server/domain/whatsapp';

describe('whatsappUrl', () => {
  it('uses the digits of the E.164 number and an encoded message', () => {
    const url = whatsappUrl('+96171234567', 'Hi & bye?\nhttps://x.test/l/a.b');
    expect(url.startsWith('https://wa.me/96171234567?text=')).toBe(true);
    const text = new URL(url).searchParams.get('text');
    expect(text).toBe('Hi & bye?\nhttps://x.test/l/a.b');
    expect(url).not.toContain('+');
    expect(url).not.toContain(' ');
  });
  it('rejects anything that is not E.164', () => {
    expect(() => whatsappUrl('71234567', 'x')).toThrow();
    expect(() => whatsappUrl('+961 71/../', 'x')).toThrow();
  });
});
