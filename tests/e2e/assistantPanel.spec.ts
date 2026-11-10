import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

// PR-16b: /assistant "What Claude can do" panel beside the demo card (owner's option B).

const messages = (lang: string) =>
  JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../../messages/${lang}.json`), 'utf8')).assistant as {
    copy: { announce: string; copied: string };
    can: { title: string; items: Record<string, { title: string; example: string }> };
  };
const IDS = ['find', 'book', 'waitlist', 'check', 'manage'];

for (const lang of ['en', 'ar'] as const) {
  const m = messages(lang);
  test.describe(`/assistant capability panel (${lang})`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies([{ name: 'locale', value: lang, url: ORIGIN }]);
    });

    test('at 1440 and 1024 the panel sits beside the demo card, tops aligned, no big empty region', async ({ page }) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('/assistant');
        const demo = (await page.getByTestId('demo-chat').boundingBox())!;
        const panel = (await page.getByTestId('capabilities').boundingBox())!;
        expect(Math.abs(demo.y - panel.y), `${width}: tops`).toBeLessThanOrEqual(8);
        expect(panel.width, `${width}: right column`).toBeGreaterThan(300);
        expect(panel.height / demo.height, `${width}: height ratio`).toBeGreaterThanOrEqual(0.6);
        // Side by side: in LTR the panel is to the right of the demo; in RTL it mirrors to the left.
        if (lang === 'en') expect(panel.x).toBeGreaterThanOrEqual(demo.x + demo.width);
        else expect(panel.x + panel.width).toBeLessThanOrEqual(demo.x + 1);
        await expectNoPageOverflow(page);
      }
    });

    test('stacked under the demo card at 390 and 768, and no overflow at 320/360/390/768/1440', async ({ page }) => {
      for (const width of [320, 360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/assistant');
        await expect(page.getByTestId('capabilities')).toBeVisible();
        await expectNoPageOverflow(page);
        if (width < 1024) {
          const demo = (await page.getByTestId('demo-chat').boundingBox())!;
          const panel = (await page.getByTestId('capabilities').boundingBox())!;
          expect(panel.y, `${width}: stacked`).toBeGreaterThanOrEqual(demo.y + demo.height);
          expect(Math.abs(panel.x - demo.x), `${width}: same start edge`).toBeLessThanOrEqual(1);
        }
      }
    });

    test('shows exactly the five claimed capabilities, with 44 px example buttons', async ({ page }) => {
      await page.goto('/assistant');
      const panel = page.getByTestId('capabilities');
      await expect(panel.getByRole('heading', { level: 3, name: m.can.title })).toBeVisible();
      await expect(panel.getByRole('listitem')).toHaveCount(5);
      for (const id of IDS) {
        await expect(page.getByTestId(`can-${id}`).getByRole('heading', { level: 4, name: m.can.items[id]!.title })).toBeVisible();
        const box = (await page.getByTestId(`can-example-${id}`).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await expect(panel.getByText(/beta|reschedul|payment/i)).toHaveCount(0);
    });

    test('an example copies its text and announces it', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/assistant');
      for (const id of ['find', 'manage']) {
        await page.getByTestId(`can-example-${id}`).click();
        await expect(page.getByTestId('can-status')).toHaveText(m.copy.announce);
        await expect(page.getByTestId(`can-example-${id}`)).toContainText(m.copy.copied);
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(m.can.items[id]!.example);
      }
    });
  });
}
