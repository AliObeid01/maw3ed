import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CategoryIcon, CATEGORY_ICON_KEYS } from '@/components/brand/CategoryIcon';
import { CATEGORY_KEYS } from '@/lib/business/profile';
import { HOME_CATEGORIES } from '@/lib/home/categories';

const root = path.resolve(import.meta.dirname, '../../..');
const html = (category: string, size?: number) => renderToStaticMarkup(createElement(CategoryIcon, { category, size }));

describe('CategoryIcon', () => {
  it('has a distinct inline svg for every home category (24 grid, currentColor, aria-hidden)', () => {
    const bodies = new Set<string>();
    for (const key of HOME_CATEGORIES) {
      const m = html(key);
      expect(m, key).toContain('<svg');
      expect(m).toContain('viewBox="0 0 24 24"');
      expect(m).toContain('stroke="currentColor"');
      expect(m).toContain('stroke-width="2"');
      expect(m).toContain('stroke-linecap="round"');
      expect(m).toContain('stroke-linejoin="round"');
      expect(m).toContain('aria-hidden="true"');
      expect(m).toContain(`data-category="${key}"`);
      bodies.add(m.replace(/data-category="[^"]*"/, ''));
    }
    expect(bodies.size).toBe(HOME_CATEGORIES.length);
  });

  it('every business category key is covered, and an unknown key falls back to a neutral icon', () => {
    for (const key of CATEGORY_KEYS) expect(html(key)).toContain('<svg');
    expect([...CATEGORY_ICON_KEYS]).toEqual(expect.arrayContaining([...HOME_CATEGORIES]));
    const fallback = html('something-new');
    expect(fallback).toContain('<svg');
    expect(fallback).toContain('data-category="other"');
    expect(html('')).toContain('data-category="other"');
  });

  it('honours the size prop', () => {
    expect(html('barbers', 40)).toContain('width="40"');
    expect(html('barbers')).toContain('width="24"');
  });

  it('no category surface still imports the old lucide icons, and the notices file credits the sets', () => {
    const explorer = fs.readFileSync(path.join(root, 'src/components/home/CategoryExplorer.tsx'), 'utf8');
    expect(explorer).toContain('CategoryIcon');
    expect(explorer).not.toMatch(/\b(Brush|Scissors|Smile|Sparkles|Leaf|Activity)\b/);
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const name of ['razor-electric', 'scissors', 'dental', 'vaccine', 'flower-2', 'stretching', 'Tabler', 'Lucide', 'MIT', 'ISC'])
      expect(notices).toContain(name);
  });
});
