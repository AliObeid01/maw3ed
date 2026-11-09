import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FREE_START_HREF, OWNER_START_HREF, PLANS_HREF, PRO_CHECKOUT_HREF, PRO_START_HREF } from '@/lib/links';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('shared owner links (PR-13)', () => {
  it('every "start as a business owner" CTA goes to the plans section', () => {
    expect(OWNER_START_HREF).toBe('/for-business#plans');
    expect(PLANS_HREF).toBe(OWNER_START_HREF);
    expect(FREE_START_HREF).toBe('/signup');
    expect(PRO_START_HREF).toBe('/signup?plan=pro');
    expect(PRO_CHECKOUT_HREF).toBe('/app/checkout?plan=pro');
  });

  // Each of these files holds an owner CTA. They must read the ONE constant and must not hard-code /signup or /pricing,
  // so one of them cannot drift away from the plans section.
  it.each([
    'src/components/home/FinalCta.tsx',
    'src/components/home/OwnerSections.tsx',
    'src/components/home/CategoryExplorer.tsx',
    'src/components/explore/ExploreView.tsx',
    'src/components/public/PublicFooter.tsx',
  ])('%s uses OWNER_START_HREF and no literal /signup', (file) => {
    const source = read(file);
    expect(source).toContain('OWNER_START_HREF');
    expect(source).not.toMatch(/['"`]\/signup/);
    expect(source).not.toMatch(/['"`]\/pricing/);
  });

  it('nothing in src links to the removed /pricing page', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|mjs)$/.test(e.name) && /href[=:]\s*\{?\s*['"`]\/pricing\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});
