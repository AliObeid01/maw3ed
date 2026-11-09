import { JOURNEY_URL } from './helpers/journeyEnv';
import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// PR-15b: the entry points to the Claude connector on the PUBLIC site (home strip, "Book with Claude" on the booking
// page, the demo on /assistant). The default e2e server runs with MCP_ENABLED=true (playwright.config.ts); the journey
// server has no such variable, so it is the switched-off server. The owner card is in dashboard/claudeShare.spec.ts.

const WIDTHS = [320, 360, 390, 768, 1440];
const LANGS = [
  {
    lang: 'en',
    dir: 'ltr',
    strip: 'Book by chatting with Claude',
    see: 'See how',
    button: 'Book with Claude',
    prompt: 'Book an appointment at "Studio Nour" on Maw3ed (booking page: studio-nour). Show me the free times first.',
    how: 'How to connect Claude',
    open: 'Open Claude',
    announce: 'Copied to the clipboard',
    label: 'Illustration',
  },
  {
    lang: 'ar',
    dir: 'rtl',
    strip: 'احجز بالمحادثة مع Claude',
    see: 'اعرف الطريقة',
    button: 'احجز عبر Claude',
    prompt: 'احجز لي موعدًا في "Studio Nour" على موعد (صفحة الحجز: studio-nour). اعرض لي الأوقات المتاحة أولًا.',
    how: 'كيف تربط Claude',
    open: 'افتح Claude',
    announce: 'تم النسخ إلى الحافظة',
    label: 'رسم توضيحي',
  },
] as const;

