import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The behaviour (skeleton, header, progress bar, aria-busy) is proven in a browser by tests/e2e/loading.spec.ts for
// two of the routes. This cheap guard only makes sure none of the four heavy public routes loses its loading boundary
// or points at the wrong skeleton.
const APP = path.resolve(import.meta.dirname, '../../../src/app/(public)');

describe('loading.tsx exists for the four heavy public routes', () => {
  it.each([
    ['directory', 'directory'],
    ['how-it-works', 'how'],
    ['for-business', 'business'],
    ['pricing', 'pricing'],
  ])('/%s uses the %s skeleton', (dir, variant) => {
    const file = path.join(APP, dir, 'loading.tsx');
    expect(fs.existsSync(file), `${dir}/loading.tsx is missing`).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain(`<PageLoading variant="${variant}" />`);
  });
});
