import { describe, expect, it } from 'vitest';
import { COPYRIGHT_YEAR, LEGAL_DRAFT, LEGAL_UPDATED, SITE, socialLinks } from '@/lib/site';

describe('site config', () => {
  it('keeps the owner placeholders until they are replaced', () => {
    expect(SITE.email).toBe('hello@[YOUR-DOMAIN]');
    expect(SITE.phone).toBe('+961 [XX XXX XXX]');
    expect(SITE.address).toBe('[YOUR ADDRESS], Lebanon');
  });
  it('shows no social link until a URL is configured', () => {
    expect(socialLinks({ instagram: '', whatsapp: '', facebook: '' })).toEqual([]);
    expect(socialLinks({ instagram: 'https://instagram.com/x', whatsapp: '', facebook: '' })).toEqual([
      { id: 'instagram', url: 'https://instagram.com/x' },
    ]);
    expect(socialLinks(SITE.social)).toEqual([]);
  });
  it('rejects non-https social URLs', () => {
    expect(socialLinks({ instagram: 'javascript:alert(1)', whatsapp: '', facebook: '' })).toEqual([]);
  });
  it('has fixed legal constants', () => {
    expect(LEGAL_DRAFT).toBe(true);
    expect(LEGAL_UPDATED).toBe('2026-11-07');
    expect(COPYRIGHT_YEAR).toBe(2026);
  });
});
