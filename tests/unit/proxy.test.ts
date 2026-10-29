import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { pickLocale } from '@/i18n/config';
import { config, proxy } from '@/proxy';

const run = (url: string) => proxy(new NextRequest(url));

describe('proxy: ?lang=', () => {
  it('sets the locale cookie and redirects to the same URL without the parameter', () => {
    const res = run('https://maw3ed.example/b/studio-nour?service=s1&lang=ar');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://maw3ed.example/b/studio-nour?service=s1');
    const cookie = res.cookies.get('locale')!;
    expect(cookie).toMatchObject({ value: 'ar', path: '/', sameSite: 'lax', secure: true });
    expect(cookie.maxAge).toBe(31_536_000);
  });

  it('does not mark the cookie Secure on plain http (local dev)', () => {
    const res = run('http://localhost:3000/b/x?lang=en');
    expect(res.cookies.get('locale')).toMatchObject({ value: 'en', secure: false });
    expect(res.headers.get('location')).toBe('http://localhost:3000/b/x');
  });

  it('leaves unsupported or absent values alone', () => {
    for (const url of ['http://localhost:3000/b/x?lang=fr', 'http://localhost:3000/b/x']) {
      const res = run(url);
      expect(res.headers.get('location')).toBeNull();
      expect(res.cookies.get('locale')).toBeUndefined();
    }
  });

  it('matches pages but not the API, Next internals or static files', () => {
    const pattern = new RegExp(`^${config.matcher[0]!}$`);
    expect(pattern.test('/b/studio-nour')).toBe(true);
    expect(pattern.test('/l/token')).toBe(true);
    expect(pattern.test('/')).toBe(true);
    expect(pattern.test('/api/public/x')).toBe(false);
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
    expect(pattern.test('/favicon.ico')).toBe(false);
    expect(pattern.test('/logo.svg')).toBe(false);
  });
});

describe('pickLocale', () => {
  it('prefers the visitor cookie, then the business hint, then English', () => {
    expect(pickLocale('en', 'ar')).toBe('en');
    expect(pickLocale('ar', 'en')).toBe('ar');
    expect(pickLocale(undefined, 'ar')).toBe('ar');
    expect(pickLocale('fr', 'ar')).toBe('ar');
    expect(pickLocale(undefined, undefined)).toBe('en');
    expect(pickLocale('xx', 'yy')).toBe('en');
  });
});
