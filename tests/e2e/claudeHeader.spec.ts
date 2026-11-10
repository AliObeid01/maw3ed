import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// PR-16 item 4c: "Book with Claude" must not cost the navy business header a whole extra row on phones. It sits in the
// same group as the pills (an icon-only 44 px pill below sm, icon and label from sm), so the header with the button
// is at most a few px taller than the header without it.

const MAX_GROWTH_PX = 4;

for (const lang of ['en', 'ar'] as const) {
  test.describe(`business header with the Claude button (${lang})`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies([{ name: 'locale', value: lang, url: ORIGIN }]);
    });

    async function heroHeight(page: Parameters<typeof mockPublicApi>[0], listed: boolean, width: number) {
      await mockPublicApi(page, { listed });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/b/${SLUG}`);
      const hero = page.getByRole('region', { name: 'Studio Nour' });
      await expect(hero.getByRole('heading', { level: 1 })).toBeVisible();
      if (listed) await expect(page.getByTestId('claude-button')).toBeVisible();
      else await expect(page.getByTestId('claude-button')).toHaveCount(0);
      const height = (await hero.boundingBox())!.height;
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      return height;
    }

    for (const width of [320, 360, 390, 768, 1440]) {
      test(`at ${width} px the header grows by at most ${MAX_GROWTH_PX} px`, async ({ page }) => {
        const without = await heroHeight(page, false, width);
        const withButton = await heroHeight(page, true, width);
        if (process.env.E2E_NUMBERS) console.log(`HEADER ${lang} ${width}: without=${without} with=${withButton}`);
        expect(withButton - without).toBeLessThanOrEqual(MAX_GROWTH_PX);
        await expectNoPageOverflow(page);
        // Still a 44 px target, with its name (icon-only on phones keeps the visible words for screen readers).
        const box = (await page.getByTestId('claude-button').boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        await expect(page.getByTestId('claude-button')).toHaveAccessibleName(
          lang === 'en' ? 'Book with Claude' : 'احجز عبر Claude',
        );
      });
    }
  });
}
