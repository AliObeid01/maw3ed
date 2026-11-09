import { describe, expect, it } from 'vitest';
import { extractLinkToken } from '@/server/domain/linkInput';

const T = 'eyJhIjoiYWJjIn0.c2lnbmF0dXJl';

describe('extractLinkToken', () => {
  it('accepts a bare token', () => expect(extractLinkToken(T)).toBe(T));
  it('accepts a pasted manage link, with query, hash and surrounding spaces', () => {
    expect(extractLinkToken(`  https://maw3ed.example/l/${T}?utm=1#top `)).toBe(T);
    expect(extractLinkToken(`https://maw3ed.example/ar/l/${T}`)).toBe(T);
    expect(extractLinkToken(`/l/${T}`)).toBe(T);
  });
  it('rejects other schemes, other paths, junk and oversized input', () => {
    expect(extractLinkToken(`javascript:alert(1)//l/${T}`)).toBeNull();
    expect(extractLinkToken(`ftp://x.example/l/${T}`)).toBeNull();
    expect(extractLinkToken(`https://maw3ed.example/pay/${T}`)).toBeNull();
    expect(extractLinkToken('https://maw3ed.example/l/not-a-token')).toBeNull();
    expect(extractLinkToken('hello')).toBeNull();
    expect(extractLinkToken('')).toBeNull();
    expect(extractLinkToken('x'.repeat(5000))).toBeNull();
  });
});
