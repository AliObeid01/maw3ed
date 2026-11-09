import { describe, expect, it } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { SITE } from '@/lib/site';

describe('displayed address vs SITE.address', () => {
  it('en public.footer.address equals the machine value SITE.address', () => {
    expect(en.public.footer.address).toBe(SITE.address);
  });

  it('ar has its own translated address (not the Latin machine value)', () => {
    expect(ar.public.footer.address).not.toBe(SITE.address);
    expect(ar.public.footer.address).toMatch(/[؀-ۿ]/);
  });
});
