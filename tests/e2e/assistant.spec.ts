import { JOURNEY_URL } from './helpers/journeyEnv';
import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

// PR-15a: /assistant ("Book by chatting"). The default e2e server runs with MCP_ENABLED=true (playwright.config.ts);
// the journey server has no such variable, so it is the switched-off server.

const WIDTHS = [320, 360, 390, 768, 1440];
const PRIVACY_EN =
  'If you book through an AI assistant, the assistant provider also processes what you type, under its own privacy policy. Maw3ed stores only your name, phone, email and appointment details.';

const LANGS = [
  { lang: 'en', title: 'Book by chatting', copy: 'Copy', copied: 'Copied', status: 'Copied to the clipboard', chip: 'Find a dentist in Beirut this week', dir: 'ltr' },
  { lang: 'ar', title: 'احجز بالمحادثة', copy: 'نسخ', copied: 'تم النسخ', status: 'تم النسخ إلى الحافظة', chip: 'ابحث لي عن طبيب أسنان في بيروت هذا الأسبوع', dir: 'rtl' },
] as const;

for (const L of LANGS) {
  test.describe(`/assistant (${L.lang})`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies([{ name: 'locale', value: L.lang, url: ORIGIN }]);
    });

    test('renders without overflow at every width, direction and content', async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/assistant');
        await expect(page.getByRole('heading', { level: 1, name: L.title })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', L.dir);
        await expect(page.getByTestId('connector-url')).toHaveValue(/\/api\/mcp$/);
        await expect(page.getByTestId('prompt-chips').getByRole('button')).toHaveCount(3);
        await expect(page.getByText(/beta/i)).toHaveCount(0);
        await expectNoPageOverflow(page);
        const box = await page.getByTestId('copy-connector').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('Copy puts the connector URL on the clipboard and announces it', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/assistant');
      const url = await page.getByTestId('connector-url').inputValue();
      await page.getByTestId('copy-connector').click();
      await expect(page.getByTestId('copy-status')).toHaveText(L.status);
      await expect(page.getByTestId('copy-connector')).toContainText(L.copied);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    });

    test('an example chip copies its prompt', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/assistant');
      await page.getByTestId('prompt-find').click();
      await expect(page.getByTestId('prompt-status')).toHaveText(L.status);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(L.chip);
    });

    test('the FAQ details open and the privacy sentence is shown', async ({ page }) => {
      await page.goto('/assistant');
      const first = page.getByTestId('faq').locator('details').first();
      await first.locator('summary').click();
      await expect(first).toHaveAttribute('open', '');
      await expect(page.getByTestId('faq').locator('details')).toHaveCount(6);
      if (L.lang === 'en') await expect(page.getByTestId('assistant-privacy')).toContainText(PRIVACY_EN);
      else await expect(page.getByTestId('assistant-privacy')).toContainText('مساعد ذكاء اصطناعي');
    });

    test('the footer links to it, and the privacy policy carries the sentence', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page.locator('footer a[href="/assistant"]')).toHaveCount(1);
      const text = await page.getByRole('main').innerText();
      if (L.lang === 'en') expect(text).toContain(PRIVACY_EN);
      else expect(text).toContain('مساعد ذكاء اصطناعي');
    });
  });
}

test.describe('connector switched off (journey server has no MCP_ENABLED)', () => {
  test('/assistant is a 404, the footer link is hidden and the endpoint is a 404', async ({ page, request }) => {
    const res = await page.goto(`${JOURNEY_URL}/assistant`);
    expect(res?.status()).toBe(404);
    const home = await page.goto(`${JOURNEY_URL}/how-it-works`);
    expect(home?.status()).toBe(200);
    await expect(page.locator('footer a[href="/assistant"]')).toHaveCount(0);
    const post = await request.post(`${JOURNEY_URL}/api/mcp`, { data: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(post.status()).toBe(404);
    expect((await request.get(`${JOURNEY_URL}/api/mcp`)).status()).toBe(404);
  });
});
