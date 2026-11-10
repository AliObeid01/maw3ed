import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN } from './helpers/clock';
import { mockExplore } from './helpers/explore';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

// PR-16b: when the Service chips wrap onto several rows (right column), the "When" block must stay compact: its chips
// sit right under the label, the hint right under the chips, and "Clear filters" right under the hint.

const LONG = [
  'Plastic Surgery Consultation',
  'Botox Treatment',
  'Cheek Filler',
  'Aesthetic Surgery',
  'Congenital Deformities',
];
const messages = (lang: string) =>
  JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../../messages/${lang}.json`), 'utf8')).directory.explore as Record<string, string>;
const L = { en: messages('en'), ar: messages('ar') };

for (const lang of ['en', 'ar'] as const) {
  for (const chips of [0, 2, 5]) {
    test(`filter bar keeps When compact with ${chips} service chips (${lang})`, async ({ page, context }, info) => {
      test.skip(info.project.name !== 'desktop', 'the inline bar needs a wide viewport; the viewport is set per case');
      await context.addCookies([{ name: 'locale', value: lang, url: ORIGIN }]);
      await mockExplore(page);
      const names = LONG.slice(0, chips);
      await page.route('**/api/public/categories**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            categories: [
              { category: 'beauty-clinics', places: 3, fromPrice: 8, nextFree: null, popularServices: names.map((name) => ({ name, fromPrice: 8 })) },
            ],
          }),
        }),
      );
      for (const width of [1440, 1024, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/directory?category=beauty-clinics');
        const group = page.getByRole('group', { name: L[lang].when });
        await expect(group).toBeVisible();
        if (chips) await expect(page.getByRole('button', { name: names[0] })).toBeVisible();
        const label = group.locator('span').first();
        const first = group.getByRole('button').first();
        const lb = (await label.boundingBox())!;
        const fb = (await first.boundingBox())!;
        expect(fb.y - (lb.y + lb.height), `${width}: label to first chip`).toBeLessThanOrEqual(12);

        const row = first.locator('xpath=..');
        const rb = (await row.boundingBox())!;
        const hint = group.locator('p').first();
        const hb = (await hint.boundingBox())!;
        expect(hb.y - (rb.y + rb.height), `${width}: chips to hint`).toBeLessThanOrEqual(16);

        const clear = group.getByRole('button', { name: L[lang].clear });
        const cb = (await clear.boundingBox())!;
        expect(cb.y - (hb.y + hb.height), `${width}: hint to Clear`).toBeLessThanOrEqual(16);
        expect(cb.y, 'Clear sits below the hint').toBeGreaterThanOrEqual(hb.y);
        await expectNoPageOverflow(page);
      }
    });
  }
}
