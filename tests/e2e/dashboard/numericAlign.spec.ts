import { type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from '../helpers/test';
import { expectNoPageOverflow } from '../helpers/layout';
import { mockSetupApi, setRole } from '../helpers/mockApi';

// PR-14b (c): numeric inputs are dir="ltr" (digits and "." read left to right) but, in Arabic, they sit at the end of
// the field like every other numeric field (ltrNumericEnd), not hard against the start edge.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD, viewport: { width: 360, height: 800 } });
test.setTimeout(90_000);

const load = (l: string) => JSON.parse(readFileSync(`messages/${l}.json`, 'utf8')) as { app: { services: { add: string } } };
const ar = load('ar');
const en = load('en');
const align = (l: Locator) => l.evaluate((el) => getComputedStyle(el).textAlign);

for (const [locale, expected, addLabel] of [
  ['ar', 'right', ar.app.services.add],
  ['en', 'left', en.app.services.add],
] as const) {
  test(`${locale}: deposit threshold, deposit amount and service price are ${expected}-aligned`, async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: locale, url: DASHBOARD }]);
    await setRole(page, 'OWNER', DASHBOARD);
    await mockSetupApi(page);
    await page.goto('/app/settings');
    await expect(page.locator('input[name="depositThreshold"]')).toBeVisible();
    expect(await align(page.locator('input[name="depositThreshold"]')), 'threshold').toMatch(expected === 'left' ? /^(left|start)$/ : /^right$/);
    expect(await align(page.locator('input[name="depositAmount"]')), 'amount').toMatch(expected === 'left' ? /^(left|start)$/ : /^right$/);
    await expectNoPageOverflow(page);
    await page.goto('/app/services');
    await page.getByRole('button', { name: addLabel }).first().click();
    const price = page.locator('input[name="price"]');
    await expect(price).toBeVisible();
    expect(await align(price), 'price').toMatch(expected === 'left' ? /^(left|start)$/ : /^right$/);
  });
}
