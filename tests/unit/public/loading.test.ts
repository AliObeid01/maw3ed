import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '../../../src/app/(public)');

describe('loading.tsx skeletons for the heavy public routes', () => {
  it.each([
    ['directory', 'directory'],
    ['how-it-works', 'how'],
    ['for-business', 'business'],
    ['pricing', 'pricing'],
  ])('/%s has a loading boundary using the %s skeleton', (dir, variant) => {
    const file = path.join(APP, dir, 'loading.tsx');
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain(`<PageLoading variant="${variant}" />`);
  });
});