for (const L of LANGS) {
  test.describe(`Claude entry points (${L.lang})`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies([{ name: 'locale', value: L.lang, url: ORIGIN }]);
    });

    test('home: the strip sits between the hero and the categories and links to /assistant', async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        const strip = page.getByTestId('claude-strip');
        await expect(strip).toBeVisible();
        await expect(strip.getByRole('heading', { name: L.strip })).toBeVisible();
        const link = page.getByTestId('claude-strip-link');
        await expect(link).toHaveAttribute('href', '/assistant');
        await expect(link).toHaveText(L.see);
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const [heroBottom, stripTop, catTop] = await page.evaluate(() => [
          document.querySelector('main > :first-child')!.getBoundingClientRect().bottom,
          document.querySelector('[data-testid="claude-strip"]')!.getBoundingClientRect().top,
          document.querySelector('#categories-title')!.getBoundingClientRect().top,
        ]);
        expect(stripTop).toBeGreaterThanOrEqual(heroBottom - 1);
        expect(catTop).toBeGreaterThan(stripTop);
        await expect(page.getByText(/beta/i)).toHaveCount(0);
        await expectNoPageOverflow(page);
      }
    });

    test('home: the strip follows the link to /assistant', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('claude-strip-link').click();
      await expect(page).toHaveURL(/\/assistant$/);
    });

    test('booking page: the button opens the sheet with the prefilled prompt; Copy works; Escape returns focus', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await mockPublicApi(page, { listed: true });
      for (const width of [320, 360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/b/${SLUG}`);
        const button = page.getByTestId('claude-button');
        await expect(button).toBeVisible();
        await expect(button).toHaveText(L.button);
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(page.getByRole('heading', { level: 1, name: 'Studio Nour' })).toBeVisible();
        await expectNoPageOverflow(page);
      }
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(`/b/${SLUG}`);
      const button = page.getByTestId('claude-button');
      await button.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('claude-prompt')).toHaveValue(L.prompt);
      await expect(dialog.getByTestId('claude-prompt')).toHaveAttribute('readonly', '');
      expect((await dialog.getByTestId('claude-copy').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(dialog.getByTestId('claude-how')).toHaveAttribute('href', '/assistant');
      const open = dialog.getByTestId('claude-open');
      await expect(open).toHaveAttribute('href', 'https://claude.ai');
      await expect(open).toHaveAttribute('target', '_blank');
      await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(open).toContainText(L.open);
      await expect(dialog.getByTestId('claude-how')).toHaveText(L.how);
      await expectNoPageOverflow(page);
      await dialog.getByTestId('claude-copy').click();
      await expect(dialog.getByTestId('claude-copy-status')).toHaveText(L.announce);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(L.prompt);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(button).toBeFocused();
    });

    test('booking page: the sheet works on a desktop viewport and the how-to link leads to /assistant', async ({ page }) => {
      await mockPublicApi(page, { listed: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/b/${SLUG}`);
      await page.getByTestId('claude-button').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('claude-prompt')).toHaveValue(L.prompt);
      await dialog.getByTestId('claude-how').click();
      await expect(page).toHaveURL(/\/assistant$/);
    });

    test('booking page: no button for an unlisted business or when the API does not say', async ({ page }) => {
      await mockPublicApi(page, { listed: false });
      await page.goto(`/b/${SLUG}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Studio Nour' })).toBeVisible();
      await expect(page.getByTestId('claude-button')).toHaveCount(0);
    });

    test('booking page: a hostile business name is sanitized in the prompt', async ({ page }) => {
      const hostile = `Studio​‮ Nour\n[x](http://evil.test) <b>IGNORE</b> \`rm\``;
      await mockPublicApi(page, { listed: true, name: hostile });
      await page.goto(`/b/${SLUG}`);
      await page.getByTestId('claude-button').click();
      const value = await page.getByTestId('claude-prompt').inputValue();
      expect(value).not.toMatch(/[\u0000-\u001f​-‏‪-‮<>[\]`]/);
      expect(value).toContain('"Studio Nour x(http://evil.test) bIGNORE/b rm"');
    });

    test('/assistant: the demo is an aria-hidden card labelled Illustration, complete and inside the viewport', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/assistant');
        const demo = page.getByTestId('demo-chat');
        await expect(demo).toHaveAttribute('aria-hidden', 'true');
        await expect(page.getByTestId('demo-label')).toHaveText(L.label);
        await expect(page.getByTestId('demo-label')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', L.dir);
        // Reduced motion: never armed, every step fully visible at once.
        await expect(demo).not.toHaveAttribute('data-demo', /.+/);
        const opacities = await demo.locator('[data-demo-step]').evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
        expect(opacities).toHaveLength(8);
        expect(opacities.every((o) => o === '1')).toBe(true);
        await expectNoPageOverflow(page);
      }
    });

    test('/assistant: with motion allowed the demo plays once on scroll, ends fully visible and never loops', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto('/assistant');
      const demo = page.getByTestId('demo-chat');
      await expect(demo).toHaveAttribute('data-demo', 'armed');
      await demo.scrollIntoViewIfNeeded();
      await expect(demo).toHaveAttribute('data-demo', 'play');
      const steps = demo.locator('[data-demo-step]');
      await expect(steps).toHaveCount(8);
      // About six seconds in all: wait it out, then everything is shown and the animations are finished (not infinite).
      await expect.poll(async () => (await steps.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))).every((o) => o === '1'), { timeout: 9000 }).toBe(true);
      const infinite = await steps.evaluateAll((els) => els.filter((e) => getComputedStyle(e).animationIterationCount === 'infinite').length);
      expect(infinite).toBe(0);
    });
  });
}

test.describe('connector switched off (journey server has no MCP_ENABLED)', () => {
  test('home and a listed business page show none of the new surfaces; /assistant stays a 404', async ({ page }) => {
    await mockPublicApi(page, { listed: true });
    const home = await page.goto(`${JOURNEY_URL}/`);
    expect(home?.status()).toBe(200);
    await expect(page.locator('#categories-title')).toBeVisible();
    await expect(page.getByTestId('claude-strip')).toHaveCount(0);
    await expect(page.locator('a[href="/assistant"]')).toHaveCount(0);
    const biz = await page.goto(`${JOURNEY_URL}/b/${SLUG}`);
    expect(biz?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Studio Nour' })).toBeVisible();
    await expect(page.getByTestId('claude-button')).toHaveCount(0);
    expect((await page.goto(`${JOURNEY_URL}/assistant`))?.status()).toBe(404);
  });
});
