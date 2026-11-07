import { describe, expect, it } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { legalKeys, PRIVACY_SECTIONS, TERMS_SECTIONS } from '@/lib/legal';
import { activeTab, showTabBar } from '@/components/public/publicNav';

const docs = [
  ['privacy', PRIVACY_SECTIONS],
  ['terms', TERMS_SECTIONS],
] as const;

describe.each(['en', 'ar'] as const)('legal messages (%s)', (lang) => {
  const messages = lang === 'en' ? en : ar;
  it.each(docs)('%s: every section has a title and exactly the listed paragraphs and bullets', (doc, sections) => {
    const body = messages.legal[doc].sections as Record<string, Record<string, string>>;
    expect(Object.keys(body).sort()).toEqual(sections.map((s) => s.id).sort());
    for (const s of sections) {
      expect(body[s.id]!.title, `${doc}.${s.id}.title`).toBeTruthy();
      expect(Object.keys(body[s.id]!).filter((k) => k !== 'title').sort()).toEqual(legalKeys(s).sort());
    }
  });
});

describe('legalKeys', () => {
  it('puts paragraphs, bullets, then trailing paragraphs', () => {
    expect(legalKeys({ id: 'x', p: 1, b: 2, after: 1 })).toEqual(['p1', 'b1', 'b2', 'p2']);
  });
});

describe('public navigation', () => {
  it('marks Explore on the home and directory pages and How it works on #how', () => {
    expect(activeTab('/', '')).toBe('explore');
    expect(activeTab('/', '#how')).toBe('how');
    expect(activeTab('/directory', '')).toBe('explore');
    expect(activeTab('/pricing', '')).toBe('pricing');
    expect(activeTab('/b/studio', '')).toBeNull();
  });
  it('shows the phone tab bar on marketplace pages only, never in the booking flow', () => {
    for (const p of ['/', '/directory', '/pricing', '/privacy', '/terms']) expect(showTabBar(p)).toBe(true);
    for (const p of ['/b/studio-nour', '/l/abc', '/o/abc', '/pay/x']) expect(showTabBar(p)).toBe(false);
  });
});

describe('home copy rules', () => {
  const walk = (o: unknown, out: string[] = []): string[] => {
    if (typeof o === 'string') out.push(o);
    else if (o && typeof o === 'object') Object.values(o).forEach((v) => walk(v, out));
    return out;
  };
  it('never claims "no availability" or "fully booked", and does not mention features that do not exist', () => {
    const text = walk(en.home).join('\n').toLowerCase();
    for (const banned of ['no availability', 'fully booked', 'my bookings', 'reference', '30 days', 'help centre', '[xx]', 'solo', 'clinic plan'])
      expect(text, banned).not.toContain(banned);
  });
});
